// Local demo point reviews on frames that are not among the bundled examples, such as a
// WISE time-lapse frame. The demo must take the frame's real observation time from its saved
// comparison, as the findings service does, instead of refusing the frame.
import { afterEach, describe, expect, it, vi } from "vitest";
import saved from "../../../../fixtures/archive/real-barnard/response.json";
import { mockFindings } from "../mock";
import { FindingsApiError } from "../api";

const WISE_ID = "a".repeat(64);
const wiseSaved = { ...saved, comparison: { ...saved.comparison, id: WISE_ID } };
const frame = wiseSaved.comparison.frames[1];

function stubNetwork(comparison: (url: string) => Response) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/wise/comparisons/") || url.includes("/api/comparisons/")) return comparison(url);
    // The catalog service is not running in tests; the demo then reports catalogs as unchecked.
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const review = (ref: { comparisonId: string; frameId: string; survey: "spherex" | "wise" }) =>
  mockFindings.pointReview({ ra: wiseSaved.comparison.field.ra, dec: wiseSaved.comparison.field.dec, radiusArcsec: 30, frame: ref });

afterEach(() => vi.unstubAllGlobals());

describe("local demo frame lookup", () => {
  it("takes a WISE frame's observation time from its saved comparison", async () => {
    const fetch = stubNetwork(() => json(wiseSaved));
    const result = await review({ comparisonId: WISE_ID, frameId: frame.id, survey: "wise" });
    expect(result.observedAtUtc).toBe(frame.observedAtUtc);
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(`/api/wise/comparisons/${WISE_ID}`);
  });

  it("still answers bundled examples without any request", async () => {
    const fetch = stubNetwork(() => { throw new Error("must not load bundled examples"); });
    const result = await review({ comparisonId: saved.comparison.id, frameId: saved.comparison.frames[0].id, survey: "spherex" });
    expect(result.observedAtUtc).toBe(saved.comparison.frames[0].observedAtUtc);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/comparisons/"))).toBe(false);
  });

  it.each([
    ["an unknown frame", () => json(wiseSaved), "bogus-frame", "invalid_frame"],
    ["a missing comparison", () => json({ code: "NOT_FOUND", message: "Unknown comparison ID" }, 404), frame.id, "invalid_frame"],
    ["synthetic evidence", () => json({ ...wiseSaved, comparison: { ...wiseSaved.comparison, provenance: { ...wiseSaved.comparison.provenance, evidenceKind: "synthetic_fixture" } } }), frame.id, "not_real_evidence"],
    ["the service being down", () => json({ code: "UPSTREAM_ERROR", message: "down" }, 503), frame.id, "comparison_unavailable"],
  ])("refuses %s with a specific reason", async (_label, respond, frameId, code) => {
    stubNetwork(respond);
    const error = await review({ comparisonId: WISE_ID, frameId, survey: "wise" }).catch(e => e);
    expect(error).toBeInstanceOf(FindingsApiError);
    expect(error.code).toBe(code);
    expect(error.message).not.toMatch(/demo frame is unavailable/i);
  });
});
