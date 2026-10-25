import { describe, expect, it } from "vitest";
import { applyPatch, createEmptyGraph } from "@doodleforge/ir";
import type { Graph, Patch } from "@doodleforge/ir";
import { userStoryFewShots } from "./examples.js";
import { allocateStoryIds, classifyBoardCues, deduplicateStories, findNearDuplicateCandidates, topologicalStoryOrder } from "./analysis.js";
import { storyAuditsFromGraph } from "./schema.js";

function makeGraph(): Graph {
  const criterion = [{ given: "I am signed in", when: "I export the report", then: "A CSV downloads" }];
  const patch: Patch = {
    id: "analysis-seed",
    base_version: 0,
    origin: "user",
    via: "manual",
    reason: "Build user-story analysis fixture",
    ops: [
      { type: "add_node", node: { id: "story-a", type: "story", label: "Export report", props: { story: "As an analyst, I want to export report data", persona: "Analyst", acceptance: criterion }, confidence: 1, origin: "user", via: "manual" } },
      { type: "add_node", node: { id: "story-b", type: "story", label: "Export report data", props: { story: "As an analyst, I want to export report data to CSV", persona: "Analyst", acceptance: criterion }, confidence: 1, origin: "user", via: "manual" } },
      { type: "add_edge", edge: { id: "edge-a-b", from: { node: "story-a" }, to: { node: "story-b" }, relation: "depends_on", confidence: 1, origin: "user", via: "manual" } },
    ],
  };
  return applyPatch(createEmptyGraph("analysis", "userstory"), patch).graph;
}

describe("user-story pack analysis", () => {
  it("ships two schema-validated few-shot examples", () => {
    expect(userStoryFewShots).toHaveLength(2);
    expect(userStoryFewShots.every((shot) => shot.ir.nodes.some((node) => node.type === "story"))).toBe(true);
  });

  it("maps board shapes, editable colors, marks, and quadrants to graph semantics", () => {
    const result = classifyBoardCues([
      { marker: 1, box: [0, 0, 160, 220], shapeGuess: "sticky_note", text: "Build a report", color: "yellow", mark: "star" },
      { marker: 2, box: [200, 0, 380, 230], shapeGuess: "sticky_note", text: "Notify a user", color: "blue", mark: "red_dot" },
      { marker: 3, box: [0, 250, 300, 950], shapeGuess: "header", text: "Reporting" },
      { marker: 4, box: [200, 240, 260, 300], shapeGuess: "arrow", text: "then" },
      { marker: 5, box: [410, 10, 580, 300], shapeGuess: "sticky_note", text: "Low priority", quadrant: "bottom_left" },
    ], { yellow: "story", blue: "persona" });
    expect(result.map((cue) => cue.kind)).toEqual(["story", "persona", "epic", "edge", "story"]);
    expect(result[0]).toMatchObject({ priority: "Must", priority_source: "mark" });
    expect(result[1]).toMatchObject({ priority: "Should", priority_source: "mark" });
    expect(result[3]).toMatchObject({ relation: "depends_on" });
    expect(result[4]).toMatchObject({ priority: "Won't", priority_source: "quadrant" });
  });

  it("allocates deterministic US identifiers without reusing occupied ids", () => {
    expect(allocateStoryIds(["US-01", "other-id", "US-03"], 2)).toEqual(["US-02", "US-04"]);
  });

  it("finds near-duplicate pairs and uses the supplied yes/no confirmation", async () => {
    const audits = storyAuditsFromGraph(makeGraph());
    const stories = [...audits.values()].map((item) => item.record!);
    expect(findNearDuplicateCandidates(stories)).toHaveLength(1);
    let calls = 0;
    const output = await deduplicateStories(stories, async () => { calls += 1; return true; });
    expect(calls).toBe(1);
    expect(output).toHaveLength(1);
  });

  it("sorts stories dependency-first and rejects cycles", () => {
    const graph = makeGraph();
    expect(topologicalStoryOrder(graph)).toEqual(["story-b", "story-a"]);
    const cyclic = { ...graph, edges: [...graph.edges, { ...graph.edges[0]!, id: "edge-b-a", from: { node: "story-b" }, to: { node: "story-a" } }] };
    expect(() => topologicalStoryOrder(cyclic)).toThrow("cyclic");
  });
});
