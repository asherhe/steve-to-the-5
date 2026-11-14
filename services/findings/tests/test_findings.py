import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import UUID

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.findings import create_router
from services.findings.models import CreatedFinding, Finding, Reply, Viewport
from services.findings.supabase import ApiError, Supabase

FIXTURES = json.loads((Path(__file__).parents[1] / "fixtures" / "responses.json").read_text())
FINDING_ID = FIXTURES["create"]["id"]
THREAD = FIXTURES["thread"]
OWNER = "33333333-3333-4333-8333-333333333333"
READER = "44444444-4444-4444-8444-444444444444"
VIEWPORT = {"ra": 0, "dec": 0, "radiusDeg": 2, "zoom": 10}


class FindingsSmokeTest(unittest.TestCase):
    def setUp(self):
        self.upstream = AsyncMock(side_effect=self.supabase_request)
        self.http = httpx.AsyncClient(transport=httpx.MockTransport(self.upstream))
        self.loader = AsyncMock(side_effect=lambda id: FIXTURES["comparison"] if id == "fixture-comparison" else None)
        supabase = Supabase(self.http, "https://supabase.example", "public-key", "server-key")
        app = FastAPI()
        app.include_router(create_router(supabase, self.loader))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def supabase_request(self, request):
        path = request.url.path
        if path == "/auth/v1/user":
            self.assertEqual(request.headers["apikey"], "public-key")
            profiles = {
                "Bearer first": (OWNER, "Observer One"),
                "Bearer second": (READER, "Observer Two"),
                "Bearer email-name": (OWNER, "one@example.com"),
            }
            signed_in = profiles.get(request.headers.get("Authorization"))
            if not signed_in:
                return httpx.Response(401)
            user_id, name = signed_in
            return httpx.Response(200, json={
                "id": user_id, "email": "one@example.com", "user_metadata": {"display_name": name}
            })

        self.assertEqual(request.headers["apikey"], "server-key")
        payload = json.loads(request.content)
        if path.endswith("/spherex_findings_viewport"):
            key = "pins" if payload["p_zoom"] >= 8 else "clusters"
            return httpx.Response(200, json=FIXTURES[key]["items"])
        if path.endswith("/spherex_finding_thread"):
            thread = THREAD if payload["p_id"] == FINDING_ID else None
            return httpx.Response(200, content=json.dumps(thread), headers={"content-type": "application/json"})
        if path.endswith("/spherex_findings"):
            self.assertEqual(payload["author_id"], OWNER)
            UUID(payload["id"])
            return httpx.Response(201)
        if path.endswith("/spherex_finding_reply"):
            self.assertEqual(payload["p_author_id"], READER)
            self.assertEqual(payload["p_author_display_name"], "Observer Two")
            return httpx.Response(200, json={**THREAD["replies"][0], "text": payload["p_text"]})
        self.fail(f"Unexpected request to {path}")

    def post_finding(self, token="first", **updates):
        body = {key: THREAD[key] for key in ("comparisonId", "ra", "dec", "title", "note", "marks")}
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post("/api/findings", json={**body, **updates}, headers=headers)

    def test_public_reads_return_evidence_and_display_names_only(self):
        response = self.client.get(f"/api/findings/{FINDING_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), THREAD)
        self.assertNotIn("email", response.text)
        self.assertEqual(self.client.get("/api/findings", params=VIEWPORT).json(), FIXTURES["pins"])
        self.assertEqual(
            self.client.get("/api/findings", params={**VIEWPORT, "zoom": 2}).json(), FIXTURES["clusters"]
        )

    def test_anonymous_and_invalid_session_writes_are_denied(self):
        self.assertEqual(self.post_finding(token=None).json(), FIXTURES["unauthorized"])
        self.assertEqual(self.post_finding(token="bad").status_code, 401)
        response = self.client.post(f"/api/findings/{FINDING_ID}/replies", json={"text": "Test"})
        self.assertEqual(response.status_code, 401)
        self.loader.assert_not_called()

    def test_post_uses_saved_comparison_and_session_identity(self):
        response = self.post_finding()
        self.assertEqual(response.status_code, 201)
        self.loader.assert_awaited_once_with("fixture-comparison")
        payload = json.loads(self.upstream.await_args.args[0].content)
        self.assertEqual(payload["id"], response.json()["id"])
        self.assertEqual(payload["marks"], THREAD["marks"])
        self.assertEqual(payload["author_display_name"], "Observer One")
        self.assertEqual(self.post_finding(authorId=READER).status_code, 422)

    def test_email_like_display_name_is_never_returned(self):
        self.assertEqual(self.post_finding(token="email-name").status_code, 201)
        payload = json.loads(self.upstream.await_args.args[0].content)
        self.assertEqual(payload["author_display_name"], "Sky observer")
        self.assertNotIn("@", json.dumps(payload))

    def test_reject_invalid_comparison_and_frame(self):
        response = self.post_finding(comparisonId="missing")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "invalid_comparison")
        response = self.post_finding(marks=[{"frameId": "wrong-frame", "ra": 0, "dec": 0}])
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "invalid_frame")
        self.assertTrue(all(call.args[0].url.path == "/auth/v1/user" for call in self.upstream.await_args_list))

    def test_second_account_can_reply(self):
        response = self.client.post(
            f"/api/findings/{FINDING_ID}/replies",
            headers={"Authorization": "Bearer second"},
            json={"text": "I see the shift too."},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), THREAD["replies"][0])

    def test_invalid_viewport_missing_finding_and_sql_outage(self):
        response = self.client.get("/api/findings", params={**VIEWPORT, "ra": "NaN"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "invalid_request")
        self.assertEqual(self.client.get(f"/api/findings/{OWNER}").status_code, 404)
        self.upstream.side_effect = httpx.ConnectError("test outage")
        response = self.client.get("/api/findings", params=VIEWPORT)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "findings_unavailable")

    def test_response_fixtures_match_models(self):
        CreatedFinding.model_validate(FIXTURES["create"])
        Finding.model_validate(THREAD)
        Reply.model_validate(THREAD["replies"][0])
        Viewport.model_validate(FIXTURES["pins"])
        Viewport.model_validate(FIXTURES["clusters"])

    def test_text_and_mark_boundaries(self):
        self.assertEqual(self.post_finding(title="t" * 120, note="n" * 2000, marks=THREAD["marks"] * 20).status_code, 201)
        for updates in (
            {"title": "t" * 121}, {"note": "n" * 2001}, {"marks": THREAD["marks"] * 21},
            {"title": " \n "}, {"note": "\t"}, {"title": "a\x00b"},
            {"note": "a\ud800b"}, {"comparisonId": "bad\x00id"},
        ):
            with self.subTest(updates=repr(updates)[:100]):
                # Encode escaped Unicode so the request reaches JSON validation.
                body = {key: THREAD[key] for key in ("comparisonId", "ra", "dec", "title", "note", "marks")}
                response = self.client.post("/api/findings", content=json.dumps({**body, **updates}),
                    headers={"Authorization": "Bearer first", "Content-Type": "application/json"})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["code"], "invalid_request")
        for text, status in (("x" * 2000, 201), ("x" * 2001, 422), (" ", 422), ("a\x00b", 422)):
            response = self.client.post(f"/api/findings/{FINDING_ID}/replies",
                json={"text": text}, headers={"Authorization": "Bearer second"})
            self.assertEqual(response.status_code, status)

    def test_coordinates_and_viewport_boundaries(self):
        for field, value in (("ra", -1), ("ra", 360), ("dec", -91), ("dec", 91), ("ra", True), ("dec", "0")):
            with self.subTest(field=field, value=value):
                self.assertEqual(self.post_finding(**{field: value}).status_code, 422)
        self.assertEqual(self.post_finding(ra=0, dec=-90).status_code, 201)
        self.assertEqual(self.post_finding(ra=359.999, dec=90).status_code, 201)
        for updates in ({"radiusDeg": 0}, {"radiusDeg": 181}, {"zoom": -1}, {"zoom": 31},
                        {"ra": "inf"}, {"dec": "-inf"}, {"radiusDeg": "NaN"}):
            self.assertEqual(self.client.get("/api/findings", params={**VIEWPORT, **updates}).status_code, 422)

    def test_malformed_comparisons_never_write(self):
        for comparison in ([], "bad", {}, {"id": "wrong", "frames": [{"id": "a"}]},
            {"id": "fixture-comparison", "frames": []},
            {"id": "fixture-comparison", "frames": [{}, None]},
            {"id": "fixture-comparison", "frames": [{"id": []}]},
            {"id": "fixture-comparison", "frames": [{"id": "a"}, {"id": "a"}]}):
            with self.subTest(comparison=comparison):
                self.loader.side_effect = None
                self.loader.return_value = comparison
                response = self.post_finding()
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["code"], "comparison_unavailable")
        self.assertTrue(all(call.args[0].url.path == "/auth/v1/user" for call in self.upstream.await_args_list))

    def test_archive_and_auth_failure_are_distinct(self):
        self.loader.side_effect = ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.")
        self.assertEqual(self.post_finding().json()["code"], "comparison_unavailable")
        self.upstream.side_effect = httpx.ConnectError("private upstream details")
        response = self.post_finding()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "auth_unavailable")
        self.assertNotIn("private upstream", response.text)

    def test_malformed_auth_and_anonymous_accounts(self):
        for user in ([], None, {"id": []}, {"id": "invalid"}):
            with self.subTest(user=user):
                self.upstream.side_effect = lambda request: httpx.Response(200, content=json.dumps(user))
                self.assertEqual(self.post_finding().json()["code"], "auth_unavailable")
        self.upstream.side_effect = lambda request: httpx.Response(200, json={"id": OWNER, "is_anonymous": True})
        self.assertEqual(self.post_finding().status_code, 401)
        original = self.supabase_request
        for metadata in ([], "invalid", {"display_name": "bad\x00name"}, {"display_name": "bad\ud800name"}):
            def response(request):
                if request.url.path == "/auth/v1/user":
                    return httpx.Response(200, content=json.dumps({"id": OWNER, "user_metadata": metadata}))
                return original(request)
            self.upstream.side_effect = response
            self.assertEqual(self.post_finding().status_code, 201)
            payload = json.loads(self.upstream.await_args.args[0].content)
            self.assertEqual(payload["author_display_name"], "Sky observer")

    def test_malformed_database_response_is_safe(self):
        self.upstream.side_effect = lambda request: httpx.Response(200, json={"private": "details"})
        response = self.client.get(f"/api/findings/{FINDING_ID}")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "findings_unavailable")
        self.assertNotIn("details", response.text)

    def test_plain_text_is_retained_without_interpreting_html(self):
        text = "<script>alert('test')</script>"
        self.assertEqual(self.post_finding(title=text, note=text).status_code, 201)
        payload = json.loads(self.upstream.await_args.args[0].content)
        self.assertEqual(payload["note"], text)

    def test_openapi_documents_actual_errors(self):
        schema = self.client.get("/openapi.json").json()
        for path, operations in schema["paths"].items():
            for operation in operations.values():
                for code in ("422", "503"):
                    error_schema = operation["responses"][code]["content"]["application/json"]["schema"]
                    self.assertEqual(error_schema["$ref"], "#/components/schemas/ErrorResponse")
