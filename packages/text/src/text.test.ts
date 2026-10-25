import { describe, expect, it } from "vitest";
import { applyPatch, createEmptyGraph } from "@doodleforge/ir";
import { classifyTextIntent, compileTextIntent } from "./index.js";

const graph = () => ({ ...createEmptyGraph("text-test", "userstory"), nodes: [
  { id: "story-1", type: "story", label: "Sign in", props: { story: "As a member, I want to sign in" }, confidence: 1, origin: "user" as const, via: "manual" as const },
  { id: "story-2", type: "story", label: "View profile", props: { story: "As a member, I want to view my profile" }, confidence: 1, origin: "user" as const, via: "manual" as const },
] });

describe("text intent pipeline", () => {
  it("classifies create, modify, explain, constraints, and commands", () => {
    expect(["create a service", "rename Sign in to Login", "why is this risky?", "use AWS in us-west-2 under $500/month", "undo"].map(classifyTextIntent)).toEqual(["create", "modify", "explain", "constrain", "command"]);
  });
  it("writes extracted constraints as a patch and preserves existing keys", () => {
    const current = { ...graph(), constraints: { availability: "99.9%" } };
    const output = compileTextIntent("Use AWS in us-west-2 under $500/month, HIPAA, and 2k RPS", current);
    expect(output.constraints).toEqual({ provider: "aws", region: "us-west-2", monthly_budget_usd: 500, scale: "2k RPS", compliance: "HIPAA" });
    const next = applyPatch(current, output.patches[0]!);
    expect(next.graph.constraints.availability).toBe("99.9%");
    expect(next.graph.constraints.provider).toBe("aws");
  });
  it("applies exact-target edits only and refuses unknown or ambiguous labels", () => {
    const current = graph();
    const output = compileTextIntent("rename Sign in to Log in", current);
    const next = applyPatch(current, output.patches[0]!);
    expect(next.graph.nodes.map((node) => node.label)).toEqual(["Log in", "View profile"]);
    expect(compileTextIntent("rename missing to New", current).patches).toEqual([]);
    const ambiguous = { ...current, nodes: [...current.nodes, { ...current.nodes[0]!, id: "story-3" }] };
    expect(compileTextIntent("rename Sign in to Login", ambiguous).patches).toEqual([]);
  });
  it("applies a named pattern as a small graph patch without coordinates", () => {
    const current = graph();
    const output = compileTextIntent("Use an event-driven architecture", current);
    expect(output.pattern).toBe("event_driven");
    const next = applyPatch(current, output.patches[0]!);
    expect(next.graph.nodes.map((node) => node.label)).toContain("Event queue");
    expect(next.graph.nodes.every((node) => !("position" in node))).toBe(true);
  });
  it("does not invent a constraint or create an unresolved modification", () => {
    expect(compileTextIntent("deploy it cheaply", graph()).patches).toEqual([]);
    expect(compileTextIntent("rename without exact target", graph()).patches).toEqual([]);
  });
});
