import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceInspector } from "../SourceInspector";
import { createCatalogClient } from "../api";
import { ambiguousSources, knownDetail, knownSource, makeFixtureClient, states } from "../fixtures";
import { isoToDecimalYear, propagate } from "../propagate";
import type { MarkAction } from "../types";

const client = makeFixtureClient();
const noMark = () => undefined;

describe("SourceInspector render states", () => {
  it("renders the idle state", () => {
    render(
      <SourceInspector client={client} skyPosition={null} onMark={noMark} initialState={states.idle} />
    );
    expect(screen.getByText(/select a point on the sky/i)).toBeInTheDocument();
  });

  it("renders the unmatched state as a valid empty result", () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={null}
        onMark={noMark}
        initialState={states.unmatched}
      />
    );
    expect(screen.getByText(/no catalog source here/i)).toBeInTheDocument();
    expect(screen.getByText(/not a service error/i)).toBeInTheDocument();
  });

  it("renders the unavailable state with the error code", () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={null}
        onMark={noMark}
        initialState={states.unavailable}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
    expect(screen.getByText(/upstream_unavailable/)).toBeInTheDocument();
  });

  it("renders the ambiguous state with all candidates", () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={null}
        onMark={noMark}
        initialState={states.ambiguous}
      />
    );
    expect(screen.getByText(/multiple nearby sources/i)).toBeInTheDocument();
    for (const s of ambiguousSources) {
      expect(screen.getByText(s.sourceId)).toBeInTheDocument();
    }
  });

  it("renders a matched source with units and provenance", () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={null}
        onMark={noMark}
        initialState={states.matched}
      />
    );
    expect(screen.getByText(knownSource.sourceId)).toBeInTheDocument();
    expect(screen.getAllByText(/mas\/yr/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Gaia DR3/).length).toBeGreaterThan(0);
  });
});

describe("mark action", () => {
  it("emits observed coordinates when no frame is selected", async () => {
    const onMark = vi.fn<(m: MarkAction) => void>();
    render(
      <SourceInspector
        client={client}
        skyPosition={null}
        onMark={onMark}
        initialState={states.matched}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /mark position/i }));
    expect(onMark).toHaveBeenCalledTimes(1);
    const mark = onMark.mock.calls[0][0];
    expect(mark.frameId).toBeNull();
    expect(mark.predicted).toBe(false);
    expect(mark.ra).toBeCloseTo(knownSource.ra, 6);
    expect(mark.dec).toBeCloseTo(knownSource.dec, 6);
    expect(mark.sourceId).toBe(knownSource.sourceId);
  });

  it("emits a predicted position labelled predicted when a frame is selected", async () => {
    const onMark = vi.fn<(m: MarkAction) => void>();
    const frame = {
      frameId: "frame-qr3-2026-03-14",
      observedAtUtc: "2026-03-14T09:21:00Z",
      wavelengthUm: 1.62,
    };
    render(
      <SourceInspector
        client={client}
        skyPosition={null}
        selectedFrame={frame}
        onMark={onMark}
        initialState={states.matched}
      />
    );

    // The predicted section is shown and labelled.
    expect(
      screen.getByRole("heading", { name: /predicted position/i })
    ).toBeInTheDocument();
    expect(screen.getByText("predicted")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /mark predicted position/i })
    );
    const mark = onMark.mock.calls[0][0];
    const expected = propagate(
      knownSource.ra,
      knownSource.dec,
      knownSource.refEpoch,
      isoToDecimalYear(frame.observedAtUtc),
      knownSource.pmRaCosDecMasYr,
      knownSource.pmDecMasYr
    );
    expect(mark.frameId).toBe(frame.frameId);
    expect(mark.predicted).toBe(true);
    expect(mark.astrometry).toMatchObject({
      sourceId: knownSource.sourceId,
      ra: knownSource.ra,
      dec: knownSource.dec,
      refEpoch: knownSource.refEpoch,
      pmRaCosDecMasYr: knownSource.pmRaCosDecMasYr,
      pmDecMasYr: knownSource.pmDecMasYr,
    });
    expect(mark.ra).toBeCloseTo(expected.ra, 9);
    expect(mark.dec).toBeCloseTo(expected.dec, 9);
    // Predicted differs from observed (Barnard's Star has large proper motion).
    expect(mark.dec).not.toBeCloseTo(knownSource.dec, 4);
  });
});

