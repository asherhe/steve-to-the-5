import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CheckChain } from "../CheckChain";
import { CatalogApiError, createCatalogClient } from "../api";
import type { ChainStep, CheckChainResponse } from "../types";

function step(id: string, status: ChainStep["status"], extra: Partial<ChainStep> = {}): ChainStep {
  return {
    id, label: id, catalog: id, status, matchCount: 0, matches: [],
    message: `${id} message`, referenceUrl: null, ...extra,
  };
}

function response(over: Partial<CheckChainResponse> = {}): CheckChainResponse {
  return {
    ra: 10, dec: 5, radiusArcsec: 10, epochUtc: "2025-04-15T06:00:00Z", epochKind: "observation",
    mode: "live", checkedAtUtc: "2026-11-15T00:00:00Z", verdict: "catalogued",
    verdictMessage: "Already catalogued: SIMBAD lists a source at this position.",
    steps: [
      step("Gaia DR3", "no_match"),
      step("SIMBAD", "match", {
        matchCount: 7,
        matches: [{ name: "Test star", ra: 10, dec: 5, separationArcsec: 1.23, positionPredicted: true, detail: "type PM*", url: null }],
      }),
      step("SkyBoT", "unavailable"),
    ],
    ...over,
  };
}

const point = { ra: 10, dec: 5, epochUtc: "2025-04-15T06:00:00Z", epochKind: "observation" as const };

describe("CheckChain", () => {
  it("renders nothing until a point is confirmed", () => {
    const checkChain = vi.fn();
    const { container } = render(<CheckChain request={null} client={{ checkChain }} />);
    expect(container).toBeEmptyDOMElement();
    expect(checkChain).not.toHaveBeenCalled();
  });

  it("shows the verdict and every step in chain order", async () => {
    const checkChain = vi.fn().mockResolvedValue(response());
    render(<CheckChain request={point} client={{ checkChain }} />);
    expect(await screen.findByText("Already catalogued")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").filter((li) => li.classList.contains("cc-step"));
    expect(items.map((li) => li.querySelector(".cc-step__label")?.textContent)).toEqual(["Gaia DR3", "SIMBAD", "SkyBoT"]);
    expect(within(items[1]).getByText("Listed")).toBeInTheDocument();
    expect(within(items[1]).getByText(/1\.2″ · predicted position · type PM\*/)).toBeInTheDocument();
    expect(within(items[1]).getByText("+6 more")).toBeInTheDocument();
    expect(within(items[2]).getByText("Not checked")).toBeInTheDocument();
    expect(checkChain).toHaveBeenCalledWith(point, expect.any(AbortSignal));
  });

  it("refuses synthetic results when a live catalog is required", async () => {
    const checkChain = vi.fn().mockResolvedValue(response({ mode: "fixture" }));
    render(<CheckChain request={point} client={{ checkChain }} requireLiveCatalog />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/synthetic test data/);
  });

  it("labels synthetic results when allowed", async () => {
    const checkChain = vi.fn().mockResolvedValue(response({ mode: "fixture" }));
    render(<CheckChain request={point} client={{ checkChain }} />);
    expect(await screen.findByText(/not real catalog results/)).toBeInTheDocument();
  });

  it("reports a service error", async () => {
    const checkChain = vi.fn().mockRejectedValue(new CatalogApiError({ code: "invalid_request", message: "radiusArcsec too large" }));
    render(<CheckChain request={point} client={{ checkChain }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("radiusArcsec too large");
  });
});

describe("catalog client checkChain", () => {
  it("builds the query string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response()), { headers: { "content-type": "application/json" } }),
    );
    await createCatalogClient({ fetchImpl }).checkChain({ ...point, radiusArcsec: 12 });
    const url = new URL(fetchImpl.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/api/catalogs/check-chain");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ra: "10", dec: "5", radiusArcsec: "12", epochUtc: point.epochUtc, epochKind: "observation",
    });
  });
});
