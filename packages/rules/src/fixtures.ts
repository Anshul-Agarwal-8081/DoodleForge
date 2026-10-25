import { createEmptyGraph, type Graph } from "@doodleforge/ir";

const node = (
  id: string,
  label = id,
  props: Record<string, unknown> = {},
  confidence = 1,
  ports?: Array<{ id: string; dir: "in" | "out" }>,
) => ({
  id,
  type: "story",
  label,
  props,
  ...(ports ? { ports } : {}),
  confidence,
  origin: "user" as const,
  via: "manual" as const,
});

const edge = (
  id: string,
  from: string,
  to: string,
  relation = "depends_on",
  fromPort?: string,
  toPort?: string,
  label?: string,
) => ({
  id,
  from: { node: from, ...(fromPort ? { port: fromPort } : {}) },
  to: { node: to, ...(toPort ? { port: toPort } : {}) },
  relation,
  ...(label ? { label } : {}),
  confidence: 1,
  origin: "user" as const,
  via: "manual" as const,
});

function graph(
  nodes: Graph["nodes"],
  edges: Graph["edges"] = [],
  questions: Graph["questions"] = [],
): Graph {
  return { ...createEmptyGraph("rule-fixture", "userstory"), nodes, edges, questions };
}

export const ruleFixtures: Record<string, { failing: Graph; passing: Graph }> = {
  "core.node-with-no-connections": {
    failing: graph([node("orphan", "Orphan")]),
    passing: graph([node("a"), node("b")], [edge("e1", "a", "b")]),
  },
  "core.duplicate-labels": {
    failing: graph([node("a", "Login"), node("b", "Login")]),
    passing: graph([node("a", "Login"), node("b", "Profile")]),
  },
  "core.incompatible-ports": {
    failing: graph(
      [node("a", "Source", {}, 1, [{ id: "in", dir: "in" }]), node("b", "Target", {}, 1, [{ id: "out", dir: "out" }])],
      [edge("e1", "a", "b", "depends_on", "in", "out")],
    ),
    passing: graph(
      [node("a", "Source", {}, 1, [{ id: "out", dir: "out" }]), node("b", "Target", {}, 1, [{ id: "in", dir: "in" }])],
      [edge("e1", "a", "b", "depends_on", "out", "in")],
    ),
  },
  "core.unresolved-low-confidence": {
    failing: graph([node("a", "Uncertain", {}, 0.25)]),
    passing: graph([node("a", "Uncertain", {}, 0.25)], [], [{ id: "q1", text: "Which story is this?", options: ["A", "B"], targets: ["a"] }]),
  },
  "core.unlabelled-edge": {
    failing: graph([node("a"), node("b")], [edge("e1", "a", "b")]),
    passing: graph([node("a"), node("b")], [edge("e1", "a", "b", "depends_on", undefined, undefined, "Blocks")]),
  },
  "userstory.no-acceptance-criteria": {
    failing: graph([node("a", "Sign in", { story: "As a member, I want to sign in" })]),
    passing: graph([node("a", "Sign in", { story: "As a member, I want to sign in", acceptance: [{ given: "A member", when: "they sign in", then: "they see their account" }] })]),
  },
  "userstory.no-persona-or-benefit": {
    failing: graph([node("a", "Sign in", { story: "I want to sign in" })]),
    passing: graph([node("a", "Sign in", { persona: "member", story: "I want to sign in" })]),
  },
  "userstory.dependency-cycle": {
    failing: graph([node("a"), node("b")], [edge("e1", "a", "b"), edge("e2", "b", "a")]),
    passing: graph([node("a"), node("b")], [edge("e1", "a", "b")]),
  },
};

