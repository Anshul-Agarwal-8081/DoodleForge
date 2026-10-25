import type { Diagnostic, Graph } from "@doodleforge/ir";
import type { PureRule } from "./engine.js";

function finding(
  rule: string,
  severity: Diagnostic["severity"],
  target: { node?: string; edge?: string },
  message: string,
): Diagnostic {
  return {
    id: `${rule}:${target.node ?? target.edge}`,
    rule,
    severity,
    trust: "verified",
    targets: [target],
    message,
  };
}

export const coreRules: PureRule[] = [
  {
    id: "core.node-with-no-connections",
    pack: "core",
    severity: "low",
    check(graph) {
      const connected = new Set(graph.edges.flatMap((edge) => [edge.from.node, edge.to.node]));
      return graph.nodes
        .filter((node) => !connected.has(node.id))
        .map((node) => finding(this.id, this.severity, { node: node.id }, `“${node.label}” has no connections.`));
    },
  },
  {
    id: "core.duplicate-labels",
    pack: "core",
    severity: "medium",
    check(graph) {
      const counts = new Map<string, number>();
      for (const node of graph.nodes) {
        const label = node.label.trim().toLocaleLowerCase();
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return graph.nodes
        .filter((node) => counts.get(node.label.trim().toLocaleLowerCase())! > 1)
        .map((node) => finding(this.id, this.severity, { node: node.id }, `“${node.label}” duplicates another label.`));
    },
  },
  {
    id: "core.incompatible-ports",
    pack: "core",
    severity: "high",
    check(graph) {
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      return graph.edges.flatMap((edge) => {
        const source = nodes.get(edge.from.node);
        const target = nodes.get(edge.to.node);
        const sourcePort = edge.from.port ? source?.ports?.find((port) => port.id === edge.from.port) : undefined;
        const targetPort = edge.to.port ? target?.ports?.find((port) => port.id === edge.to.port) : undefined;
        if (!source || !target) return [];
        if ((edge.from.port && !sourcePort) || (edge.to.port && !targetPort)) {
          return [finding(this.id, this.severity, { edge: edge.id }, "This connection references a port that does not exist.")];
        }
        if (sourcePort?.dir === "in" || targetPort?.dir === "out") {
          return [finding(this.id, this.severity, { edge: edge.id }, "The connection direction does not match its port directions.")];
        }
        return [];
      });
    },
  },
  {
    id: "core.unresolved-low-confidence",
    pack: "core",
    severity: "medium",
    check(graph) {
      const asked = new Set(graph.questions.flatMap((question) => question.targets));
      return graph.nodes
        .filter((node) => node.confidence < 0.65 && !asked.has(node.id))
        .map((node) => finding(this.id, this.severity, { node: node.id }, `“${node.label}” has low confidence and needs review.`));
    },
  },
  {
    id: "core.unlabelled-edge",
    pack: "core",
    severity: "low",
    check(graph) {
      return graph.edges
        .filter((edge) => !edge.label?.trim())
        .map((edge) => finding(this.id, this.severity, { edge: edge.id }, "This connection has no label."));
    },
  },
];

