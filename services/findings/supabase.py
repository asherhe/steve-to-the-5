from dataclasses import dataclass
from uuid import UUID

import httpx


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Author:
    id: str
    display_name: str


class Supabase:
    def __init__(
        self, client: httpx.AsyncClient, url: str, publishable_key: str, server_key: str
    ):
        self.client = client
        self.url = url.rstrip("/")
        self.publishable_key = publishable_key
        self.server_headers = {"apikey": server_key}
        if server_key.startswith("eyJ"):
            self.server_headers["Authorization"] = f"Bearer {server_key}"

    async def user(self, token: str) -> Author:
        try:
            response = await self.client.get(
                f"{self.url}/auth/v1/user",
                headers={"apikey": self.publishable_key, "Authorization": f"Bearer {token}"},
            )
            if response.status_code in (401, 403):
                raise ApiError(401, "unauthorized", "Sign in to post or reply.")
            response.raise_for_status()
            user = response.json()
            if not isinstance(user, dict) or not isinstance(user.get("id"), str):
                raise ValueError("Invalid auth response")
            user_id = str(UUID(user["id"]))
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as error:
            raise ApiError(503, "auth_unavailable", "Sign-in verification is unavailable.") from error

        if user.get("is_anonymous"):
            raise ApiError(401, "unauthorized", "Sign in to post or reply.")
        metadata = user.get("user_metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        display_name = metadata.get("display_name") or metadata.get("full_name")
        if isinstance(display_name, str) and not any(
            char == "@" or char == "\x00" or 0xD800 <= ord(char) <= 0xDFFF for char in display_name
        ):
            display_name = " ".join(display_name.split())[:80]
        else:
            display_name = ""
        return Author(user_id, display_name or "Sky observer")

    async def rpc(self, name: str, payload: dict):
        return await self.request("POST", f"rpc/{name}", json=payload)

    async def request(self, method: str, endpoint: str, **kwargs):
        try:
            response = await self.client.request(
                method, f"{self.url}/rest/v1/{endpoint}", headers=self.server_headers, **kwargs
            )
            response.raise_for_status()
            return response.json() if response.content else None
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(503, "findings_unavailable", "Findings are temporarily unavailable.") from error
