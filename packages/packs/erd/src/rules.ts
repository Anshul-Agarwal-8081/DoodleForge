import type { Diagnostic, Graph } from "@doodleforge/ir";
import type { PureRule } from "@doodleforge/rules";
import { applyPatch } from "@doodleforge/ir";
import { ErdEntityPropsSchema } from "./schema.js";

function finding(rule: string, target: string, message: string, severity: Diagnostic["severity"] = "high"): Diagnostic {
  return { id: `${rule}:${target}`, rule, severity, trust: "verified", targets: [{ node: target }], message };
}

export const erdRules: PureRule[] = [
  {
    id: "erd.entity-no-columns", pack: "erd", severity: "high",
    check(graph: Graph) {
      return graph.nodes.filter((node) => node.type === "entity").flatMap((node) => {
        const parsed = ErdEntityPropsSchema.safeParse(node.props);
        return parsed.success && parsed.data.columns.length > 0 ? [] : [finding(this.id, node.id, `Entity '${node.label}' has no declared columns.`)];
      });
    },
  },
  {
    id: "erd.entity-no-explicit-primary-key", pack: "erd", severity: "medium",
    check(graph: Graph) {
      return graph.nodes.filter((node) => node.type === "entity").flatMap((node) => {
        const parsed = ErdEntityPropsSchema.safeParse(node.props);
        if (!parsed.success || parsed.data.columns.length === 0) return [];
        return parsed.data.columns.some((column) => column.primaryKey || column.name.toLowerCase() === "id")
          ? [] : [finding(this.id, node.id, `Entity '${node.label}' has no explicit primary key; the emitter can add an id UUID key.`, "medium")];
      });
    },
  },
];

export function checkErdGraph(graph: Graph) { return erdRules.flatMap((rule) => rule.check(graph)); }

/** Apply deterministic high-severity fixes as one versioned patch at a time, rechecking after every edit. */
export function fixAllHighSeverityErd(graph: Graph) {
  let current = structuredClone(graph);
  const applied: string[] = [];
  for (let step = 0; step < 25; step += 1) {
    const finding = checkErdGraph(current).find((item) => item.severity === "high");
    if (!finding) break;
    if (finding.rule !== "erd.entity-no-columns") break;
    const targetId = finding.targets[0]?.node;
    const node = current.nodes.find((item) => item.id === targetId);
    if (!node) break;
    current = applyPatch(current, {
      id: `fix:${finding.id}:${current.version}`,
      base_version: current.version,
      origin: "rule",
      via: "manual",
      reason: `Fix ${finding.rule}`,
      ops: [{ type: "update_node", node: { ...node, props: { ...node.props, columns: [{ name: "id", type: "uuid", primaryKey: true, nullable: false }] }, origin: "rule", via: "manual" } }],
    }).graph;
    applied.push(finding.id);
  }
  return { graph: current, applied, remaining: checkErdGraph(current) };
}
