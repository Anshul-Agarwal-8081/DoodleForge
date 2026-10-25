import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  appendPatchLog,
  appendUndo,
  applyPatch,
  assertGraphInvariants,
  createEmptyGraph,
  diffGraphsToPatch,
  createPatchLog,
  PatchRejected,
  replayPatchLog,
  undoPatch,
} from "./patch-engine.js";
import type { Graph, Patch } from "./schema.js";

const node = (id: string) => ({
  id,
  type: "story",
  label: id,
  props: {},
  ports: [{ id: "out", dir: "out" as const }],
  confidence: 1,
  origin: "user" as const,
  via: "manual" as const,
});

const patch = (base_version: number, ops: Patch["ops"], id = "p1"): Patch => ({
  id,
  base_version,
  origin: "user",
  via: "manual",
  reason: "test patch",
  ops,
});

describe("atomic patch engine", () => {
  it("rebases a safe additive patch and rejects a stale edit", () => {
    const initial = createEmptyGraph("d1", "userstory");
    const first = applyPatch(initial, patch(0, [{ type: "add_node", node: node("n1") }], "first"));
    const rebased = applyPatch(first.graph, patch(0, [{ type: "add_node", node: node("n2") }], "late-add"));
    expect(rebased.rebased).toBe(true);
    expect(rebased.patch.base_version).toBe(1);
    expect(rebased.graph.version).toBe(2);
    expect(() => applyPatch(rebased.graph, patch(0, [{ type: "update_node", node: node("n1") }]))).toThrow(
      expect.objectContaining({ code: "stale_base_version" }),
    );
  });

  it("rejects a dangling edge atomically", () => {
    const initial = createEmptyGraph("d1", "userstory");
    const invalid = patch(0, [
      {
        type: "add_edge",
        edge: {
          id: "e1",
          from: { node: "missing" },
          to: { node: "also-missing" },
          relation: "depends_on",
          confidence: 1,
          origin: "user",
          via: "manual",
        },
      },
    ]);
    expect(() => applyPatch(initial, invalid)).toThrow(PatchRejected);
    expect(initial).toEqual(createEmptyGraph("d1", "userstory"));
  });

  it("rejects duplicate ids and dangling groups", () => {
    const duplicate: Graph = { ...createEmptyGraph("d1"), nodes: [node("same"), node("same")] };
    expect(() => assertGraphInvariants(duplicate)).toThrow(expect.objectContaining({ code: "duplicate_id" }));

    const initial = createEmptyGraph("d1");
    expect(() =>
      applyPatch(
        initial,
        patch(0, [{ type: "group", group: { id: "g1", label: "Epic", members: ["missing"] } }]),
      ),
    ).toThrow(/dangling member/);
  });

  it("creates a patch-based graph diff for re-upload and snapshot loading", () => {
    const initial = createEmptyGraph("d1", "userstory");
    const target: Graph = { ...initial, nodes: [node("story-1")], source: { image_id: "scan-1", width: 1000, height: 720 } };
    const diff = diffGraphsToPatch(initial, target, {
      id: "import-1",
      origin: "gemma",
      via: "sketch",
      reason: "Import the validated sketch graph",
    });
    const applied = applyPatch(initial, diff);
    expect(applied.graph.nodes).toEqual(target.nodes);
    expect(applied.graph.source).toEqual(target.source);
    expect(applied.patch.origin).toBe("gemma");
  });

  it("rejects dangling node removal after an edge exists", () => {
    const initial = { ...createEmptyGraph("d1"), nodes: [node("n1"), node("n2")] };
    const edge = {
      id: "e1",
      from: { node: "n1", port: "out" },
      to: { node: "n2" },
      relation: "depends_on",
      confidence: 1,
      origin: "user" as const,
      via: "manual" as const,
    };
    const withEdge = applyPatch(initial, patch(0, [{ type: "add_edge", edge }])).graph;
    expect(() => applyPatch(withEdge, patch(1, [{ type: "remove_node", id: "n1" }]))).toThrow(/dangling node endpoint/);
  });

  it("enforces active pack node schemas, relations, and allowed port pairs", () => {
    const pack = {
      id: "userstory",
      vocabulary: {
        nodeTypes: {
          story: {
            propsSchema: z.object({ story: z.string().min(1) }),
            ports: [{ id: "out", dir: "out" as const }, { id: "in", dir: "in" as const }],
          },
        },
        relations: ["depends_on"],
        allowedPortPairs: [["story:out", "story:in"]] as [string, string][],
      },
      classifierHint: "Stories",
      prompts: { structure: "Emit patches", fewShots: [] },
      rules: [],
      emitters: [],
    };
    const graph: Graph = {
      ...createEmptyGraph("d1", "userstory"),
      nodes: [
        { ...node("n1"), props: { story: "Login" } },
        { ...node("n2"), ports: [{ id: "in", dir: "in" }], props: { story: "Profile" } },
      ],
      edges: [
        {
          id: "e1",
          from: { node: "n1", port: "out" },
          to: { node: "n2", port: "in" },
          relation: "depends_on",
          confidence: 1,
          origin: "user",
          via: "manual",
        },
      ],
    };
    expect(() => assertGraphInvariants(graph, pack)).not.toThrow();
    expect(() =>
      assertGraphInvariants({ ...graph, nodes: [{ ...graph.nodes[0]!, props: {} }, graph.nodes[1]!] }, pack),
    ).toThrow(/props do not match/);
    expect(() =>
      assertGraphInvariants({ ...graph, edges: [{ ...graph.edges[0]!, relation: "unknown" }] }, pack),
    ).toThrow(/not allowed by pack/);
    expect(() =>
      assertGraphInvariants({ ...graph, edges: [{ ...graph.edges[0]!, to: { node: "n2", port: "out" } }] }, pack),
    ).toThrow(/references missing target port/);
    const noAllowedPairs = {
      ...pack,
      vocabulary: { ...pack.vocabulary, allowedPortPairs: [] as [string, string][] },
    };
    expect(() => assertGraphInvariants(graph, noAllowedPairs)).toThrow(/not allowed by pack/);
  });

  it("undo restores the exact previous graph content with an append-only version", () => {
    const initial: Graph = {
      ...createEmptyGraph("d1", "userstory"),
      nodes: [node("n1"), node("n2")],
      style: { theme: "paper" },
      assumptions: [{ id: "a1", text: "Note is a story", status: "open", patchId: "seed" }],
    };
    const applied = applyPatch(
      initial,
      patch(0, [
        {
          type: "add_edge",
          edge: {
            id: "e1",
            from: { node: "n1", port: "out" },
            to: { node: "n2" },
            relation: "depends_on",
            confidence: 0.9,
            origin: "gemma",
            via: "sketch",
          },
        },
        { type: "set_style", style: { theme: "dark" } },
        {
          type: "add_assumption",
          assumption: { id: "a2", text: "Second note is a story", status: "open", patchId: "p1" },
        },
      ]),
    );
    const undone = undoPatch(applied.graph, applied.inverse);
    expect({ ...undone.graph, version: initial.version }).toEqual(initial);
    expect(undone.graph.version).toBe(applied.graph.version + 1);
    expect(undone.inverse.ops.length).toBeGreaterThan(0);
  });

  it("only permits replace_all on an empty graph at version zero", () => {
    const initial = createEmptyGraph("d1", "unknown");
    const replacement = { ...createEmptyGraph("d1", "userstory"), nodes: [node("n1")] };
    expect(
      applyPatch(initial, patch(0, [{ type: "replace_all", graph: replacement }])).graph.nodes,
    ).toHaveLength(1);
    const imported = applyPatch(initial, patch(0, [{ type: "replace_all", graph: replacement }])).graph;
    expect(() => applyPatch(imported, patch(1, [{ type: "replace_all", graph: replacement }]))).toThrow(
      expect.objectContaining({ code: "replace_all_not_allowed" }),
    );
  });

  it("keeps the patch journal append-only and records undo as a compensating patch", () => {
    const initial = createEmptyGraph("d1", "userstory");
    const emptyLog = createPatchLog(initial);
    const first = appendPatchLog(emptyLog, patch(0, [{ type: "add_node", node: node("n1") }], "add-n1"));
    const undone = appendUndo(first.log);
    expect(first.log.entries).toHaveLength(1);
    expect(undone.log.entries).toHaveLength(2);
    expect(undone.log.entries[1]?.reason).toBe("Compensating patch for undo");
    expect({ ...undone.graph, version: 0 }).toEqual(initial);
    expect(replayPatchLog(undone.log)).toEqual(undone.graph);
  });
});

