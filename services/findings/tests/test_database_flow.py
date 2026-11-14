import asyncio
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import httpx
from fastapi import FastAPI

from services.findings import create_router
from services.findings.supabase import Supabase
from services.findings.verify_live import CheckFailed, verify_accounts, verify_flow
from test_findings import FIXTURES, OWNER, READER


TEST_DIR = Path(__file__).parent
HAS_DATABASE = shutil.which("node") and (TEST_DIR.parent / ".venv/node_modules/@electric-sql/pglite").is_dir()


@unittest.skipUnless(HAS_DATABASE, "Install the declared PGlite test dependency and Node.js to run database integration.")
class DatabaseFlowTest(unittest.IsolatedAsyncioTestCase):
    async def test_create_public_read_reply_replay_and_hide(self):
        db = subprocess.Popen(["node", str(TEST_DIR / "pglite_bridge.cjs")], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")

        def command(endpoint, payload):
            db.stdin.write(json.dumps({"endpoint": endpoint, "payload": payload}) + "\n")
            db.stdin.flush()
            return json.loads(db.stdout.readline())["result"]

        try:
            self.assertEqual(json.loads(await asyncio.wait_for(asyncio.to_thread(db.stdout.readline), timeout=15)), {"ready": True})

            async def upstream(request):
                if request.url.path == "/auth/v1/user":
                    token = request.headers.get("Authorization")
                    self.assertEqual(request.headers["apikey"], "public-key")
                    if token not in ("Bearer first", "Bearer second"):
                        return httpx.Response(401)
                    user = OWNER if token == "Bearer first" else READER
                    return httpx.Response(200, json={"id": user, "user_metadata": {"display_name": "Observer"}})
                self.assertEqual(request.headers["apikey"], "server-key")
                result = await asyncio.wait_for(asyncio.to_thread(command,
                    request.url.path.removeprefix("/rest/v1/"), json.loads(request.content)), timeout=10)
                return httpx.Response(200, content=json.dumps(result))

            comparison = json.loads(json.dumps(FIXTURES["comparison"]))

            async def saved_lookup(identifier):
                return comparison if identifier == comparison["id"] else None

            async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as upstream_client:
                await verify_accounts(upstream_client, "https://supabase.example", "public-key", "first", "second")
                with self.assertRaises(CheckFailed):
                    await verify_accounts(upstream_client, "https://supabase.example", "public-key", "first", "first")
                app = FastAPI()
                app.include_router(create_router(Supabase(upstream_client, "https://supabase.example", "public-key", "server-key"), saved_lookup))

                @app.get("/api/comparisons/{identifier}")
                async def replay(identifier: str):
                    return await saved_lookup(identifier)

                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    identifier = await verify_flow(client, comparison["id"], 359.8, -0.25, "first", "second")
                    self.assertEqual(comparison, FIXTURES["comparison"])
                    await asyncio.wait_for(asyncio.to_thread(command, "hide", {"id": identifier}), timeout=10)
                    self.assertEqual((await client.get(f"/api/findings/{identifier}")).status_code, 404)
                    response = await client.post(f"/api/findings/{identifier}/replies", json={"text": "Hidden"},
                        headers={"Authorization": "Bearer second"})
                    self.assertEqual(response.status_code, 404)
                    response = await client.get("/api/findings", params={"ra": 0, "dec": 0, "radiusDeg": 2, "zoom": 10})
                    self.assertEqual(response.json(), {"items": []})
        finally:
            db.stdin.close()
            try:
                await asyncio.to_thread(db.wait, timeout=10)
            except subprocess.TimeoutExpired:
                db.kill()
                db.wait(timeout=5)
            db.stdout.close()
            db.stderr.close()
        self.assertEqual(db.returncode, 0)
