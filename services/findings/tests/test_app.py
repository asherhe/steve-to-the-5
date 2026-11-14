import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from services.findings.main import create_app
from test_findings import FIXTURES, OWNER


SETTINGS = {
    "SUPABASE_URL": "https://supabase.example",
    "SUPABASE_PUBLISHABLE_KEY": "public-key",
    "SUPABASE_SERVER_KEY": "server-key",
    "SPHEREX_COMPARISON_BASE_URL": "https://archive.example/",
}


class StandaloneAppTest(unittest.TestCase):
    def setUp(self):
        self.archive_response = httpx.Response(200, json=FIXTURES["comparison"])
        self.requests = []

        def upstream(request):
            self.requests.append(request)
            if request.url.host == "archive.example":
                self.assertNotIn("authorization", request.headers)
                self.assertNotIn("apikey", request.headers)
                if isinstance(self.archive_response, Exception):
                    raise self.archive_response
                return self.archive_response
            if request.url.path == "/auth/v1/user":
                return httpx.Response(200, json={"id": OWNER})
            return httpx.Response(201)

        self.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        with patch.dict(os.environ, SETTINGS), patch("services.findings.main.httpx.AsyncClient", return_value=self.http):
            self.app = create_app()

    def post(self, client, comparison_id="fixture-comparison"):
        return client.post("/api/findings", json={"comparisonId": comparison_id, "ra": 0, "dec": 0,
            "title": "Check", "note": "Question about these frames"}, headers={"Authorization": "Bearer first"})

    def test_factory_uses_saved_lookup_and_closes_client(self):
        with TestClient(self.app) as client:
            self.assertEqual(self.post(client).status_code, 201)
            archive = [r for r in self.requests if r.url.host == "archive.example"]
            self.assertEqual([r.url.path for r in archive], ["/api/comparisons/fixture-comparison"])
        self.assertTrue(self.http.is_closed)

    def test_missing_unavailable_and_malformed_archive(self):
        with TestClient(self.app) as client:
            for response, status, code in (
                (httpx.Response(404), 422, "invalid_comparison"),
                (httpx.Response(500), 503, "comparison_unavailable"),
                (httpx.Response(200, text="not JSON"), 503, "comparison_unavailable"),
                (httpx.Response(302, headers={"location": "https://other.example"}), 503, "comparison_unavailable"),
                (httpx.ReadTimeout("private timeout detail"), 503, "comparison_unavailable"),
            ):
                self.archive_response = response
                result = self.post(client)
                self.assertEqual(result.status_code, status)
                self.assertEqual(result.json()["code"], code)

    def test_comparison_ids_cannot_change_the_lookup_path(self):
        with TestClient(self.app) as client:
            for identifier in (".", "..", "../another", "foo/bar", "foo\\bar"):
                self.assertEqual(self.post(client, identifier).status_code, 422)
            self.assertFalse(any(r.url.host == "archive.example" for r in self.requests))
            identifier = "saved?id#fragment"
            self.archive_response = httpx.Response(200, json={"id": identifier, "frames": [{"id": "frame"}]})
            self.assertEqual(self.post(client, identifier).status_code, 201)
            archive = [r for r in self.requests if r.url.host == "archive.example"][-1]
            self.assertEqual(archive.url.query, b"")
            self.assertEqual(archive.url.fragment, "")
            self.assertIn(b"saved%3Fid%23fragment", archive.url.raw_path)

    def test_missing_configuration_lists_names_only(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "Missing server configuration: SUPABASE_URL"):
                create_app()
