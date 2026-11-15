import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
import time

from astropy.coordinates import SkyCoord

from .api import create_app
from .client import IRSAClient
from .fixtures import FixtureClient, RecordedClient, synthetic_cutout
from .models import ArchiveError, FieldRequest, ProcessingConfig
from .pipeline import Pipeline
from .storage import LocalStore


def dump(value):
    return json.dumps(value, indent=2) + "\n"


def frame_summary(response):
    if response.comparison is None:
        return []
    return [{"frameId": f.id, "observationId": f.observation_id, "detector": f.detector,
             "release": f.release, "observedAtUtc": f.observed_at_utc.isoformat().replace("+00:00", "Z"),
             "wavelengthUm": f.wavelength_um, "validFraction": f.valid_fraction,
             "alignment": f.alignment, "sourceUrl": f.source_url} for f in response.comparison.frames]


def coverage(pipeline, targets, output, fov):
    """Live five-target check. Every outcome keeps the discovery/retrieval record."""
    results = []
    for target in targets:
        started = time.monotonic()
        entry = {"target": target["name"], "checkedAtUtc": datetime.now(UTC).isoformat(),
                 "coordinateProvenance": target["provenance"], "visibleChange": "not_assessed"}
        try:
            position = SkyCoord(target["ra"], target["dec"], unit=("hourangle", "deg"))
            field = FieldRequest(ra=position.ra.deg, dec=position.dec.deg, fovArcmin=fov)
            entry["field"] = field.model_dump(by_alias=True)
            response = pipeline.build(field)
            entry.update({"status": response.status, "diagnostics": response.diagnostics,
                          "comparisonId": response.comparison.id if response.comparison else None,
                          "frames": frame_summary(response)})
        except ArchiveError as exc:
            entry.update({"status": "request_failed", "code": exc.code, "message": exc.message,
                          "limit": (exc.details or {}).get("limit"),
                          "diagnostics": (exc.details or {}).get("diagnostics"), "comparisonId": None})
        entry["timings"] = dict(pipeline.last_timings)
        entry["elapsedSeconds"] = time.monotonic() - started
        results.append(entry)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(dump({"evidenceKind": "live_archive_check", "schemaVersion": 2,
                                "config": pipeline.config.model_dump(mode="json", by_alias=True),
                                "targets": results}))
        print(json.dumps({k: entry.get(k) for k in ("target", "status", "code", "message", "comparisonId", "elapsedSeconds")}), flush=True)


def retain(store, comparison_id, output, target, note):
    """Copy one saved comparison, with its original cutouts, into a fixture directory."""
    response = store.load(comparison_id)
    raw = store.load_raw(comparison_id)
    assets = {}
    for frame in response.comparison.frames:
        for suffix in ("png", "fits"):
            assets[f"{frame.id}.{suffix}"] = store.asset(comparison_id, f"{frame.id}.{suffix}")[0]
    LocalStore(output / "evidence").publish(response, assets)
    (output / "response.json").write_text(dump(raw))
    (output / "sources.json").write_text(dump({
        "evidenceKind": "saved_real_example",
        "target": target,
        "originalComparisonId": comparison_id,
        "originalEvidenceKind": response.comparison.provenance["evidenceKind"],
        "field": response.comparison.field.model_dump(by_alias=True),
        "config": response.comparison.config,
        "selectionScope": "Only the frames selected by the original build are retained; "
                          "offline reprocessing sees these inputs alone and is not an archive search.",
        "visibleChange": "not_assessed",
        "note": note,
        "sources": [{"observation": item["observation"], "sha256": item["sourceSha256"],
                     "path": f"evidence/blobs/{item['sourceSha256']}"}
                    for item in response.comparison.provenance["inputs"]]}))


def synthetic_fixtures(root, config):
    """Regenerate labelled synthetic response examples. Adds evidence; removes none."""
    store = LocalStore(root / "synthetic" / "evidence")
    field = FieldRequest(ra=10, dec=20, fovArcmin=6)
    transient = ArchiveError("UPSTREAM_ERROR", "Synthetic simulated cutout failure",
                             details={"category": "transient_http", "attempts": config.attempts})
    cases = {
        "ready": [synthetic_cutout(), synthetic_cutout(shift=2)],
        "ready_incomplete_retrieval": [synthetic_cutout(), transient, synthetic_cutout(shift=2)],
        "single_epoch": [synthetic_cutout()],
        "no_coverage": [],
        "no_comparable_pair": [synthetic_cutout(), synthetic_cutout(wavelength=2)],
        "upstream_unavailable": [transient, transient],
        "upstream_unavailable_incomplete_negative": [synthetic_cutout(), synthetic_cutout(wavelength=2), transient],
    }
    (root / "responses").mkdir(parents=True, exist_ok=True)
    for name, cutouts in cases.items():
        response = Pipeline(FixtureClient(cutouts), store, config).build(field)
        (root / "responses" / f"{name}.json").write_text(dump(response.model_dump(mode="json", by_alias=True)))
    (root / "responses" / "errors").mkdir(exist_ok=True)
    for name, status, code, message in [
            ("build_busy", 429, "BUILD_BUSY", "Another comparison build is running; retry shortly. Saved comparisons remain available by ID."),
            ("processing_limit_cutout_budget", 503, "PROCESSING_LIMIT", "No pair found within cutout budget; archive search is not exhaustive"),
            ("processing_limit_deadline", 503, "PROCESSING_LIMIT", "Build deadline of 180 s reached during retrieval; nothing was published"),
            ("invalid_request", 422, "INVALID_REQUEST", "Finite RA/Dec and a field of 1\u201330 arcminutes are required"),
            ("not_found", 404, "NOT_FOUND", "Unknown comparison ID")]:
        (root / "responses" / "errors" / f"{name}.json").write_text(dump(
            {"httpStatus": status, "body": {"code": code, "message": message}}))


