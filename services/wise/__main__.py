import argparse
import json
from pathlib import Path

from services.archive.models import ArchiveError

from .api import create_app, create_store
from .indexed import IndexedWiseClient
from .models import WiseConfig, WiseFieldRequest
from .pipeline import WisePipeline


def main():
    parser = argparse.ArgumentParser(description="WISE/NEOWISE time-lapse comparison backend")
    parser.add_argument("--storage", type=Path, default=Path("services/wise/.local-data"))
    defaults = WiseConfig()
    parser.add_argument("--max-epochs", type=int, default=defaults.max_epochs)
    parser.add_argument("--exposures-per-epoch", type=int, default=defaults.exposures_per_epoch)
    parser.add_argument("--deadline", type=float, default=defaults.build_deadline_seconds,
                        help="Overall build deadline in seconds")
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("compare")
    build.add_argument("--ra", type=float, required=True)
    build.add_argument("--dec", type=float, required=True)
    build.add_argument("--fov", type=float, default=6)
    build.add_argument("--band", type=int, default=2, choices=(1, 2))
    build.add_argument("--summary", action="store_true", help="Print a short summary, not the manifest")
    replay = commands.add_parser("replay")
    replay.add_argument("id")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8020)
    args = parser.parse_args()
    config = WiseConfig(maxEpochs=args.max_epochs, exposuresPerEpoch=args.exposures_per_epoch,
                        minExposuresPerEpoch=min(defaults.min_exposures_per_epoch, args.exposures_per_epoch),
                        buildDeadlineSeconds=args.deadline)
    store = create_store(args.storage)
    pipeline = WisePipeline(IndexedWiseClient(config, args.storage / "cache"), store, config)
    if args.command == "serve":
        import uvicorn
        # Single process on purpose: the one-build admission limit is process-local.
        uvicorn.run(create_app(pipeline), host="127.0.0.1", port=args.port, workers=1)
        return
    try:
        if args.command == "replay":
            print(json.dumps(store.load_raw(args.id), indent=2))
            return
        response = pipeline.build(WiseFieldRequest(ra=args.ra, dec=args.dec, fovArcmin=args.fov, band=args.band))
        if not args.summary:
            print(response.model_dump_json(by_alias=True, indent=2))
            return
        comparison = response.comparison
        print(json.dumps({
            "status": response.status, "comparisonId": comparison.id if comparison else None,
            "timings": pipeline.last_timings,
            "diagnostics": {key: response.diagnostics.get(key) for key in
                            ("complete", "incompleteStages", "discovery", "epochs", "usableEpochCount",
                             "rejectedEpochs", "code", "message")},
            "retrieval": {key: value for key, value in response.diagnostics.get("retrieval", {}).items()
                          if key != "failures"},
            "frames": [{"observedAtUtc": f.observed_at_utc.isoformat(), "release": f.release,
                        "exposures": f.quality_flags["combinedExposures"],
                        "validFraction": round(f.valid_fraction, 4), "alignment": f.alignment}
                       for f in (comparison.frames if comparison else [])]}, indent=2))
    except ArchiveError as exc:
        parser.exit(1, json.dumps({"code": exc.code, "message": exc.message}) + "\n")


if __name__ == "__main__":
    main()