describe("self-fetching flow", () => {
  it("finds Barnard's Star on the mosaic using its propagated position", async () => {
    const source = {
      ...knownSource,
      ra: 269.44850252543836,
      dec: 4.739420051112412,
      pmRaCosDecMasYr: -801.5509783684709,
      pmDecMasYr: 10362.394206546573,
    };
    const center = { ra: 269.44630202, dec: 4.76777074 };
    const nearby = vi.fn().mockResolvedValue({ catalogMode: "live", sources: [
      { ...source, sourceId: "42", pmRaCosDecMasYr: 0, pmDecMasYr: 0 },
    ] });
    const detail = vi.fn().mockResolvedValue({ ...knownDetail, ...source });
    const onMark = vi.fn();
    render(
      <SourceInspector
        client={{ ...client, nearby, detail }}
        skyPosition={center}
        mosaicGuideTimeUtc="2025-11-07T00:00:00Z"
        mosaicGuideSourceId={source.sourceId}
        requireLiveCatalog
        onMark={onMark}
      />
    );
    await userEvent.click(await screen.findByRole("button", { name: /mark approximate mosaic position/i }));
    expect(nearby).toHaveBeenCalledWith(center.ra, center.dec, 150);
    expect(detail).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledWith(source.sourceId);
    const mark = onMark.mock.calls[0][0] as MarkAction;
    expect(mark).toMatchObject({ sourceId: source.sourceId, frameId: null, predicted: true });
    expect(mark.ra).toBeCloseTo(center.ra, 6);
    expect(mark.dec).toBeCloseTo(center.dec, 6);
    expect(screen.getByText(/mosaic combines many exposure dates/i)).toBeInTheDocument();
  });

  it.each([
    [{ "X-SPHEREx-Catalog-Mode": "fixture" }, /synthetic test data/i],
    [{}, /did not report its data mode/i],
  ] as const)("blocks unverified catalog markers with headers %j", async (headers, message) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ sources: [knownSource] }, { headers })
    );
    render(
      <SourceInspector
        client={createCatalogClient({ fetchImpl })}
        skyPosition={{ ra: knownSource.ra, dec: knownSource.dec }}
        requireLiveCatalog
        onMark={noMark}
      />
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: /mark/i })).not.toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches, matches a single source and loads detail", async () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={{ ra: knownSource.ra, dec: knownSource.dec }}
        onMark={noMark}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(knownSource.sourceId)).toBeInTheDocument()
    );
    // Detail enrichment (radial velocity) appears after the detail fetch resolves.
    await waitFor(() =>
      expect(screen.getByText(/km\/s/)).toBeInTheDocument()
    );
  });

  it("shows the unavailable state when the service fails", async () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={{ ra: 359.999, dec: 89.999 }}
        onMark={noMark}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("shows the unmatched state for an empty cone search", async () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={{ ra: 10, dec: 10 }}
        onMark={noMark}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/no catalog source here/i)).toBeInTheDocument()
    );
  });

  it("lets the user pick one source from an ambiguous result", async () => {
    render(
      <SourceInspector
        client={client}
        skyPosition={{ ra: ambiguousSources[0].ra, dec: ambiguousSources[0].dec }}
        onMark={noMark}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/multiple nearby sources/i)).toBeInTheDocument()
    );
    const list = screen.getByRole("list");
    await userEvent.click(within(list).getByText(ambiguousSources[0].sourceId));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /mark/i })).toBeInTheDocument()
    );
  });
});


describe("identity enrichment is independent of spatial selection", () => {
  it("keeps an unassociated candidate labeled by Gaia ID", () => {
    render(<SourceInspector client={client} skyPosition={null} onMark={noMark} initialState={states.matched} />);
    expect(screen.getByText(knownSource.sourceId)).toBeInTheDocument();
    expect(screen.getByText(/association with the requested target is unverified/i)).toBeInTheDocument();
    expect(screen.queryByText("Barnard’s Star")).not.toBeInTheDocument();
  });

  it("shows verified names without removing IDs or claiming image detection", async () => {
    const { namedTargets } = await import("../../viewer/targetNames");
    const identity = namedTargets[0].identity!;
    render(<SourceInspector client={client} skyPosition={null} onMark={noMark}
      initialState={{ kind: "matched", source: { ...knownSource, identity }, detail: null }} />);
    expect(screen.getByText("Barnard’s Star")).toBeInTheDocument();
    expect(screen.getByText(knownSource.sourceId)).toBeInTheDocument();
    expect(screen.getByText(/image detection is not established/i)).toBeInTheDocument();
  });

  it("does not call missing proper motion a frame-time prediction", () => {
    render(<SourceInspector client={client} skyPosition={null} onMark={noMark}
      selectedFrame={{frameId:"frame",observedAtUtc:"2026-01-01T00:00:00Z"}}
      initialState={{kind:"matched",source:{...knownSource,pmDecMasYr:null},detail:null}} />);
    expect(screen.queryByRole("heading",{name:/predicted position/i})).not.toBeInTheDocument();
    expect(screen.getByText(/frame-time prediction unavailable/i)).toBeInTheDocument();
  });
});


