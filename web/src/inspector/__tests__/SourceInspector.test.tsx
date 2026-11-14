import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SourceInspector } from "../SourceInspector";
import { ambiguousSources, knownSource, makeFixtureClient, states } from "../fixtures";
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
      screen.getByRole("button", { name: /mark predicted position on frame/i })
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
    expect(mark.ra).toBeCloseTo(expected.ra, 9);
    expect(mark.dec).toBeCloseTo(expected.dec, 9);
    // Predicted differs from observed (Barnard's Star has large proper motion).
    expect(mark.dec).not.toBeCloseTo(knownSource.dec, 4);
  });
});

describe("self-fetching flow", () => {
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
