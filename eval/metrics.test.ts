import { describe, expect, it } from "vitest";
import { createEmptyGraph } from "../packages/ir/src/patch-engine.js";
import type { Graph } from "../packages/ir/src/schema.js";
import { scoreGraph } from "./metrics.js";

function graph(labels: string[]): Graph {
  const nodes: Graph["nodes"] = labels.map((label, index) => ({
    id: `n${index}`,
    type: "story",
    label,
    props: {},
    confidence: 1,
    origin: "user",
    via: "manual",
  }));
  const base = createEmptyGraph("test", "userstory");
  return { ...base, nodes, edges: nodes.length > 1 ? [{
    id: "e1",
    from: { node: nodes[0]!.id },
    to: { node: nodes[1]!.id },
    relation: "depends_on",
    confidence: 1,
    origin: "user",
    via: "manual",
  }] : [] };
}

describe("mini-eval graph scorer", () => {
  it("scores an exact match as perfect", () => {
    const result = scoreGraph(graph(["Invite teammates", "Export report"]), graph(["Invite teammates", "Export report"]));
    expect(result.nodes.f1).toBe(1);
    expect(result.edges.f1).toBe(1);
  });

  it("counts missed, extra, and changed nodes and edges", () => {
    const result = scoreGraph(graph(["Invite teammates", "Export report"]), graph(["Invite teammates", "Download report", "Archive report"]));
    expect(result.nodes).toMatchObject({ truePositive: 1, falsePositive: 2, falseNegative: 1 });
    expect(result.edges).toMatchObject({ truePositive: 0, falsePositive: 1, falseNegative: 1 });
  });
});
