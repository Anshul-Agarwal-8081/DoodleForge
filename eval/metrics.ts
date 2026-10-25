import type { Graph } from "../packages/ir/src/schema.js";

export type F1Score = { truePositive: number; falsePositive: number; falseNegative: number; precision: number; recall: number; f1: number };
export type GraphF1 = { nodes: F1Score; edges: F1Score };

export function scoreGraph(expected: Graph, actual: Graph): GraphF1 {
  const nodeKey = (node: Graph["nodes"][number]) => `${normalise(node.type)}|${normalise(node.label)}`;
  const edgeKey = (graph: Graph, edge: Graph["edges"][number]) => {
    const byId = new Map(graph.nodes.map((node) => [node.id, node.label]));
    return `${normalise(byId.get(edge.from.node) ?? edge.from.node)}|${normalise(edge.relation)}|${normalise(byId.get(edge.to.node) ?? edge.to.node)}`;
  };
  return {
    nodes: f1(expected.nodes.map(nodeKey), actual.nodes.map(nodeKey)),
    edges: f1(expected.edges.map((edge) => edgeKey(expected, edge)), actual.edges.map((edge) => edgeKey(actual, edge))),
  };
}

function normalise(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function f1(expected: string[], actual: string[]): F1Score {
  const expectedCounts = count(expected);
  const actualCounts = count(actual);
  let truePositive = 0;
  for (const [key, amount] of expectedCounts) truePositive += Math.min(amount, actualCounts.get(key) ?? 0);
  const falsePositive = actual.length - truePositive;
  const falseNegative = expected.length - truePositive;
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

function count(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}
