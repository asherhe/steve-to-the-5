"""Live catalog steps for the check chain (CATALOGS_LIVE=1).

Each step queries a public service directly over HTTPX with a timeout and a response-size
bound, and maps the upstream columns to `CatalogRow`. Any network, HTTP or parsing failure
raises UpstreamError so the step is reported as unavailable, never as "no match".

Upstream schemas and units used here (from each service's documentation):
- SIMBAD TAP `basic`: main_id, ra/dec (deg, ICRS, epoch J2000), pmra/pmdec (mas/yr, pmra
  includes cos dec), otype.
- IRSA TAP `catwise_2020`: source_name, ra/dec (deg, epoch MJD 57170 ≈ 2015.4),
  pmra/pmdec (arcsec/yr), w1mpro/w2mpro (Vega mag).
- VizieR ASU TSV: computed `_RAJ2000`/`_DEJ2000` (deg) for 2MASS PSC (II/246/out) and
  AllWISE (II/328/allwise); no proper motion, so positions are at each survey's epoch.
- IMCCE SkyBoT cone search (JSON): known solar-system objects at a given time; HTTP 204
  means none.
- UltracoolSheet: no query API, so a local CSV snapshot configured by
  CATALOGS_ULTRACOOL_CSV.

The SIMBAD, CatWISE and VizieR column mappings were written against documentation while
those services were unreachable; they are unverified until a dated live check is recorded.
"""
from __future__ import annotations

import csv
import io
import math
import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

import httpx

from app.chain.core import CatalogRow, ChainQuery, StepNotConfigured, angular_sep_arcsec
from app.gaia.provider import GaiaProvider, UpstreamError

MAX_RESPONSE_BYTES = 2_000_000
USER_AGENT = "spherex-viewer-check-chain/0.1"

SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
IRSA_TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
VIZIER_ASU = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"
SKYBOT_CONE = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php"

CATWISE_REF_EPOCH = 2015.4  # MJD 57170
SIMBAD_REF_EPOCH = 2000.0
GAIA_ARCHIVE = "https://gea.esac.esa.int/archive/"


def _float(value) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _get(client: httpx.Client, url: str, *, params=None, data=None) -> httpx.Response:
    try:
        if data is not None:
            response = client.post(url, data=data)
        else:
            response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Request failed: {exc.__class__.__name__}.") from exc
    if response.status_code >= 400:
        raise UpstreamError(f"Service returned HTTP {response.status_code}.")
    if len(response.content) > MAX_RESPONSE_BYTES:
        raise UpstreamError("Service response exceeded the size limit.")
    mime = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if mime in {"text/html", "application/xhtml+xml"}:
        raise UpstreamError("Service returned a web page instead of data.")
    return response


def _tap_csv(client: httpx.Client, url: str, adql: str, extra: dict | None = None) -> list[dict]:
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql, **(extra or {})}
    text = _get(client, url, data=data).text
    if text.lstrip().startswith("<"):
        # TAP services report query errors as a VOTable.
        raise UpstreamError("TAP query returned an error document.")
    return list(csv.DictReader(io.StringIO(text)))


def _cone_adql(table: str, columns: str, ra: float, dec: float, radius_deg: float, top: int) -> str:
    return (
        f"SELECT TOP {int(top)} {columns} FROM {table} "
        f"WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.8f}, {dec:.8f}, {radius_deg:.8f})) = 1"
    )


class GaiaStep:
    """Gaia DR3 through the service's existing provider (live TAP or fixtures)."""

    id = "gaia_dr3"
    label = "Gaia DR3"
    catalog = "gaiadr3.gaia_source"
    reference_url = GAIA_ARCHIVE
    requires_observation_epoch = False
    caveat = None

    def __init__(self, provider: GaiaProvider, max_rows: int) -> None:
        self._provider = provider
        self._max_rows = max_rows

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        rows = self._provider.nearby(query.ra, query.dec, query.search_radius_arcsec, self._max_rows)
        out = []
        for r in rows:
            bits = [f"G {r.g_mag:.2f} mag" if r.g_mag is not None else None,
                    f"parallax {r.parallax_mas:.2f} mas" if r.parallax_mas is not None else None]
            out.append(CatalogRow(
                name=f"Gaia DR3 {r.source_id}", ra=r.ra, dec=r.dec, ref_epoch=r.ref_epoch,
                pm_ra_cos_dec_mas_yr=r.pm_ra_cos_dec_mas_yr, pm_dec_mas_yr=r.pm_dec_mas_yr,
                detail=", ".join(b for b in bits if b) or None,
                url=f"{GAIA_ARCHIVE}?source_id={r.source_id}",
            ))
        return out


