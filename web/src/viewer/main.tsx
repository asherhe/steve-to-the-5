import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { SourceInspector, createCatalogClient } from "../inspector";
import { Viewer } from "./Viewer";
import { createViewerDataSource } from "./production";
import { createPlaceholderLeaderboard } from "../leaderboard";
import retainedExample from "../../../fixtures/archive/real/response.json";

const dataSource = createViewerDataSource();
const catalogClient = createCatalogClient();
// Placeholder until a scoring system exists; see docs/engagement-social-integration.md.
const leaderboard = createPlaceholderLeaderboard();
function Inspector(props: Omit<ComponentProps<typeof SourceInspector>, "client">) {
  return <SourceInspector {...props} client={catalogClient} />;
}
const root = document.getElementById("root");
if (!root) throw new Error("Viewer root is missing.");
const app = createRoot(root);
if (import.meta.env.DEV && new URLSearchParams(location.search).get("fixtures") === "1") {
  const { FixtureHarness } = await import("./harness/main");
  app.render(<FixtureHarness />);
} else {
  app.render(<Viewer dataSource={dataSource} Inspector={Inspector} leaderboard={leaderboard} savedExampleId={retainedExample.comparison.id} />);
}
