import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { assertGraphInvariants, type Graph } from "@doodleforge/ir";
import type { GemmaBackend, GenerateRequest } from "@doodleforge/gemma";
import { demoSketches } from "./demo-fixtures.js";
import { getAdapterMode, runSketchJob, runVoiceJob } from "./pipeline.js";

describe("offline sketch pipeline", () => {
  it("advertises the native Google Gen AI backend and fixed Gemini model", async () => {
    await expect(getAdapterMode({})).resolves.toEqual({ mode: "hosted", backend: "google-genai" });
  });

  it("replays all ten recorded sketches with no network and streams validated patches", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("fixture mode must not use network"); });
    try {
      for (const fixture of demoSketches) {
        const events: Array<{ event: string; data: Record<string, unknown> }> = [];
        await runSketchJob({ kind: "fixture", fixtureId: fixture.id }, (event, data) => events.push({ event, data }));
        const done = events.find((entry) => entry.event === "done")?.data;
        expect(done).toBeDefined();
        const graph = done!.graph as Graph;
        assertGraphInvariants(graph);
        expect(graph.nodes.map((node) => node.label)).toContain(fixture.transcription.tags[1]!.text);
        expect(events.filter((entry) => entry.event === "patch").length).toBeGreaterThanOrEqual(4);
        expect(events.some((entry) => entry.event === "diagnostics")).toBe(true);
        expect(graph.assumptions).toHaveLength(1);
        expect(graph.assumptions[0]?.text).toBe(fixture.patchBatch.assumptions[0]?.text);
        expect(graph.nodes.find((node) => node.id.endsWith("-2"))?.props.acceptance).toHaveLength(1);
        expect(graph.nodes.find((node) => node.id.endsWith("-1"))?.props.acceptance).toBeUndefined();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("structures text offline through patches and surfaces ambiguity", async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runSketchJob({ kind: "text", mode: "fixture", text: "Make it faster" }, (event, data) => events.push({ event, data }));
    const graph = events.find((entry) => entry.event === "done")!.data.graph as Graph;
    assertGraphInvariants(graph);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.origin).toBe("rule");
    expect(graph.assumptions).toHaveLength(1);
    expect(graph.questions).toHaveLength(1);
    expect(events.filter((entry) => entry.event === "patch")).toHaveLength(1);
  });

  it("builds a usable software graph from the page's offline demo request", async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runSketchJob({ kind: "text", domainHint: "software", mode: "fixture", text: "Create a calculator screen" }, (event, data) => events.push({ event, data }));
    const graph = events.find((event) => event.event === "done")?.data.graph as Graph;
    expect(graph.domain).toBe("software");
    expect(graph.nodes.find((node) => node.type === "screen")?.label).toBe("Calculator");
    expect(graph.nodes.some((node) => node.type === "ui_component" && node.props.action === "equals")).toBe(true);
    expect(graph.edges.every((edge) => edge.relation === "contains")).toBe(true);
  });

  it.each([
    ["erd", "users(id uuid primary key, email text)\norders(id uuid primary key, user_id uuid)\nusers has many orders", "entity"],
    ["cloud", "A private uploads bucket connects to a PostgreSQL database", "bucket"],
    ["workflow", "Validate order, then charge payment, then send confirmation", "workflow_step"],
    ["circuit", "Inputs A and B feed an AND gate and output Y", "and"],
    ["userstory", "As a member, I want to sign in, so that I can access my account", "story"],
  ] as const)("keeps the %s feature usable through its offline text demo", async (domain, text, expectedType) => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runSketchJob({ kind: "text", domainHint: domain, mode: "fixture", text }, (event, data) => events.push({ event, data }));
    const graph = events.find((event) => event.event === "done")?.data.graph as Graph;
    expect(graph.domain).toBe(domain);
    expect(graph.nodes.some((node) => node.type === expectedType)).toBe(true);
    assertGraphInvariants(graph);
  });

  it("checks each feature's offline demo for meaningful output and valid links", async () => {
    const cases = [
      { domain: "userstory", text: "As a member, I want to sign in, so that I can access my account", types: ["story"] },
      { domain: "erd", text: "users(id uuid primary key, email text)\norders(id uuid primary key, user_id uuid)\nusers has many orders", types: ["entity"] },
      { domain: "cloud", text: "A private uploads bucket connects to a PostgreSQL database", types: ["service", "bucket", "database"] },
      { domain: "software", text: "Create a calculator screen", types: ["screen", "ui_component"] },
      { domain: "workflow", text: "On order submit, validate the address, charge payment, and then send confirmation.", types: ["workflow_step"] },
      { domain: "circuit", text: "Inputs A and B feed an AND gate and output Y", types: ["input", "and", "output"] },
    ] as const;
    for (const item of cases) {
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      await runSketchJob(
        { kind: "text", domainHint: item.domain, mode: "fixture", text: item.text },
        (event, data) => events.push({ event, data }),
        {},
        () => { throw new Error("offline feature demo must not initialize a Gemini backend"); },
      );
      const graph = events.find((event) => event.event === "done")?.data.graph as Graph;
      assertGraphInvariants(graph);
      for (const type of item.types) expect(graph.nodes.some((node) => node.type === type), `${item.domain} missing ${type}`).toBe(true);
      if (item.domain === "userstory") expect(graph.nodes.find((node) => node.type === "story")?.props.story).toContain("As a member");
      if (item.domain === "erd") expect(graph.edges.some((edge) => edge.relation === "one_to_many")).toBe(true);
      if (item.domain === "cloud") {
        expect(graph.nodes.find((node) => node.type === "bucket")?.props).toMatchObject({ public: false, encryption: true });
        expect(graph.edges.length).toBeGreaterThanOrEqual(2);
      }
      if (item.domain === "software") {
        expect(graph.nodes.some((node) => node.type === "ui_component" && node.props.action === "equals")).toBe(true);
        expect(graph.edges.every((edge) => edge.relation === "contains")).toBe(true);
      }
      if (item.domain === "workflow") {
        expect(graph.nodes.map((node) => node.label)).toEqual(["Order submit", "Validate the address", "Charge payment", "Send confirmation"]);
        expect(graph.edges).toHaveLength(3);
      }
      if (item.domain === "circuit") expect(graph.edges).toHaveLength(3);
    }
  });

  it("transcribes voice through the audio model pass and routes text into voice-tagged graph patches", async () => {
    const calls: string[] = [];
    const backendFactory = (): GemmaBackend => ({
      mode: "hosted", name: "native-sdk-test-double",
      async *generate(request: GenerateRequest) {
        calls.push(request.pass);
        if (request.pass === "voice-transcribe") {
          expect(request.messages[0]?.parts[0]?.type).toBe("audio");
          yield { text: JSON.stringify({ transcript: "Create a calculator app", domain: "software" }) };
          return;
        }
        const nodes = [
          { id: "screen-calculator", type: "screen", label: "Calculator", props: {}, confidence: 0.9, origin: "gemma", via: "text" },
          { id: "display-main", type: "ui_component", label: "Display", props: { component: "display" }, confidence: 0.9, origin: "gemma", via: "text" },
          { id: "button-7", type: "ui_component", label: "7", props: { component: "button", action: "digit" }, confidence: 0.9, origin: "gemma", via: "text" },
        ];
        yield { text: JSON.stringify({ patches: [{ id: "voice-ui-patch", base_version: 0, origin: "gemma", via: "text", reason: "Create calculator UI", ops: [
          ...nodes.map((node) => ({ type: "add_node", node })),
          { type: "add_edge", edge: { id: "screen-contains-display", from: { node: "screen-calculator" }, to: { node: "display-main" }, relation: "contains", confidence: 0.9, origin: "gemma", via: "text" } },
        ] }], assumptions: [], questions: [] }) };
      },
    });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runVoiceJob({ kind: "voice", data: Buffer.from(randomUUID()).toString("base64"), mimeType: "audio/wav", durationMs: 2500, domainHint: "software" }, (event, data) => events.push({ event, data }), { GEMINI_API_KEY: "fake-key-for-test" }, backendFactory);
    const transcript = events.find((event) => event.event === "voice-transcript")?.data;
    const graph = events.find((event) => event.event === "done")?.data.graph as Graph;
    expect(calls).toEqual(["voice-transcribe", "B"]);
    expect(transcript).toMatchObject({ transcript: "Create a calculator app", domain: "software", audioStored: false });
    expect(graph.nodes.find((node) => node.id === "screen-calculator")).toMatchObject({ via: "voice", origin: "gemma" });
    expect(graph.edges[0]).toMatchObject({ via: "voice", relation: "contains" });
  });

  it("uses an explicit image domain to create graph nodes without running classification", async () => {
    const calls: string[] = [];
    let repairPrompt = "";
    const box: [number, number, number, number] = [100, 120, 360, 620];
    const secondBox: [number, number, number, number] = [110, 650, 390, 920];
    const modelBox: [number, number, number, number] = [120, 130, 350, 610];
    const modelSecondBox: [number, number, number, number] = [120, 660, 380, 910];
    const nodeOps = [
      { type: "add_node", node: { id: "story-sign-in", type: "story", label: "Sign in", props: { story: "As a member, I want to sign in, so that I can access my account.", persona: "member" }, confidence: 0.9, origin: "gemma", via: "sketch" } },
      { type: "add_node", node: { id: "story-reset-password", type: "story", label: "Recover account", props: { story: "As a member, I want to reset my password, so that I can regain account access.", persona: "member" }, confidence: 0.8, origin: "gemma", via: "sketch" } },
    ];
    const invalidBatch = {
      patches: [{ id: "model-patch", base_version: 1, origin: "gemma", via: "sketch", reason: "Create two stories and their dependency", ops: [
        ...nodeOps,
        { type: "add_edge", edge: { id: "edge-reset-depends-on-sign-in", from: { node: "story-reset-password", port: "out" }, to: { node: "story-sign-in", port: "in" }, relation: "depends_on", confidence: 0.8, origin: "gemma", via: "sketch" } },
      ] }], assumptions: [], questions: [],
    };
    const repairedBatch = {
      patches: [{ id: "model-patch-repaired", base_version: 1, origin: "gemma", via: "sketch", reason: "Create stories without unsupported ports", ops: nodeOps }],
      assumptions: [], questions: [],
    };
    const structureReplies = [invalidBatch, repairedBatch];
    const backendFactory = (): GemmaBackend => ({
      mode: "hosted",
      name: "google-genai",
      async *generate(request: GenerateRequest) {
        calls.push(request.pass);
        if (request.pass === "B" && calls.filter((item) => item === "B").length === 2) repairPrompt = JSON.stringify(request.messages);
        const output = request.pass === "A"
          ? { tags: [{ tagId: 1, kind: "note", text: "Sign in", shape: "sticky_note", box: modelBox, confidence: 0.92 }, { tagId: 2, kind: "note", text: "Reset password", shape: "sticky_note", box: modelSecondBox, confidence: 0.9 }], arrows: [] }
          : structureReplies.shift();
        yield { text: JSON.stringify(output) };
      },
    });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    await runSketchJob({
        kind: "image", name: `storyboard-${randomUUID()}.png`, mimeType: "image/png", data: Buffer.from(randomUUID()).toString("base64"),
        width: 1000, height: 720, markers: [{ marker: 1, box, shapeGuess: "sticky note", confidence: 0.9 }, { marker: 2, box: secondBox, shapeGuess: "sticky note", confidence: 0.9 }],
        domainHint: "userstory", mode: "live",
      }, (event, data) => events.push({ event, data }), { GEMINI_API_KEY: "test-key" }, backendFactory);

    const transcription = events.find((entry) => entry.event === "transcription")?.data;
    const done = events.find((entry) => entry.event === "done")?.data;
    const graph = done?.graph as Graph;
    expect(calls).toEqual(["A", "B", "B"]);
    expect(repairPrompt).toContain("missing source port");
    expect(transcription?.classification).toMatchObject({ domain: "userstory", confidence: 1 });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.find((node) => node.id === "story-sign-in")).toMatchObject({ type: "story", label: "Sign in", region: { marker: 1, box } });
    expect(graph.nodes.find((node) => node.id === "story-reset-password")).toMatchObject({ type: "story", label: "Recover account", region: { marker: 2, box: secondBox } });
    expect(done?.mode).toBe("hosted");
  });
});
