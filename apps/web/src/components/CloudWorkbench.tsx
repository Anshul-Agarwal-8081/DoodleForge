import { useMemo, useState } from "react";
import type { Graph, PatchOp } from "@doodleforge/ir";
import { cloudRules } from "@doodleforge/pack-cloud";
import { emitTerraform } from "@doodleforge/pack-cloud/hcl";

const cloudGraph: Graph = {
  diagram_id: "cloud-demo", version: 0, domain: "cloud",
  nodes: [
    { id: "api", type: "service", label: "Member API", props: { resourceName: "member-api" }, confidence: 1, origin: "user", via: "manual" },
    { id: "database", type: "database", label: "Member database", props: { resourceName: "member-db", engine: "postgres", encryption: true }, confidence: 1, origin: "user", via: "manual" },
    { id: "bucket", type: "bucket", label: "Private uploads", props: { resourceName: "member-uploads", public: false, encryption: true }, confidence: 1, origin: "user", via: "manual" },
  ],
  edges: [{ id: "api-db", from: { node: "api" }, to: { node: "database" }, relation: "connects_to", confidence: 1, origin: "user", via: "manual" }],
  groups: [], assumptions: [], questions: [], diagnostics: [], constraints: { provider: "aws", region: "us-east-1", monthly_budget_usd: 500 }, style: {},
};

export function CloudWorkbench({ graph, onPatch }: { graph: Graph; onPatch(ops: PatchOp[], reason: string): void }) {
  const activeGraph = useMemo(() => {
    const resources = graph.nodes.filter((node) => ["service", "database", "cache", "bucket", "security_group", "queue"].includes(node.type));
    if (!resources.length) return cloudGraph;
    const ids = new Set(resources.map((node) => node.id));
    return { ...graph, nodes: resources, edges: graph.edges.filter((edge) => ids.has(edge.from.node) && ids.has(edge.to.node)) };
  }, [graph]);
  const isFixture = activeGraph === cloudGraph;
  const emission = useMemo(() => {
    try { return { ...emitTerraform(activeGraph), error: "" }; }
    catch (error) { return { hcl: "", assumptions: [], mode: "plan-only" as const, error: error instanceof Error ? error.message : String(error) }; }
  }, [activeGraph]);
  const [result, setResult] = useState<{ verified: boolean; status: string; stage?: string; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const findings = cloudRules.flatMap((rule) => rule.check(activeGraph));
  const addStarter = () => {
    const serviceId = `cloud-service-${crypto.randomUUID()}`;
    const dbId = `cloud-database-${crypto.randomUUID()}`;
    const bucketId = `cloud-bucket-${crypto.randomUUID()}`;
    const node = (id: string, type: string, label: string, props: Record<string, unknown>) => ({ id, type, label, props, confidence: 1, origin: "user" as const, via: "manual" as const });
    const ops: PatchOp[] = [
      { type: "add_node", node: node(serviceId, "service", "Member API", { resourceName: "member-api" }) },
      { type: "add_node", node: node(dbId, "database", "Member database", { resourceName: "member-db", engine: "postgres", encryption: true }) },
      { type: "add_node", node: node(bucketId, "bucket", "Private uploads", { resourceName: "member-uploads", public: false, encryption: true }) },
      { type: "add_edge", edge: { id: `cloud-edge-${crypto.randomUUID()}`, from: { node: serviceId }, to: { node: dbId }, relation: "connects_to", confidence: 1, origin: "user", via: "manual" } },
    ];
    onPatch(ops, "Add a safe cloud starter to the shared graph");
  };
  const verify = async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/cloud/terraform/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(activeGraph) });
      const value = await response.json() as { verified: boolean; status: string; stage?: string; detail?: string; message?: string };
      if (!response.ok) throw new Error(value.message ?? `Terraform verification failed (${response.status})`);
      setResult({ verified: value.verified, status: value.status, ...(value.stage ? { stage: value.stage } : {}), detail: value.detail ?? "No validator detail returned." });
    } catch (error) { setResult({ verified: false, status: "failed", detail: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  return <section className="panel erd-workbench cloud-workbench" aria-label="Cloud Terraform workbench">
    <header className="outputs-heading">
      <div><p className="eyebrow">PHASE 5 · CLOUD TO TERRAFORM</p><h2>Review infrastructure before export.</h2><p>HCL comes from fixed templates. Validation is local plan preparation only; no apply operation is provided.</p></div>
      <div className="lab-actions">{isFixture && <button className="secondary-button" type="button" onClick={addStarter}>Add starter graph</button>}<button className="primary-button" type="button" onClick={() => void verify()} disabled={busy || Boolean(emission.error)}>{busy ? "Checking…" : "Run fmt and validate"}</button></div>
    </header>
    <p className="lab-footnote">{isFixture ? "Showing the safe cloud sample because this graph has no cloud resources." : `Compiling ${activeGraph.nodes.length} cloud resources from the shared graph · IR v${graph.version}.`}</p>
    <div className="cloud-findings" aria-label="Verified cloud rule findings">
      {findings.length ? findings.map((finding) => <p className="validation-message" key={finding.id}>Verified · {finding.message}</p>) : <p className="cloud-clean">✓ Verified cloud rules: no public storage or open ingress found.</p>}
    </div>
    {emission.error ? <p className="validation-message" role="alert">Terraform preview blocked: {emission.error}</p> : <pre className="erd-sql"><code>{emission.hcl}</code></pre>}
    <p className="erd-assumptions">Assumptions: {emission.assumptions.join("; ") || "None."}</p>
    {result && <div className={`erd-result ${result.verified ? "is-verified" : "is-failed"}`} role="status"><strong>{result.verified ? "VERIFIED · Terraform fmt and validate" : `${result.status.toUpperCase()} · Terraform ${result.stage ?? "verification"}`}</strong><span>{result.detail}</span></div>}
  </section>;
}
