import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPatch, createEmptyGraph } from "@doodleforge/ir";
import type { Patch } from "@doodleforge/ir";
import { resetPendingActionsForTests } from "./actions.js";
import { resetJiraActionsForTests } from "./jira-actions.js";
import { buildServer } from "./server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  resetPendingActionsForTests();
  resetJiraActionsForTests();
  vi.unstubAllGlobals();
});

describe("Fastify sketch API", () => {
  it("reports the native Google backend without exposing configuration values", async () => {
    const server = buildServer({ GEMINI_API_KEY: "not-returned" });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, mode: "hosted", backend: "google-genai" });
    expect(response.body).not.toContain("not-returned");
  });

  it("reports only safe model settings and never returns the API key", async () => {
    const server = buildServer({ GEMINI_API_KEY: "private-key" });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/api/model/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: "Google Gemini API", mode: "hosted", model: "gemini-3.8-flash", apiKeyConfigured: true });
    expect(response.body).not.toContain("private-key");
  });

  it("explains the missing hosted key without making an outbound request", async () => {
    const server = buildServer({ GEMINI_API_KEY: "" });
    servers.push(server);
    const response = await server.inject({ method: "POST", url: "/api/model/test" });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("GEMINI_API_KEY is missing");
  });

  it("streams a recorded graph from a fixture job", async () => {
    const server = buildServer({});
    servers.push(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { kind: "fixture", fixtureId: "member-board" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain('event: begin');
    expect(response.body).toContain('event: node');
    expect(response.body).toContain('event: diagnostics');
    expect(response.body).toContain('event: done');
  });

  it("rejects voice clips longer than 30 seconds before opening a model job", async () => {
    const server = buildServer({});
    servers.push(server);
    const response = await server.inject({ method: "POST", url: "/api/voice/jobs", payload: { kind: "voice", data: "AA==", mimeType: "audio/wav", durationMs: 30_001 } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_voice_job");
  });

  it("keeps the voice request on SSE and reports a missing server key without a network call", async () => {
    const server = buildServer({ GEMINI_API_KEY: "" });
    servers.push(server);
    const response = await server.inject({ method: "POST", url: "/api/voice/jobs", payload: { kind: "voice", data: "AA==", mimeType: "audio/wav", durationMs: 1200 } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain('event: error');
    expect(response.body).toContain("GEMINI_API_KEY");
  });

  it("shows an approval card and completes only a dry-run after the approval route", async () => {
    const graph = createEmptyGraph("action-test", "userstory");
    const patch: Patch = {
      id: "story-seed",
      base_version: 0,
      origin: "user",
      via: "manual",
      reason: "Create verified story",
      ops: [{ type: "add_node", node: {
        id: "story-export",
        type: "story",
        label: "Export a report",
        props: {
          story: "As a member, I want to export a report so that I can share it",
          persona: "Member",
          acceptance: [{ given: "I am signed in", when: "I export the report", then: "A CSV downloads" }],
        },
        confidence: 1,
        origin: "user",
        via: "manual",
      } }],
    };
    const current = applyPatch(graph, patch).graph;
    const server = buildServer({ GITHUB_REPO_ALLOWLIST: "acme/demo", GITHUB_DRY_RUN: "true" });
    servers.push(server);
    const proposal = await server.inject({
      method: "POST",
      url: "/api/actions/propose",
      payload: { graph: current, selectedNodeIds: ["story-export"], repository: "acme/demo", mode: "fixture" },
    });
    expect(proposal.statusCode).toBe(200);
    const action = proposal.json<{ actions: Array<{ id: string; payload: { title: string; body: string } }> }>().actions[0]!;
    expect(action.payload.title).toContain("Export a report");
    const approved = await server.inject({ method: "POST", url: `/api/actions/${action.id}/approve` });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "dry-run", payload: { repository: "acme/demo" } });
    expect(approved.body).not.toContain("https://github.com");
  });

  it("does not disclose GitHub credentials from settings", async () => {
    const server = buildServer({ GITHUB_TOKEN: "never-return-this", GITHUB_REPO_ALLOWLIST: "acme/demo" });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/api/settings" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("acme/demo");
    expect(response.body).not.toContain("never-return-this");
  });

  it("requires an approval click before a Jira dry-run and keeps Jira secrets out of settings", async () => {
    let graph = createEmptyGraph("jira-route-test", "userstory");
    graph = applyPatch(graph, { id: "jira-seed", base_version: 0, origin: "user", via: "manual", reason: "Create a verified story", ops: [{ type: "add_node", node: {
      id: "jira-story", type: "story", label: "Export a report", props: {
        story: "As a member, I want to export a report so that I can share it", persona: "Member", benefit: "share the report",
        acceptance: [{ given: "I am signed in", when: "I export", then: "A CSV downloads" }],
      }, confidence: 1, origin: "user", via: "manual",
    } }] }).graph;
    const server = buildServer({ JIRA_PROJECT_ALLOWLIST: "DOODLE", JIRA_DRY_RUN: "true", JIRA_API_TOKEN: "secret-not-returned" });
    servers.push(server);
    const settings = await server.inject({ method: "GET", url: "/api/settings" });
    expect(settings.json().jira.projects).toEqual(["DOODLE"]);
    expect(settings.body).not.toContain("secret-not-returned");
    const proposal = await server.inject({ method: "POST", url: "/api/jira/actions/propose", payload: { graph, selectedNodeIds: ["jira-story"], project: "DOODLE", mode: "fixture" } });
    expect(proposal.statusCode).toBe(200);
    const action = proposal.json<{ actions: Array<{ id: string; payload: { summary: string; description: string } }> }>().actions[0]!;
    expect(action.payload.summary).toContain("Export a report");
    const approved = await server.inject({ method: "POST", url: `/api/jira/actions/${action.id}/approve` });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "dry-run", payload: { project: "DOODLE" } });
  });

  it("reports Terraform CLI absence as unverified without running a plan", async () => {
    const graph = { ...createEmptyGraph("cloud-route-test", "cloud"), nodes: [{ id: "bucket", type: "bucket", label: "Uploads", props: {}, confidence: 1, origin: "user", via: "manual" }] };
    const server = buildServer({ TERRAFORM_BINARY: "doodleforge-terraform-not-installed" });
    servers.push(server);
    const response = await server.inject({ method: "POST", url: "/api/cloud/terraform/verify", payload: graph });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ verified: false, status: "unavailable", stage: "fmt" });
  });
});
