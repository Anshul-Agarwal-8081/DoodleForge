import { describe, expect, it } from "vitest";
import type { Graph } from "@doodleforge/ir";
import { emitErdSql, inferSqlType } from "./emitter.js";
import { verifyErdGraph } from "./verify.js";
import { checkErdGraph, fixAllHighSeverityErd } from "./rules.js";

const base = (nodes: Graph["nodes"], edges: Graph["edges"] = []): Graph => ({ diagram_id: "erd-test", version: 0, domain: "erd", nodes, edges, groups: [], assumptions: [], questions: [], diagnostics: [], constraints: {}, style: {} });
const node = (id: string, label: string, columns: Array<Record<string, unknown>>): Graph["nodes"][number] => ({ id, type: "entity", label, props: { columns }, confidence: 1, origin: "user", via: "text" });

describe("ERD pack", () => {
  it("infers common PostgreSQL types deterministically", () => {
    expect(["id", "email", "updated_at", "is_active", "price", "count", "payload", "label"].map(inferSqlType)).toEqual(["uuid", "text", "timestamptz", "boolean", "numeric(12,2)", "integer", "jsonb", "text"]);
  });
  it("emits keys, one-to-many foreign keys, and many-to-many join tables", () => {
    const graph = base([node("user", "User", [{ name: "id", primaryKey: true }, { name: "email" }]), node("order", "Order", [{ name: "id", primaryKey: true }, { name: "created_at" }]), node("tag", "Tag", [{ name: "name" }])], [
      { id: "u-o", from: { node: "user" }, to: { node: "order" }, relation: "one_to_many", confidence: 1, origin: "user", via: "text" },
      { id: "o-t", from: { node: "order" }, to: { node: "tag" }, relation: "many_to_many", confidence: 1, origin: "user", via: "text" },
    ]);
    const result = emitErdSql(graph);
    expect(result.sql).toContain('"user_id" uuid');
    expect(result.sql).toContain('FOREIGN KEY ("user_id") REFERENCES "user"("id")');
    expect(result.sql).toContain('CREATE TABLE "order_tag_link"');
    expect(result.assumptions).toContain("tag: added an id UUID primary key");
  });
  it("runs generated DDL in a clean PGlite database and checks tables and foreign keys", async () => {
    const graph = base([node("user", "User", [{ name: "email", unique: true }]), node("order", "Order", [{ name: "created_at" }])], [
      { id: "u-o", from: { node: "user" }, to: { node: "order" }, relation: "one_to_many", confidence: 1, origin: "user", via: "text" },
    ]);
    const result = await verifyErdGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.tables).toEqual(["order", "user"]);
    expect(result.foreignKeyCount).toBe(1);
  }, 30_000);
  it("flags failing entity fixtures and lets an empty fixture pass", () => {
    expect(checkErdGraph(base([node("empty", "Empty", [])])).map((item) => item.rule)).toContain("erd.entity-no-columns");
    expect(checkErdGraph(base([node("good", "Account", [{ name: "id", primaryKey: true }])]))).toEqual([]);
  });
  it("repairs high-severity findings one patch at a time and re-runs rules", () => {
    const result = fixAllHighSeverityErd(base([node("empty", "Account", [])]));
    expect(result.graph.version).toBe(1);
    expect(result.graph.nodes[0]?.props.columns).toEqual([{ name: "id", type: "uuid", primaryKey: true, nullable: false }]);
    expect(result.remaining).toEqual([]);
  });
  it("rejects duplicate normalized table identifiers", () => {
    expect(() => emitErdSql(base([node("a", "My Users", []), node("b", "my-users", [])]))).toThrow("duplicated");
  });
});
