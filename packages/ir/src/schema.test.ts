import { describe, expect, it } from "vitest";
import {
  BoxSchema,
  DiagnosticSchema,
  DomainPackSchema,
  GraphSchema,
  NodeSchema,
  PatchSchema,
} from "./schema.js";
import { createEmptyGraph } from "./patch-engine.js";

describe("IR contracts", () => {
  it("accepts a well-formed normalized box and rejects invalid coordinates", () => {
    expect(BoxSchema.parse([0, 80, 500, 1000])).toEqual([0, 80, 500, 1000]);
    expect(BoxSchema.safeParse([0, 0, 1001, 1000]).success).toBe(false);
    expect(BoxSchema.safeParse([600, 0, 200, 1000]).success).toBe(false);
  });

  it("validates node provenance and confidence", () => {
    const node = {
      id: "n1",
      type: "story",
      label: "Sign in",
      props: {},
      confidence: 0.82,
      origin: "gemma",
      via: "sketch",
      region: { marker: 1, box: [10, 20, 80, 130] },
    };
    expect(NodeSchema.safeParse(node).success).toBe(true);
    expect(NodeSchema.safeParse({ ...node, confidence: 1.1 }).success).toBe(false);
    expect(NodeSchema.safeParse({ ...node, region: { box: [10, 20, 80, 130], pixelX: 10 } }).success).toBe(false);
  });

  it("requires diagnostics to target ids and rejects diagnostic geometry", () => {
    expect(
      DiagnosticSchema.safeParse({
        id: "d1",
        rule: "story.criteria",
        severity: "high",
        trust: "verified",
        targets: [{ node: "n1" }],
        message: "Add criteria",
      }).success,
    ).toBe(true);
    expect(
      DiagnosticSchema.safeParse({
        id: "d1",
        rule: "story.criteria",
        severity: "high",
        trust: "verified",
        targets: [{ node: "n1", edge: "e1" }],
        message: "Add criteria",
        region: { box: [0, 0, 1, 1] },
      }).success,
    ).toBe(false);
  });

  it("validates Graph, Patch, and executable DomainPack contracts", () => {
    const graph = createEmptyGraph("diagram-1", "userstory");
    expect(GraphSchema.safeParse(graph).success).toBe(true);
    expect(
      PatchSchema.safeParse({
        id: "p1",
        base_version: 0,
        origin: "user",
        via: "manual",
        reason: "Set style",
        ops: [{ type: "set_style", style: { density: "compact" } }],
      }).success,
    ).toBe(true);
    expect(
      DomainPackSchema.safeParse({
        id: "test",
        vocabulary: {
          nodeTypes: { story: { propsSchema: NodeSchema.shape.props } },
          relations: ["depends_on"],
          allowedPortPairs: [],
        },
        classifierHint: "User story board",
        prompts: { structure: "Emit patches", fewShots: [] },
        rules: [{ id: "r1", pack: "test", severity: "low", check: () => [] }],
        emitters: [{ id: "md", emit: () => "" }],
      }).success,
    ).toBe(true);
  });
});

