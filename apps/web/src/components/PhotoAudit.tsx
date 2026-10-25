import type { Diagnostic, Graph } from "@doodleforge/ir";

type PhotoAuditProps = {
  graph: Graph;
  findings: Diagnostic[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedFindingId: string | null;
  sourceImageUrl: string;
  onSelectFinding(finding: Diagnostic): void;
};

export function PhotoAudit({
  graph,
  findings,
  selectedNodeId,
  selectedEdgeId,
  selectedFindingId,
  sourceImageUrl,
  onSelectFinding,
}: PhotoAuditProps) {
  const monthlyBudget = typeof graph.constraints.monthly_budget_usd === "number" ? graph.constraints.monthly_budget_usd : null;
  return (
    <section className="panel audit-panel" aria-label="Auditor report and source regions">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AUDITOR REPORT</p>
          <h2>{graph.domain === "cloud" ? "Security findings" : "Rule findings"} ({findings.length})</h2>
        </div>
        <span className="status-chip status-chip--fixture"><span aria-hidden="true">◉</span> {graph.style.presentationDemo ? "Demo data" : "Verified"}</span>
      </div>
      <div className="findings-header">
        <div><p className="eyebrow">RULE CHECKS</p><h3>Verified by rules <span className="count-pill">{findings.length}</span></h3></div>
        <span className="verified-summary"><span aria-hidden="true">✓</span> deterministic</span>
      </div>
      {graph.domain === "cloud" && monthlyBudget !== null && <div className="auditor-cost-card"><span>Monthly cloud cost estimate</span><strong>${monthlyBudget}<small>/mo</small></strong><small>{graph.nodes.filter((node) => ["service", "database", "bucket", "cache", "queue"].includes(node.type)).length} resources · demo estimate, not a quote</small></div>}
      <ul className="finding-list" data-testid="findings-list">
        {findings.length === 0 ? <li className="finding-empty"><span aria-hidden="true">✓</span> No active rule findings.</li> : findings.map((finding) => {
          const selected = selectedFindingId === finding.id;
          const target = finding.targets[0];
          const node = target?.node ? graph.nodes.find((item) => item.id === target.node) : undefined;
          const edge = target?.edge ? graph.edges.find((item) => item.id === target.edge) : undefined;
          return <li key={finding.id}><button type="button" className={`finding-item ${selected ? "finding-item--selected" : ""}`} onClick={() => onSelectFinding(finding)} data-testid={`finding-${finding.rule}`}>
            <span className={`finding-icon finding-icon--${finding.severity}`} aria-hidden="true">!</span>
            <span className="finding-copy"><span className="finding-message">{finding.message}</span><span className="finding-meta"><span>Verified</span><span>·</span><span>{node?.label ?? edge?.label ?? edge?.relation ?? "Graph item"}</span></span></span><span className="finding-arrow" aria-hidden="true">↗</span>
          </button></li>;
        })}
      </ul>
      {findings.some((finding) => finding.trust === "advisory") && <p className="advisory-label">Advisory observations are shown separately.</p>}
      <details className="audit-source-details">
        <summary>Show source sketch and highlighted regions</summary>
        <div className="photo-frame" data-testid="source-photo" style={graph.source ? { aspectRatio: `${graph.source.width} / ${graph.source.height}` } : undefined}>
        <img src={sourceImageUrl} alt="Source sketch with numbered regions and rule findings" />
        <div className="region-layer" aria-hidden="true">
          {graph.nodes.map((node) => {
            if (!node.region) return null;
            const [ymin, xmin, ymax, xmax] = node.region.box;
            const hasFinding = findings.some((finding) => finding.targets.some((target) => target.node === node.id));
            const selected = selectedNodeId === node.id || selectedFindingId !== null && findings.some(
              (finding) => finding.id === selectedFindingId && finding.targets.some((target) => target.node === node.id),
            );
            return (
              <div
                key={node.id}
                className={`region-box ${hasFinding ? "region-box--finding" : ""} ${selected ? "region-box--selected" : ""}`}
                style={{ left: `${xmin / 10}%`, top: `${ymin / 10}%`, width: `${(xmax - xmin) / 10}%`, height: `${(ymax - ymin) / 10}%` }}
              >
                {node.region.marker !== undefined && <span className="region-marker">{node.region.marker}</span>}
              </div>
            );
          })}
          {graph.edges.map((edge) => {
            if (!edge.region) return null;
            const [ymin, xmin, ymax, xmax] = edge.region.box;
            const hasFinding = findings.some((finding) => finding.targets.some((target) => target.edge === edge.id));
            const selected = selectedEdgeId === edge.id || selectedFindingId !== null && findings.some(
              (finding) => finding.id === selectedFindingId && finding.targets.some((target) => target.edge === edge.id),
            );
            return (
              <div
                key={edge.id}
                className={`region-box region-box--edge ${hasFinding ? "region-box--finding" : ""} ${selected ? "region-box--selected" : ""}`}
                style={{ left: `${xmin / 10}%`, top: `${ymin / 10}%`, width: `${(xmax - xmin) / 10}%`, height: `${(ymax - ymin) / 10}%` }}
              />
            );
          })}
        </div>
        </div>
        <div className="audit-caption">
        <span><span className="legend-dot legend-dot--red" /> Rule finding on source</span>
        <span><span className="legend-dot legend-dot--blue" /> Selected item</span>
        </div>
      </details>
      <div className="trust-note"><span aria-hidden="true">i</span> Rule findings are verified. Model-only observations appear as advisory.</div>
      {findings.some((finding) => finding.trust === "advisory") && (
        <p className="advisory-label">Advisory observations are shown separately.</p>
      )}
      <span className="sr-only">Regions come from graph nodes and edges, not from diagnostic coordinates.</span>
      {graph.nodes.length === 0 && <span className="sr-only">No nodes in this source.</span>}
    </section>
  );
}

