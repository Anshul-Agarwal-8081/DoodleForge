import { describe, expect, it } from "vitest";
import { createEmptyGraph } from "@doodleforge/ir";
import { layoutGraph } from "./layout.js";

describe("ELK graph layout", () => {
  it("lays out connected nodes left to right and merges drag overrides", async () => {
    const graph = {
      ...createEmptyGraph("layout-test", "userstory"),
      nodes: [
        { id: "a", type: "story", label: "A", props: {}, confidence: 1, origin: "user" as const, via: "manual" as const },
        { id: "b", type: "story", label: "B", props: {}, confidence: 1, origin: "user" as const, via: "manual" as const },
      ],
      edges: [{ id: "e", from: { node: "a" }, to: { node: "b" }, relation: "depends_on", confidence: 1, origin: "user" as const, via: "manual" as const }],
    };
    const result = await layoutGraph(graph);
    expect(result.find((item) => item.id === "a")!.x).toBeLessThan(result.find((item) => item.id === "b")!.x);
    const moved = await layoutGraph(graph, { b: { x: 17, y: 29 } });
    expect(moved.find((item) => item.id === "b")).toMatchObject({ x: 17, y: 29 });
  });
});

