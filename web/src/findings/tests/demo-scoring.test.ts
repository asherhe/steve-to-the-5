// The local demo takes its points from the local findings service in demo mode, so the
// 20-point brightness rule is reachable without Supabase. Without that service it falls back.
import { afterEach, describe, expect, it, vi } from "vitest";
import flow from "../../../../services/findings/fixtures/point-flow.json";
import { mockFindings } from "../mock";
import { FindingsApiError } from "../api";

const point = { ra: flow.uncatalogued.ra, dec: flow.uncatalogued.dec, radiusArcsec: flow.uncatalogued.radiusArcsec };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stub(scoring: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/findings/demo/points/review") return scoring();
    throw new TypeError("Failed to fetch"); // catalog service not running in tests
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("local demo scoring", () => {
  it("uses the local service's score, so 20 points are possible", async () => {
    const fetch = stub(() => json(flow.uncatalogued));
    const result = await mockFindings.pointReview(point);
    expect(result.score).toBe(20);
    expect(result.classification).toBe("uncatalogued");
    expect(result.brightness?.length).toBeGreaterThan(0);
    const [, init] = fetch.mock.calls.find(([url]) => String(url) === "/api/findings/demo/points/review")!;
    expect(JSON.parse(String(init?.body))).toMatchObject(point);
  });

  it("falls back to a catalog-only simulation that says why, when the service is not running", async () => {
    stub(() => { throw new TypeError("Failed to fetch"); });
    const result = await mockFindings.pointReview(point);
    expect(result.score).toBe(0);
    expect(result.reasons[0]).toMatch(/local scoring service is not running/);
    expect(result.reasons[0]).toMatch(/npm run dev:findings/);
  });

  it("falls back when only the live service (no demo route) or a proxy error answers", async () => {
    for (const response of [json({ detail: "Not Found" }, 404), new Response("Bad gateway", { status: 502 })]) {
      stub(() => response);
      const result = await mockFindings.pointReview(point);
      expect(result.reasons[0]).toMatch(/not running/);
    }
  });

  it("passes on a structured refusal from the service instead of falling back", async () => {
    stub(() => json({ code: "not_real_evidence", message: "Points need real observations; synthetic data cannot earn points." }, 422));
    const error = await mockFindings.pointReview(point).catch(e => e);
    expect(error).toBeInstanceOf(FindingsApiError);
    expect(error.code).toBe("not_real_evidence");
  });

  it("rejects a response for a different point", async () => {
    stub(() => json({ ...flow.uncatalogued, ra: flow.uncatalogued.ra + 1 }));
    const error = await mockFindings.pointReview(point).catch(e => e);
    expect(error.code).toBe("invalid_response");
  });
});
