import { useMemo, useState } from "react";
import { Viewer, type ViewerControlsProps } from "../Viewer";
import { SourceInspector, type SourceInspectorProps } from "../../inspector";
import { FixtureDiscussion } from "./EvidenceDiscussion";
import { fixtureDataSource, loadFixtureFinding, savedFixtureId, type Scenario } from "./fixtures";
import { targetPresets } from "../coordinates";

const fixtureCatalog = {
  async nearby() { return { sources: [] }; },
  async detail() { throw new Error("No fixture catalog source selected."); },
  async resolve() { throw new Error("Name resolution uses the fixture viewer adapter."); },
};
function Inspector(props: Omit<SourceInspectorProps, "client">) {
  return <SourceInspector {...props} client={fixtureCatalog} />;
}
const labels: Record<Scenario, string> = {
  ready: "Matched pair", single_epoch: "Single epoch", no_coverage: "No coverage",
  no_comparable_pair: "No comparable pair", upstream_unavailable: "Archive unavailable",
};

export function FixtureHarness() {
  const [scenario, setScenario] = useState<Scenario>("ready");
  const source = useMemo(() => fixtureDataSource(scenario), [scenario]);
  // A stable component type preserves control focus when the scenario changes.
  const Controls = useMemo(() => function Controls(props: ViewerControlsProps) {
    return <div className="controls">
      <label>Archive response<select defaultValue="ready" onChange={event => {
        setScenario(event.target.value as Scenario);
        props.onSearch({ ...targetPresets[0], fovArcmin: 6 });
      }}>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button onClick={() => props.onLoadSaved(savedFixtureId)}>Open saved fixture</button>
      <button onClick={() => props.onLoadSaved(savedFixtureId, "fixture-finding")}>Open fixture finding</button>
      <button onClick={() => props.onLoadSaved("fixture-single-epoch", "fixture-finding")}>Try mismatched evidence</button>
      <button onClick={() => props.onLoadSaved(savedFixtureId, "missing-finding")}>Try missing finding</button>
      <button onClick={() => props.onLoadSaved("missing-fixture")}>Try missing ID</button>
      <button onClick={props.onReset}>Back to search</button>
    </div>;
  }, []);
  return <Viewer dataSource={source} Inspector={Inspector} Discussion={FixtureDiscussion}
    loadFinding={loadFixtureFinding} Controls={Controls} savedExampleId={savedFixtureId} synthetic />;
}