class SimbadStep:
    id = "simbad"
    label = "SIMBAD"
    catalog = "SIMBAD basic"
    reference_url = "https://simbad.cds.unistra.fr/simbad/"
    requires_observation_epoch = False
    caveat = None

    def __init__(self, client: httpx.Client, max_rows: int) -> None:
        self._client, self._max_rows = client, max_rows

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        adql = _cone_adql("basic", "main_id, ra, dec, pmra, pmdec, otype",
                          query.ra, query.dec, query.search_radius_arcsec / 3600.0, self._max_rows)
        rows = []
        for r in _tap_csv(self._client, SIMBAD_TAP, adql):
            ra, dec = _float(r.get("ra")), _float(r.get("dec"))
            if ra is None or dec is None:
                continue
            name = (r.get("main_id") or "").strip() or "SIMBAD object"
            rows.append(CatalogRow(
                name=name, ra=ra, dec=dec, ref_epoch=SIMBAD_REF_EPOCH,
                pm_ra_cos_dec_mas_yr=_float(r.get("pmra")), pm_dec_mas_yr=_float(r.get("pmdec")),
                detail=f"type {r['otype'].strip()}" if (r.get("otype") or "").strip() else None,
                url="https://simbad.cds.unistra.fr/simbad/sim-id?Ident=" + quote(name),
            ))
        return rows


class CatWiseStep:
    id = "catwise2020"
    label = "CatWISE2020"
    catalog = "catwise_2020 (IRSA)"
    reference_url = "https://irsa.ipac.caltech.edu/data/WISE/CatWISE/"
    requires_observation_epoch = False
    caveat = None

    def __init__(self, client: httpx.Client, max_rows: int) -> None:
        self._client, self._max_rows = client, max_rows

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        adql = _cone_adql("catwise_2020", "source_name, ra, dec, pmra, pmdec, w1mpro, w2mpro",
                          query.ra, query.dec, query.search_radius_arcsec / 3600.0, self._max_rows)
        rows = []
        for r in _tap_csv(self._client, IRSA_TAP, adql):
            ra, dec = _float(r.get("ra")), _float(r.get("dec"))
            if ra is None or dec is None:
                continue
            pmra, pmdec = _float(r.get("pmra")), _float(r.get("pmdec"))
            w1, w2 = _float(r.get("w1mpro")), _float(r.get("w2mpro"))
            rows.append(CatalogRow(
                name=f"CatWISE {(r.get('source_name') or '').strip()}".strip(),
                ra=ra, dec=dec, ref_epoch=CATWISE_REF_EPOCH,
                pm_ra_cos_dec_mas_yr=pmra * 1000.0 if pmra is not None else None,
                pm_dec_mas_yr=pmdec * 1000.0 if pmdec is not None else None,
                detail=f"W1−W2 {w1 - w2:.2f} mag" if w1 is not None and w2 is not None else None,
            ))
        return rows


class VizierInfraredStep:
    """2MASS PSC and AllWISE through VizieR's ASU interface."""

    id = "vizier"
    label = "VizieR (2MASS, AllWISE)"
    catalog = "II/246/out, II/328/allwise"
    reference_url = "https://vizier.cds.unistra.fr/"
    requires_observation_epoch = False
    caveat = ("Positions are at each survey's epoch (2MASS ≈ 2000, AllWISE ≈ 2010) without "
              "proper motion, so a fast mover can sit outside the radius.")
    _CATALOGS = (("II/246/out", "2MASS", "2MASS"), ("II/328/allwise", "AllWISE", "AllWISE"))

    def __init__(self, client: httpx.Client, max_rows: int) -> None:
        self._client, self._max_rows = client, max_rows

    @staticmethod
    def _parse_tsv(text: str) -> list[dict]:
        lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
        if not lines:
            return []
        header = lines[0].split("\t")
        # Header, units, then a dashes separator line precede the data rows.
        start = next((i + 1 for i, ln in enumerate(lines) if set(ln.replace("\t", "")) == {"-"}), 1)
        return [dict(zip(header, ln.split("\t"))) for ln in lines[start:]]

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        rows: list[CatalogRow] = []
        failures: list[str] = []
        for source, id_col, prefix in self._CATALOGS:
            params = {
                "-source": source, "-c": f"{query.ra:.7f} {query.dec:+.7f}",
                "-c.rs": f"{query.radius_arcsec:g}", "-out.max": str(self._max_rows),
                "-out": id_col, "-out.add": "_RAJ,_DEJ",
            }
            try:
                table = self._parse_tsv(_get(self._client, VIZIER_ASU, params=params).text)
            except UpstreamError:
                failures.append(prefix)
                continue
            for r in table:
                ra_key = next((k for k in r if k.startswith("_RA")), None)
                dec_key = next((k for k in r if k.startswith("_DE")), None)
                ra = _float(r.get(ra_key)) if ra_key else None
                dec = _float(r.get(dec_key)) if dec_key else None
                if ra is None or dec is None:
                    continue
                rows.append(CatalogRow(name=f"{prefix} {(r.get(id_col) or '').strip()}".strip(),
                                       ra=ra, dec=dec, detail=prefix))
        if failures and not rows:
            raise UpstreamError(f"VizieR query failed for {', '.join(failures)}.")
        return rows


