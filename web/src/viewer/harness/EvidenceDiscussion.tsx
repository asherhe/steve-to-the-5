import type { EvidenceDiscussionProps } from "../evidence";

export function FixtureDiscussion({ finding, onShowEvidence, onCopyLink }: EvidenceDiscussionProps) {
  return <section aria-label="Fixture discussion">
    <h3>{finding.title}</h3>
    <p>Development discussion fixture · synthetic evidence · anonymous read</p>
    <p>{finding.note}</p>
    <p>Saved comparison: {finding.comparisonId} · {finding.marks.length} frame-specific marks</p>
    <div className="controls">
      <button type="button" onClick={() => onShowEvidence(finding)}>Show evidence</button>
      <button type="button" onClick={() => onCopyLink(finding)}>Copy link</button>
    </div>
  </section>;
}
