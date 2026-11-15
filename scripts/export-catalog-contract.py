"""Regenerate catalog schema and reviewed naming responses from the service models."""
import json
import os
import sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "services/catalogs"))
# Export a stable offline description, independent of the developer's runtime mode.
os.environ["CATALOGS_LIVE"] = "0"
os.environ["CATALOGS_EXTERNAL_RESOLVE"] = "0"
from app.main import create_app
from app.models import ObjectIdentity, ResolveResult
out = root / "fixtures/catalogs"
out.mkdir(parents=True, exist_ok=True)
(out / "openapi.json").write_text(json.dumps(create_app().openapi(), indent=2) + "\n")
presets = json.loads((root / "services/catalogs/fixtures/catalogs/presets.json").read_text())
(out / "resolved-targets.json").write_text(json.dumps([ResolveResult.model_validate({k: p[k] for k in ("name", "ra", "dec", "identity", "positionProvenance")}).model_dump(by_alias=True) for p in presets["presets"]], ensure_ascii=False, indent=2) + "\n")
(out / "source-identities.json").write_text(json.dumps([ObjectIdentity.model_validate(identity).model_dump(by_alias=True) for identity in presets.get("sourceIdentities", [])], ensure_ascii=False, indent=2) + "\n")