describe("component-specific verified labels", () => {
  it("labels the Gaia Ba source without labeling it as the entire B pair", async () => {
    const { default: identities } = await import("../../../../fixtures/catalogs/source-identities.json");
    const identity = identities[0];
    render(<SourceInspector client={client} skyPosition={null} onMark={noMark}
      initialState={{kind:"matched",source:{...knownSource,sourceId:"6412596012146801152",identity},detail:null}} />);
    expect(screen.getByText("Epsilon Indi Ba")).toBeInTheDocument();
    expect(screen.getByText("6412596012146801152")).toBeInTheDocument();
    expect(screen.queryByText("Epsilon Indi B",{exact:true})).not.toBeInTheDocument();
  });
});

describe("summary card and detail sections", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderState(state: (typeof states)[keyof typeof states]) {
    return render(<SourceInspector client={client} skyPosition={null} onMark={noMark} initialState={state} />);
  }

  it("summarises the known source in plain words", () => {
    renderState(states.matched);
    expect(screen.getByRole("heading", { name: "Gaia DR3 source" })).toBeInTheDocument();
    expect(screen.getByText("…2575872")).toBeInTheDocument();
    expect(screen.getByText(/Bright · G 8\.19/)).toBeInTheDocument();
    expect(screen.getByText(/Red · BP−RP 3\.01/)).toBeInTheDocument();
    expect(screen.getByText(/5\.96 light-years \(1\.83 pc\)/)).toBeInTheDocument();
    expect(screen.getByText(/10\.4″ per year, heading N/)).toBeInTheDocument();
    expect(screen.getByText("Fast mover")).toBeInTheDocument();
    expect(screen.getByText(/0\.42″ from the selected point/)).toBeInTheDocument();
    expect(screen.getByText(/not from SPHEREx images/)).toBeInTheDocument();
  });

  it("omits colour and hedges distance while detail is missing", () => {
    renderState({ kind: "matched", source: knownSource, detail: null });
    expect(screen.queryByText(/BP−RP/)).not.toBeInTheDocument();
    expect(screen.getByText(/About 5\.96 light-years/)).toBeInTheDocument();
  });

  it("does not state a distance or dashes for an unmeasured parallax", () => {
    renderState({ kind: "matched", source: ambiguousSources[2], detail: null });
    expect(screen.getByText(/Distance too uncertain to state/)).toBeInTheDocument();
    expect(screen.getByText("not measured")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  // jsdom does not emulate keyboard activation of <summary>; that is checked in a browser.
  it("keeps raw values in sections that start collapsed and open on activation", async () => {
    const { container } = renderState(states.matched);
    const sections = [...container.querySelectorAll("details")];
    expect(sections.map((section) => section.querySelector("summary")?.textContent)).toEqual([
      "Position", "Motion", "Photometry", "Identifiers & links",
    ]);
    expect(sections.every((section) => !section.open)).toBe(true);
    await userEvent.click(sections[0].querySelector("summary")!);
    expect(sections[0].open).toBe(true);
  });

  it("explains a term when its hint is toggled", async () => {
    renderState(states.matched);
    const hint = screen.getByRole("button", { name: 'What does "Distance from parallax" mean?' });
    expect(hint).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(hint);
    expect(hint).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Computed from Gaia's parallax/)).toBeVisible();
  });

  it("copies the source ID and the full text export", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderState(states.matched);
    await userEvent.click(screen.getByRole("button", { name: "Copy ID" }));
    expect(writeText).toHaveBeenLastCalledWith(knownSource.sourceId);
    await userEvent.click(screen.getByRole("button", { name: "Copy all as text" }));
    expect(writeText.mock.lastCall?.[0]).toContain("Parallax: 546.976 ± 0.040 mas");
    expect(screen.getByRole("status")).toHaveTextContent("All values copied.");
  });

  it("lists candidates nearest first and marks the brightest", () => {
    const shuffled = [ambiguousSources[2], ambiguousSources[0], ambiguousSources[1]];
    renderState({ kind: "ambiguous", sources: shuffled });
    const rows = within(screen.getByRole("list")).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("1.11″ away"), expect.stringContaining("1.63″ away"), expect.stringContaining("2.04″ away"),
    ]);
    expect(rows[0]).toHaveTextContent("Very faint · G 18.43");
    expect(within(rows[0]).getByText("Brightest")).toBeInTheDocument();
    expect(screen.getAllByText("Brightest")).toHaveLength(1);
  });
});