def _hms_to_deg(text: str) -> float | None:
    parts = text.replace(":", " ").split()
    if len(parts) != 3:
        return None
    h, m, s = (_float(p) for p in parts)
    return None if None in (h, m, s) else (h + m / 60 + s / 3600) * 15.0


def _dms_to_deg(text: str) -> float | None:
    t = text.strip()
    sign = -1.0 if t.startswith("-") else 1.0
    parts = t.lstrip("+-").replace(":", " ").split()
    if len(parts) != 3:
        return None
    d, m, s = (_float(p) for p in parts)
    return None if None in (d, m, s) else sign * (d + m / 60 + s / 3600)


class SkybotStep:
    id = "skybot"
    label = "SkyBoT (known asteroids & comets)"
    catalog = "IMCCE SkyBoT"
    reference_url = "https://ssp.imcce.fr/webservices/skybot/"
    requires_observation_epoch = True
    caveat = "Positions computed for a geocentric observer at the frame's observation time."

    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        params = {
            "-ep": query.epoch_utc, "-ra": f"{query.ra:.7f}", "-dec": f"{query.dec:.7f}",
            "-rd": f"{query.radius_arcsec / 3600.0:.6f}", "-mime": "json", "-output": "basic",
            "-loc": "500", "-objFilter": "111", "-refsys": "EQJ2000", "-from": "SPHEREx-viewer",
        }
        response = _get(self._client, SKYBOT_CONE, params=params)
        if response.status_code == 204 or not response.content.strip():
            return []
        try:
            payload = response.json()
        except ValueError as exc:
            raise UpstreamError("SkyBoT returned unreadable data.") from exc
        if not isinstance(payload, list):
            raise UpstreamError("SkyBoT returned an unexpected response.")
        rows = []
        for r in payload:
            ra = _hms_to_deg(str(r.get("RA (hms)", "")))
            dec = _dms_to_deg(str(r.get("DEC (dms)", "")))
            if ra is None or dec is None:
                continue
            bits = [str(r.get("Class") or "").strip() or None,
                    f"V {r['VMag (mag)']} mag" if r.get("VMag (mag)") is not None else None]
            ssodnet = r.get("ssodnet") if isinstance(r.get("ssodnet"), dict) else {}
            rows.append(CatalogRow(
                name=str(r.get("Name") or r.get("Num") or "Solar-system object"),
                ra=ra, dec=dec, detail=", ".join(b for b in bits if b) or None,
                url=ssodnet.get("ssocard"),
            ))
        return rows


_ULTRACOOL_NAME = ("name", "designation", "Name")
_ULTRACOOL_RA = ("ra_j2000_formula", "ra", "RA", "ra_deg")
_ULTRACOOL_DEC = ("dec_j2000_formula", "dec", "Dec", "DEC", "dec_deg")
_ULTRACOOL_SPT = ("spt_opt", "spt_ir", "spt")


def _first(row: dict, keys: tuple[str, ...]):
    for key in keys:
        if row.get(key) not in (None, ""):
            return row[key]
    return None


@lru_cache(maxsize=2)
def _load_ultracool(path: str, mtime: float) -> tuple[CatalogRow, ...]:
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            ra, dec = _float(_first(r, _ULTRACOOL_RA)), _float(_first(r, _ULTRACOOL_DEC))
            if ra is None or dec is None:
                continue
            spt = _first(r, _ULTRACOOL_SPT)
            rows.append(CatalogRow(name=str(_first(r, _ULTRACOOL_NAME) or "UltracoolSheet entry"),
                                   ra=ra, dec=dec, detail=f"SpT {spt}" if spt else None))
    return tuple(rows)


class UltracoolStep:
    id = "ultracoolsheet"
    label = "UltracoolSheet"
    catalog = "UltracoolSheet (local snapshot)"
    reference_url = "https://zenodo.org/doi/10.5281/zenodo.4169084"
    requires_observation_epoch = False
    caveat = "Positions as listed in the snapshot, without proper-motion propagation."

    def __init__(self, csv_path: Path | None) -> None:
        self._path = csv_path

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        if self._path is None:
            raise StepNotConfigured(
                "No UltracoolSheet snapshot configured (set CATALOGS_ULTRACOOL_CSV)."
            )
        try:
            rows = _load_ultracool(str(self._path), os.path.getmtime(self._path))
        except (OSError, csv.Error, UnicodeDecodeError) as exc:
            raise UpstreamError("The UltracoolSheet snapshot could not be read.") from exc
        return [r for r in rows
                if angular_sep_arcsec(query.ra, query.dec, r.ra, r.dec) <= query.radius_arcsec]
