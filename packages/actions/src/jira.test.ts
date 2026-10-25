import { describe, expect, it } from "vitest";
import { applyPatch, createEmptyGraph } from "@doodleforge/ir";
import { approveJiraIssue, buildFixtureJiraToolCall, createJiraLedger, parseJiraProjectAllowlist, validateJiraHost, validateJiraToolCall } from "./jira.js";

function storyGraph() {
  let graph = createEmptyGraph("jira-diagram", "userstory");
  graph = applyPatch(graph, { id: "jira-story", base_version: 0, origin: "user", via: "manual", reason: "Fixture", ops: [{ type: "add_node", node: { id: "story-1", type: "story", label: "Sign in", props: { story_id: "US-12", story: "As a member, I want to sign in so that I can access my workspace", persona: "member", benefit: "access workspace", acceptance: [{ given: "I am registered", when: "I submit valid credentials", then: "I reach my workspace" }] }, confidence: 1, origin: "user", via: "manual" } }] }).graph;
  return graph;
}

describe("Jira approval safeguards", () => {
  it("allows only exact server-configured projects and hosts", () => {
    const projects = parseJiraProjectAllowlist("DOODLE, TEAM_2");
    expect([...projects]).toEqual(["DOODLE", "TEAM_2"]);
    expect(() => validateJiraHost("https://other.atlassian.net", new Set(["example.atlassian.net"]))).toThrow("allowlist");
    expect(() => validateJiraHost("http://example.atlassian.net", new Set(["example.atlassian.net"]))).toThrow("HTTPS");
  });
  it("builds one approved story call and sanitizes content before preview", () => {
    const graph = storyGraph();
    const toolCall = buildFixtureJiraToolCall(graph, "story-1", "DOODLE");
    const payload = validateJiraToolCall(graph, "story-1", "DOODLE", new Set(["DOODLE"]), toolCall);
    expect(payload.summary).toContain("US-");
    expect(payload.description).toContain("Given I am registered");
    expect(() => validateJiraToolCall(graph, "story-1", "ELSEWHERE", new Set(["DOODLE"]), toolCall)).toThrow("allowlist");
  });
  it("dry-runs idempotently without a network call and creates only after approval", async () => {
    const graph = storyGraph();
    const payload = validateJiraToolCall(graph, "story-1", "DOODLE", new Set(["DOODLE"]), buildFixtureJiraToolCall(graph, "story-1", "DOODLE"));
    const ledger = createJiraLedger();
    const options = { dryRun: true, baseUrl: "https://example.atlassian.net", allowedHosts: new Set(["example.atlassian.net"]), allowedProjects: new Set(["DOODLE"]), ledger };
    expect((await approveJiraIssue(payload, options)).status).toBe("dry-run");
    expect((await approveJiraIssue(payload, options)).status).toBe("already-executed");
    let requests = 0;
    const live = await approveJiraIssue(payload, { ...options, dryRun: false, email: "user@example.com", apiToken: "never logged", ledger: createJiraLedger(), fetcher: async () => { requests += 1; return new Response(JSON.stringify({ key: "DOODLE-123" }), { status: 201 }); } });
    expect(live).toMatchObject({ status: "created", key: "DOODLE-123" });
    expect(requests).toBe(1);
  });
});
