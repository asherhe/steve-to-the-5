import { useState } from "react";
import { createRoot } from "react-dom/client";

import { SourceInspector } from "../SourceInspector";
import "../SourceInspector.css";
import { makeFixtureClient, states } from "../fixtures";
import type { MarkAction, SelectedFrameMeta } from "../types";

// Standalone harness. NOT the app shell: it exists to drive the inspector in isolation with
// fixture data and stub callbacks. The real map panel is wired by the coordinator.

const client = makeFixtureClient();

const demoFrame: SelectedFrameMeta = {
  frameId: "frame-qr3-2026-03-14",
  observedAtUtc: "2026-03-14T09:21:00Z",
  wavelengthUm: 1.62,
};

function Harness() {
  const [marks, setMarks] = useState<MarkAction[]>([]);
  const [withFrame, setWithFrame] = useState(true);
  const [mode, setMode] = useState<keyof typeof states | "live">("matched");

  const onMark = (m: MarkAction) => setMarks((prev) => [m, ...prev]);

  return (
    <div style={{ display: "flex", gap: 24, padding: 24, color: "#cfd8e3" }}>
      <div>
        <h3>Controls</h3>
        <label style={{ display: "block", marginBottom: 8 }}>
          State:{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {Object.keys(states).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="live">live (fixture client)</option>
          </select>
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={withFrame}
            onChange={(e) => setWithFrame(e.target.checked)}
          />{" "}
          selected frame (enables predicted position)
        </label>
        <h4>Emitted marks</h4>
        <pre style={{ fontSize: 12, maxWidth: 360, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(marks, null, 2)}
        </pre>
      </div>
      <div>
        <SourceInspector
          client={client}
          skyPosition={mode === "live" ? { ra: 269.45207, dec: 4.66829 } : null}
          selectedFrame={withFrame ? demoFrame : null}
          onMark={onMark}
          initialState={mode === "live" ? undefined : states[mode]}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
