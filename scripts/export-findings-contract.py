"""Export public schemas without contacting Supabase or the archives."""
import json
import sys
from pathlib import Path
from fastapi import FastAPI

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from services.findings.api import create_router
from services.findings.supabase import Supabase

async def unused(identifier):
    return None

app = FastAPI()
app.include_router(create_router(Supabase(None, "https://example.invalid", "public", "server"), unused))
destination = root / "services/findings/fixtures/openapi.json"
destination.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
