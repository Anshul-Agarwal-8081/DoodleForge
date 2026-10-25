import { useMemo, useState, type FormEvent } from "react";
import type { Graph, PatchOp } from "@doodleforge/ir";
import { emitErdSql } from "@doodleforge/pack-erd/emitter";

const erdGraph: Graph = {
  diagram_id: "erd-demo", version: 0, domain: "erd",
  nodes: [
    { id: "customers", type: "entity", label: "Customers", props: { columns: [{ name: "id", primaryKey: true }, { name: "email", unique: true }, { name: "created_at" }] }, confidence: 1, origin: "user", via: "manual" },
    { id: "orders", type: "entity", label: "Orders", props: { columns: [{ name: "id", primaryKey: true }, { name: "total_amount" }, { name: "is_paid" }] }, confidence: 1, origin: "user", via: "manual" },
    { id: "products", type: "entity", label: "Products", props: { columns: [{ name: "id", primaryKey: true }, { name: "name" }, { name: "price" }] }, confidence: 1, origin: "user", via: "manual" },
  ],
  edges: [
    { id: "customer-orders", from: { node: "customers" }, to: { node: "orders" }, relation: "one_to_many", label: "places", confidence: 1, origin: "user", via: "manual" },
    { id: "order-products", from: { node: "orders" }, to: { node: "products" }, relation: "many_to_many", label: "contains", confidence: 1, origin: "user", via: "manual" },
  ],
  groups: [], assumptions: [], questions: [], diagnostics: [], constraints: {}, style: {},
};

export function ErdWorkbench({ graph, onPatch }: { graph: Graph; onPatch(ops: PatchOp[], reason: string): void }) {
  const [entityName, setEntityName] = useState("");
  const [columnsText, setColumnsText] = useState("id, name");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [relation, setRelation] = useState<"one_to_many" | "many_to_many">("one_to_many");
  const activeGraph = useMemo(() => {
    const entities = graph.nodes.filter((node) => node.type === "entity");
    if (!entities.length) return erdGraph;
    const ids = new Set(entities.map((node) => node.id));
    return { ...graph, nodes: entities, edges: graph.edges.filter((edge) => ids.has(edge.from.node) && ids.has(edge.to.node)) };
  }, [graph]);
  const isFixture = activeGraph === erdGraph;
  const emission = useMemo(() => {
    try { return { value: emitErdSql(activeGraph), error: "" }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [activeGraph]);
  const [status, setStatus] = useState<{ valid: boolean; tables: string[]; foreignKeyCount: number; tablePreviews: Array<{ table: string; columns: Array<{ column_name: string; data_type: string }>; rows: Array<Record<string, unknown>> }>; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const addEntity = (event: FormEvent) => {
    event.preventDefault();
    const label = entityName.trim(); if (!label) return;
    const names = [...new Set(columnsText.split(",").map((name) => name.trim()).filter(Boolean))];
    if (!names.some((name) => name.toLowerCase() === "id")) names.unshift("id");
    onPatch([{ type: "add_node", node: { id: `entity-${crypto.randomUUID()}`, type: "entity", label, props: { columns: names.map((name) => ({ name, ...(name.toLowerCase() === "id" ? { primaryKey: true, nullable: false } : {}) })) }, confidence: 1, origin: "user", via: "manual" } }], `Add ERD entity ${label}`);
    setEntityName("");
  };
  const addRelationship = () => {
    const a = activeGraph.nodes.find((node) => node.id === from) ?? activeGraph.nodes[0];
    const b = activeGraph.nodes.find((node) => node.id === to) ?? activeGraph.nodes[1];
    if (!a || !b || a.id === b.id) return;
    onPatch([{ type: "add_edge", edge: { id: `relation-${crypto.randomUUID()}`, from: { node: a.id }, to: { node: b.id }, relation, label: relation === "one_to_many" ? "has many" : "many to many", confidence: 1, origin: "user", via: "manual" } }], `Add ${relation.replaceAll("_", " ")} relationship`);
  };
  const verify = async () => {
    setRunning(true);
    try {
      const { verifyErdGraph } = await import("@doodleforge/pack-erd/verify");
      const result = await verifyErdGraph(activeGraph);
      setStatus({ valid: result.valid, tables: result.tables, foreignKeyCount: result.foreignKeyCount, tablePreviews: result.tablePreviews, ...(result.error ? { error: result.error } : {}) });
    } catch (error) {
      setStatus({ valid: false, tables: [], foreignKeyCount: 0, tablePreviews: [], error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  };
  return <section className="panel erd-workbench" aria-label="ERD to PostgreSQL workbench">
    <header className="outputs-heading">
      <div><p className="eyebrow">PHASE 4 · ERD TO POSTGRESQL</p><h2>Sketch the model. Verify the schema.</h2><p>Type inference and DDL are deterministic; PGlite executes the result in a clean database.</p></div>
      <button className="primary-button" type="button" onClick={() => void verify()} disabled={running}>{running ? "Verifying…" : "Verify with PGlite"}</button>
    </header>
    <p className="lab-footnote">{isFixture ? "Showing the editable ERD sample because the current graph has no entity nodes." : `Using ${activeGraph.nodes.length} entity nodes from the shared graph · IR v${graph.version}.`}</p>
    <div className="erd-entities">{activeGraph.nodes.map((node) => <article key={node.id}><strong>{node.label}</strong><code>{(Array.isArray(node.props.columns) ? node.props.columns as Array<{ name: string }> : []).map((column) => column.name).join(" · ")}</code></article>)}</div>
    <div className="erd-editor"><form className="lab-form" onSubmit={addEntity}><label>Entity name<input value={entityName} onChange={(event) => setEntityName(event.target.value)} placeholder="Invoices" required /></label><label>Columns, comma separated<input value={columnsText} onChange={(event) => setColumnsText(event.target.value)} /></label><button type="submit" className="secondary-button">Add entity to graph</button></form><div className="lab-form erd-relation-form"><label>From<select value={from} onChange={(event) => setFrom(event.target.value)}><option value="">First entity</option>{activeGraph.nodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}</select></label><label>To<select value={to} onChange={(event) => setTo(event.target.value)}><option value="">Second entity</option>{activeGraph.nodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}</select></label><label>Relation<select value={relation} onChange={(event) => setRelation(event.target.value as typeof relation)}><option value="one_to_many">One to many</option><option value="many_to_many">Many to many</option></select></label><button type="button" className="secondary-button" onClick={addRelationship} disabled={activeGraph.nodes.length < 2}>Add relationship</button></div></div>
    {emission.value ? <pre className="erd-sql"><code>{emission.value.sql}</code></pre> : <p className="validation-message" role="alert">DDL preview blocked: {emission.error}</p>}
    <p className="erd-assumptions">Type inference assumptions: {emission.value?.assumptions.join("; ") || "None."}</p>
    {status && <div className={`erd-result ${status.valid ? "is-verified" : "is-failed"}`} role="status">
      <strong>{status.valid ? "VERIFIED · PGlite DDL execution" : "FAILED · DDL verification"}</strong>
      <span>{status.valid ? `${status.tables.length} tables and ${status.foreignKeyCount} foreign keys created` : status.error ?? "The database tables do not match the diagram."}</span>
      {status.valid && status.tablePreviews.map((preview) => <div className="erd-table-preview" key={preview.table}><strong>{preview.table}</strong><span>{preview.columns.map((column) => `${column.column_name} · ${column.data_type}`).join(" | ")}</span><small>{preview.rows.length ? JSON.stringify(preview.rows) : "No rows · table created successfully"}</small></div>)}
    </div>}
  </section>;
}
