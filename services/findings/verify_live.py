"""Explicitly invoked acceptance check. Creates one finding and one reply.

Only user access tokens are used. No server key is needed or printed.
"""
import asyncio
import os
from urllib.parse import quote
from uuid import UUID, uuid4

import httpx


class CheckFailed(Exception):
    pass


def require(condition, message):
    if not condition:
        raise CheckFailed(message)


def require_public(value):
    if isinstance(value, dict):
        require(all(key not in value for key in ("email", "authorId", "author_id")), "Private account fields were exposed.")
        for child in value.values():
            require_public(child)
    elif isinstance(value, list):
        for child in value:
            require_public(child)


async def verify_accounts(client, supabase_url, publishable_key, first_token, second_token):
    identities = []
    for token in (first_token, second_token):
        response = await client.get(f"{supabase_url.rstrip('/')}/auth/v1/user", headers={
            "apikey": publishable_key, "Authorization": f"Bearer {token}",
        })
        require(response.status_code == 200, "A test account session is invalid or unavailable.")
        profile = response.json()
        require(isinstance(profile, dict) and not profile.get("is_anonymous"), "Use signed-in test accounts.")
        identities.append(str(UUID(profile["id"])))
    require(identities[0] != identities[1], "Supply sessions from two different accounts.")


async def verify_flow(client, comparison_id, ra, dec, first_token, second_token, on_created=None):
    comparison_path = f"/api/comparisons/{quote(comparison_id, safe='')}"
    response = await client.get(comparison_path)
    require(response.status_code == 200, "The saved comparison could not be loaded.")
    comparison = response.json()
    require(isinstance(comparison, dict) and comparison.get("id") == comparison_id, "Saved comparison ID mismatch.")
    frames = comparison.get("frames")
    require(isinstance(frames, list) and len(frames) >= 2, "Choose a saved comparison with at least two frames.")
    body = {"comparisonId": comparison_id, "ra": ra, "dec": dec, "title": "Brief 4 acceptance check",
        "note": "Integration test post; this is a software check, not a scientific finding.",
        "marks": [{"frameId": frames[0]["id"], "ra": ra, "dec": dec}]}
    first = {"Authorization": f"Bearer {first_token}"}
    second = {"Authorization": f"Bearer {second_token}"}
    response = await client.post("/api/findings", json=body)
    require(response.status_code == 401, "Anonymous finding creation was not denied.")
    response = await client.post("/api/findings", json={**body, "comparisonId": str(uuid4())}, headers=first)
    require(response.status_code == 422, "A missing comparison was not rejected.")
    response = await client.post("/api/findings", json=body, headers=first)
    require(response.status_code == 201, "Authenticated finding creation failed.")
    finding_id = str(UUID(response.json()["id"]))
    if on_created:
        on_created(finding_id)
    path = f"/api/findings/{finding_id}"
    response = await client.get(path)
    require(response.status_code == 200, "Anonymous thread read failed.")
    thread = response.json()
    require(thread["comparisonId"] == comparison_id and thread["marks"] == body["marks"], "Evidence references changed.")
    require_public(thread)
    response = await client.post(f"{path}/replies", json={"text": "Anonymous test"})
    require(response.status_code == 401, "Anonymous reply creation was not denied.")
    response = await client.post(f"{path}/replies", json={"text": "Second-account acceptance reply."}, headers=second)
    require(response.status_code == 201, "Second-account reply failed.")
    reply = response.json()
    require_public(reply)
    response = await client.get(path)
    require(response.status_code == 200 and reply in response.json()["replies"], "The saved reply is missing from public reads.")
    require_public(response.json())
    response = await client.get(comparison_path)
    require(response.status_code == 200 and response.json() == comparison, "Posting or replying changed saved image evidence.")
    for zoom in (2, 10):
        response = await client.get("/api/findings", params={"ra": ra, "dec": dec, "radiusDeg": 1, "zoom": zoom})
        require(response.status_code == 200 and len(response.json()["items"]) <= 100, "Viewport query failed or exceeded its limit.")
        items = response.json()["items"]
        if zoom == 10:
            pin = next((item for item in items if item.get("id") == finding_id), None)
            require(pin is not None, "The new finding is missing from map pins.")
            require(bool(pin.get("authorDisplayName")) and bool(pin.get("createdAtUtc")) and pin.get("replyCount", 0) >= 1
                    and pin.get("survey") in ("spherex", "wise"), "The map pin is missing its author, time, reply count or survey.")
        else:
            require(any(item.get("count", 0) > 0 and item.get("zoomTo", 0) >= 8 for item in items), "The map activity clusters are missing.")
    return finding_id


async def main():
    names = ("SPHEREX_SMOKE_BASE_URL", "SPHEREX_SMOKE_COMPARISON_ID", "SPHEREX_SMOKE_RA", "SPHEREX_SMOKE_DEC",
        "SPHEREX_SMOKE_TOKEN_A", "SPHEREX_SMOKE_TOKEN_B", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")
    missing = [name for name in names if not os.environ.get(name, "").strip()]
    if missing:
        raise CheckFailed("Missing configuration: " + ", ".join(missing))
    first, second = os.environ["SPHEREX_SMOKE_TOKEN_A"], os.environ["SPHEREX_SMOKE_TOKEN_B"]
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as auth_client:
        await verify_accounts(auth_client, os.environ["SUPABASE_URL"], os.environ["SUPABASE_PUBLISHABLE_KEY"], first, second)
    async with httpx.AsyncClient(base_url=os.environ["SPHEREX_SMOKE_BASE_URL"].rstrip("/"), timeout=30, follow_redirects=False) as client:
        await verify_flow(client, os.environ["SPHEREX_SMOKE_COMPARISON_ID"],
            float(os.environ["SPHEREX_SMOKE_RA"]), float(os.environ["SPHEREX_SMOKE_DEC"]), first, second,
            on_created=lambda identifier: print(f"Created test finding: {identifier}. Hide it using the coordinator's moderation SQL after review."))
    print("PASS: public reads, signed-out denial, evidence references, second-account reply and unchanged saved manifest.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except CheckFailed as error:
        raise SystemExit(str(error)) from None
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        raise SystemExit("Check failed: service response or configuration is invalid. No credentials are printed.") from None
