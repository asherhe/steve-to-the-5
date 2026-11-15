"""Opt-in five-target check of both real archive routes, bypassing saved results.

Run from the repository root: services/archive/.venv/Scripts/python.exe -m
scripts.verify_blink_live --output docs/verification/blink-live-20261115.json
This contacts IRSA and retains downloaded evidence under .cache/blink-live.
"""
import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
import time

from astropy.coordinates import SkyCoord
from fastapi.testclient import TestClient

from services.archive.api import create_app
from services.archive.client import IRSAClient
from services.archive.models import ProcessingConfig
from services.archive.pipeline import Pipeline
from services.archive.storage import LocalStore
from services.wise.api import create_app as wise_app
from services.wise.indexed import IndexedWiseClient as WiseClient
from services.wise.models import WiseConfig
from services.wise.pipeline import WisePipeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--storage", type=Path, default=Path(".cache/blink-live"))
    parser.add_argument("--only", action="append", help="Exact target name; repeat to select several")
    parser.add_argument("--survey", choices=("spherex", "wise"))
    args = parser.parse_args()
    report = {"kind": "live_local_route_check", "deployed": False,
              "startedAtUtc": datetime.now(UTC).isoformat(), "targets": []}
    targets = json.loads(Path("fixtures/archive/targets.json").read_text())
    if args.only:
        targets = [target for target in targets if target["name"] in args.only]
        if not targets:
            parser.error("No challenge target matches --only")
    for survey in ([args.survey] if args.survey else ("spherex", "wise")):
        root = args.storage / survey
        config = ProcessingConfig() if survey == "spherex" else WiseConfig()
        client = IRSAClient(config, root / "cache") if survey == "spherex" else WiseClient(config, root / "cache")
        pipeline = (Pipeline if survey == "spherex" else WisePipeline)(client, LocalStore(root / "evidence"), config)
        app = (create_app if survey == "spherex" else wise_app)(pipeline)
        route = "/api/comparisons" if survey == "spherex" else "/api/wise/comparisons"
        with TestClient(app) as http:
            for target in targets:
                position = SkyCoord(target["ra"], target["dec"], unit=("hourangle", "deg"))
                params = {"ra": position.ra.deg, "dec": position.dec.deg, "fovArcmin": 6, "refresh": True}
                if survey == "wise":
                    params.update(band=2, mode="blink")
                start = time.perf_counter()
                response = http.get(route, params=params)
                body = response.json()
                comparison = body.get("comparison")
                entry = {"target": target["name"], "survey": survey,
                         "checkedAtUtc": datetime.now(UTC).isoformat(),
                         "field": params, "coordinateProvenance": target["provenance"],
                         "httpStatus": response.status_code, "status": body.get("status"),
                         "code": body.get("code"), "message": body.get("message"),
                         "elapsedSeconds": round(time.perf_counter() - start, 3),
                         "comparisonId": comparison["id"] if comparison else None,
                         "frames": [{key: f[key] for key in ("observedAtUtc", "sourceUrl", "wavelengthUm")}
                                    for f in comparison["frames"]] if comparison else [],
                         "diagnostics": body.get("diagnostics"), "visibleChange": "not_assessed"}
                report["targets"].append(entry)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
                print(json.dumps({key: entry[key] for key in ("target", "survey", "status", "code", "elapsedSeconds")}), flush=True)


if __name__ == "__main__":
    main()
