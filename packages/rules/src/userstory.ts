import type { Diagnostic, Graph } from "@doodleforge/ir";
import type { PureRule } from "./engine.js";

function storyNodes(graph: Graph) {
  return graph.nodes.filter((node) => node.type === "story");
}

function finding(rule: string, severity: Diagnostic["severity"], node: string, message: string): Diagnostic {
  return { id: `${rule}:${node}`, rule, severity, trust: "verified", targets: [{ node }], message };
}

export const userStoryRules: PureRule[] = [
  {
    id: "userstory.no-acceptance-criteria",
    pack: "userstory",
    severity: "high",
    check(graph) {
      return storyNodes(graph)
        .filter((node) => !Array.isArray(node.props.acceptance) || node.props.acceptance.length === 0)
        .map((node) => finding(this.id, this.severity, node.id, `“${node.label}” has no acceptance criteria.`));
    },
  },
  {
    id: "userstory.no-persona-or-benefit",
    pack: "userstory",
    severity: "medium",
    check(graph) {
      return storyNodes(graph)
        .filter((node) => {
          const persona = typeof node.props.persona === "string" && node.props.persona.trim().length > 0;
          const text = `${node.label} ${String(node.props.story ?? "")}`;
          const benefit = /\bso that\b|\bbecause\b|\bbenefit\b/i.test(text);
          return !persona && !benefit;
        })
        .map((node) => finding(this.id, this.severity, node.id, `“${node.label}” needs a persona or a stated benefit.`));
    },
  },
  {
    id: "userstory.dependency-cycle",
    pack: "userstory",
    severity: "high",
    check(graph) {
      const adjacency = new Map<string, Array<{ next: string; edge: string }>>();
      for (const edge of graph.edges.filter((item) => item.relation === "depends_on")) {
        const list = adjacency.get(edge.from.node) ?? [];
        list.push({ next: edge.to.node, edge: edge.id });
        adjacency.set(edge.from.node, list);
      }
      const activeIndex = new Map<string, number>();
      const done = new Set<string>();
      const cycleEdges = new Set<string>();
      const stackEdges: string[] = [];
      const visit = (node: string) => {
        if (done.has(node)) return;
        activeIndex.set(node, activeIndex.size);
        for (const relation of adjacency.get(node) ?? []) {
          const activeStart = activeIndex.get(relation.next);
          if (activeStart !== undefined) {
            for (const edge of stackEdges.slice(activeStart)) cycleEdges.add(edge);
            cycleEdges.add(relation.edge);
            continue;
          }
          if (!done.has(relation.next)) {
            stackEdges.push(relation.edge);
            visit(relation.next);
            stackEdges.pop();
          }
        }
        activeIndex.delete(node);
        done.add(node);
      };
      for (const node of graph.nodes) visit(node.id);
      return graph.edges
        .filter((edge) => cycleEdges.has(edge.id))
        .map((edge) => ({
          id: `${this.id}:${edge.id}`,
          rule: this.id,
          severity: this.severity,
          trust: "verified" as const,
          targets: [{ edge: edge.id }],
          message: "This dependency participates in a cycle.",
        }));
    },
  },
];