def main():
    parser = argparse.ArgumentParser(description="SPHEREx archive comparison backend")
    parser.add_argument("--storage", type=Path, default=Path("services/archive/.local-data"))
    parser.add_argument("--synthetic", action="store_true", help="Explicitly synthetic offline fixture")
    parser.add_argument("--recorded", type=Path, help="Recorded real source fixture; offline reproduction")
    defaults = ProcessingConfig()
    parser.add_argument("--max-candidates", type=int, default=defaults.max_candidates)
    parser.add_argument("--max-frames", type=int, default=defaults.max_frames)
    parser.add_argument("--timeout", type=float, default=defaults.timeout_seconds)
    parser.add_argument("--attempts", type=int, default=defaults.attempts)
    parser.add_argument("--deadline", type=float, default=defaults.build_deadline_seconds,
                        help="Overall build deadline in seconds")
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("compare")
    build.add_argument("--ra", type=float, required=True)
    build.add_argument("--dec", type=float, required=True)
    build.add_argument("--fov", type=float, default=6)
    replay = commands.add_parser("replay")
    replay.add_argument("id")
    commands.add_parser("openapi")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8000)
    log = commands.add_parser("coverage")
    log.add_argument("--output", type=Path, required=True)
    log.add_argument("--targets", type=Path, default=Path("fixtures/archive/targets.json"))
    log.add_argument("--only", action="append", help="Target name; repeat to check several")
    log.add_argument("--fov", type=float, default=6)
    keep = commands.add_parser("retain", help="Copy a saved comparison into a fixture directory")
    keep.add_argument("id")
    keep.add_argument("--output", type=Path, required=True)
    keep.add_argument("--target", required=True)
    keep.add_argument("--note", default="")
    examples = commands.add_parser("synthetic-fixtures")
    examples.add_argument("--output", type=Path, default=Path("fixtures/archive"))
    args = parser.parse_args()
    config = ProcessingConfig(maxCandidates=args.max_candidates, maxFrames=args.max_frames,
                              timeoutSeconds=args.timeout, attempts=args.attempts,
                              buildDeadlineSeconds=args.deadline)
    fixtures = Path(__file__).resolve().parents[2] / "fixtures" / "archive"
    examples = ([fixtures / name / "evidence" for name in
                 ("real", "real-barnard", "real-wise0855", "real-epsindib", "real-rdraconis")]
                if args.command in {"serve", "replay"} else None)
    store = LocalStore(args.storage / "evidence", examples=examples)
    if args.synthetic and args.recorded:
        parser.error("Choose either synthetic or recorded inputs")
    client = RecordedClient(args.recorded) if args.recorded else (FixtureClient() if args.synthetic else IRSAClient(config, args.storage / "cache"))
    pipeline = Pipeline(client, store, config)
    if args.command == "serve":
        import uvicorn
        # Single process on purpose: the one-build admission limit is process-local.
        uvicorn.run(create_app(pipeline), host="127.0.0.1", port=args.port, workers=1)
        return
    if args.command == "openapi":
        print(json.dumps(create_app(pipeline).openapi(), indent=2))
        return
    if args.command == "synthetic-fixtures":
        synthetic_fixtures(args.output, config)
        return
    if args.command == "coverage":
        if args.synthetic or args.recorded:
            parser.error("Coverage reports must query the real archive")
        targets = json.loads(args.targets.read_text())
        if args.only:
            targets = [t for t in targets if t["name"] in args.only]
        coverage(pipeline, targets, args.output, args.fov)
        return
    try:
        if args.command == "retain":
            retain(store, args.id, args.output, args.target, args.note)
            return
        if args.command == "replay":
            print(dump(store.load_raw(args.id)), end="")
            return
        response = pipeline.build(FieldRequest(ra=args.ra, dec=args.dec, fovArcmin=args.fov))
        print(response.model_dump_json(by_alias=True, indent=2))
    except ArchiveError as exc:
        parser.exit(1, json.dumps({"code": exc.code, "message": exc.message}) + "\n")


if __name__ == "__main__":
    main()
