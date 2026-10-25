import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";
import { ThinkingLevel } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGemmaAdapter,
  generateWithRepair,
  inputHash,
  MemoryResponseCache,
  responseCacheKey,
} from "./adapter.js";
import { FixtureBackend, GeminiRequestError, GoogleGenAIBackend, GEMINI_MODEL_ID, RecordingBackend, googleGenAiBackendFromEnv, resetGoogleRateLimitForTests, type NativeGenAIClient } from "./backends.js";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import type { GenerateRequest } from "./types.js";

const fixtureRequest: GenerateRequest = {
  model: "small",
  pass: "B",
  promptVersion: "phase0-fixture-v1",
  system: "You are replaying the offline DoodleForge fixture.",
  messages: [
    {
      role: "user",
      parts: [{ type: "text", text: "Replay the Phase 0 contract fixture." }],
    },
  ],
  sampling: { temperature: 1, top_p: 0.95, top_k: 64 },
};

describe("Gemma adapter", () => {
  afterEach(() => resetGoogleRateLimitForTests());
  it("uses native GoogleGenAI generateContent and Gemini 3.8 Flash with JSON Schema", async () => {
    let received: GenerateContentParameters | undefined;
    const client: NativeGenAIClient = { models: { generateContent: async (parameters) => {
      received = parameters;
      return { text: '{"answer":42}', functionCalls: [] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client });
    const request: GenerateRequest = {
      ...fixtureRequest,
      thinking: true,
      schema: z.object({ answer: z.number().int() }).strict(),
    };
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    const output = [];
    for await (const chunk of adapter.generate(request)) output.push(chunk);
    expect(received?.model).toBe("gemini-3.8-flash");
    expect(received?.config?.responseMimeType).toBe("application/json");
    expect(received?.config?.responseJsonSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["answer"] });
    expect(received?.config?.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.LOW });
    expect(received?.config?.temperature).toBeUndefined();
    expect(received?.config?.topP).toBeUndefined();
    expect(received?.config?.topK).toBeUndefined();
    expect(output.at(-1)?.value).toEqual({ answer: 42 });
    expect(googleGenAiBackendFromEnv({ GEMINI_API_KEY: "test-key" }).name).toBe("google-genai");
    expect(GEMINI_MODEL_ID).toBe("gemini-3.8-flash");
  });

  it("requires operation payloads in the compact structure-pass schema", async () => {
    let received: GenerateContentParameters | undefined;
    const client: NativeGenAIClient = { models: { generateContent: async (parameters) => {
      received = parameters;
      return { text: '{"patches":[],"assumptions":[],"questions":[]}', functionCalls: [] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client });
    const request: GenerateRequest = {
      ...fixtureRequest,
      promptVersion: "doodleforge-structure-v1",
      schema: z.object({ patches: z.array(z.object({ ops: z.array(z.unknown()) })) }),
    };
    for await (const _chunk of backend.generate(request)) void _chunk;
    const responseSchema = received?.config?.responseJsonSchema as Record<string, any> | undefined;
    const opsSchema = responseSchema?.properties?.patches?.items?.properties?.ops?.items as { anyOf: Array<{ properties: { type: { enum: string[] } }; required: string[] }> };
    const nodeCases = opsSchema.anyOf.filter((branch) => branch.properties.type.enum.some((type) => ["add_node", "update_node"].includes(type)));
    const edgeCases = opsSchema.anyOf.filter((branch) => branch.properties.type.enum.some((type) => ["add_edge", "update_edge"].includes(type)));
    expect(nodeCases.every((branch) => branch.required.includes("node"))).toBe(true);
    expect(edgeCases.every((branch) => branch.required.includes("edge"))).toBe(true);
  });

  it("uses a compact Pass A transcription schema compatible with Gemini structured output", async () => {
    let received: GenerateContentParameters | undefined;
    const client: NativeGenAIClient = { models: { generateContent: async (parameters) => {
      received = parameters;
      return { text: '{"tags":[],"arrows":[]}', functionCalls: [] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client });
    const request: GenerateRequest = {
      ...fixtureRequest,
      pass: "A",
      promptVersion: "phase2-transcribe-v1",
      schema: z.object({ tags: z.array(z.unknown()), arrows: z.array(z.unknown()) }),
    };
    for await (const _chunk of backend.generate(request)) void _chunk;
    const schema = received?.config?.responseJsonSchema as Record<string, any>;
    expect(schema.required).toEqual(["tags", "arrows"]);
    expect(schema.properties.tags.items.required).toContain("box");
    expect(schema.properties.tags.items.properties.box).toEqual({ type: "array", items: { type: "integer" } });
    expect(schema.properties.arrows.items.properties.tailTag).toEqual({ type: "integer", nullable: true });
    expect(JSON.stringify(schema)).not.toContain("prefixItems");
    expect(JSON.stringify(schema)).not.toContain("maxItems");
  });

  it("retries temporary 503 overloads and succeeds on the next provider attempt", async () => {
    let calls = 0;
    const client: NativeGenAIClient = { models: { generateContent: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error(JSON.stringify({ error: { code: 503, message: "High demand", status: "UNAVAILABLE" } })), { status: 503 });
      return { text: "available", functionCalls: [] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client, retryDelaysMs: [0, 0] });
    const chunks = [];
    for await (const chunk of backend.generate(fixtureRequest)) chunks.push(chunk);
    expect(calls).toBe(3);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("available");
  });

  it("returns an actionable retry-exhausted error after repeated 503 overloads", async () => {
    let calls = 0;
    const client: NativeGenAIClient = { models: { generateContent: async () => {
      calls += 1;
      throw Object.assign(new Error(JSON.stringify({ error: { code: 503, message: "High demand", status: "UNAVAILABLE" } })), { status: 503 });
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client, retryDelaysMs: [0, 0] });
    await expect(async () => { for await (const _chunk of backend.generate(fixtureRequest)) void _chunk; })
      .rejects.toMatchObject<Partial<GeminiRequestError>>({ status: 503, attempts: 3, retryable: true, message: expect.stringContaining("temporarily overloaded") });
    expect(calls).toBe(3);
  });

  it("stops retrying 429s and pauses later model requests during the rate-limit cooldown", async () => {
    let calls = 0;
    const client: NativeGenAIClient = { models: { generateContent: async () => {
      calls += 1;
      throw Object.assign(new Error(JSON.stringify({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } })), { status: 429 });
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client, retryDelaysMs: [0, 0] });
    await expect(async () => { for await (const _chunk of backend.generate(fixtureRequest)) void _chunk; })
      .rejects.toMatchObject<Partial<GeminiRequestError>>({ status: 429, attempts: 1, message: expect.stringContaining("one attempt") });
    await expect(async () => { for await (const _chunk of backend.generate(fixtureRequest)) void _chunk; })
      .rejects.toThrow("paused model requests");
    expect(calls).toBe(1);
  });

  it("passes image and audio data as native inlineData parts", async () => {
    let received: GenerateContentParameters | undefined;
    const client: NativeGenAIClient = { models: { generateContent: async (parameters) => {
      received = parameters;
      return { text: "ok", functionCalls: [] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client });
    const request: GenerateRequest = {
      ...fixtureRequest,
      messages: [{ role: "user", parts: [
        { type: "text", text: "Read this sketch and clip." },
        { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
        { type: "audio", format: "webm", data: "YXVkaW8=" },
      ] }],
    };
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    for await (const _chunk of adapter.generate(request)) void _chunk;
    const firstContent = Array.isArray(received?.contents) ? received.contents[0] : undefined;
    const parts = firstContent && typeof firstContent === "object" && "parts" in firstContent ? firstContent.parts : undefined;
    expect(parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } },
      { inlineData: { mimeType: "audio/webm", data: "YXVkaW8=" } },
      { text: "Read this sketch and clip." },
    ]);
  });

  it("sends a bounded strict provider schema for structure patches while Zod remains authoritative", async () => {
    let received: GenerateContentParameters | undefined;
    const client: NativeGenAIClient = { models: { generateContent: async (parameters) => {
      received = parameters;
      return { text: '{"answer":42}', functionCalls: [] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client });
    const request: GenerateRequest = { ...fixtureRequest, pass: "B", promptVersion: "phase2-structure-v1", schema: z.object({ answer: z.number().int() }).strict() };
    for await (const _chunk of backend.generate(request)) void _chunk;
    expect(received?.config?.responseJsonSchema).toMatchObject({ additionalProperties: false, required: ["patches", "assumptions", "questions"] });
    expect(JSON.stringify(received?.config?.responseJsonSchema)).toContain("replace_all");
  });

  it("uses native function declarations and surfaces model tool calls", async () => {
    let received: GenerateContentParameters | undefined;
    const client: NativeGenAIClient = { models: { generateContent: async (parameters) => {
      received = parameters;
      return { text: undefined, functionCalls: [{ name: "create_issue", args: { title: "Example" } }] } as unknown as GenerateContentResponse;
    } } };
    const backend = new GoogleGenAIBackend({ apiKey: "test-key", client });
    const request: GenerateRequest = {
      ...fixtureRequest,
      tools: [{ name: "create_issue", description: "Create one issue", parameters: z.object({ title: z.string() }).strict() }],
    };
    const chunks = [];
    for await (const chunk of backend.generate(request)) chunks.push(chunk);
    expect(received?.config?.tools).toBeDefined();
    expect(received?.config?.toolConfig?.functionCallingConfig).toMatchObject({ mode: "ANY", allowedFunctionNames: ["create_issue"] });
    expect(chunks.find((chunk) => chunk.toolCalls)?.toolCalls).toEqual([{ name: "create_issue", arguments: { title: "Example" } }]);
  });

  it("replays a recorded fixture with no network backend", async () => {
    const fixturePath = new URL("../../../fixtures/gemma/phase0-replay.json", import.meta.url);
    const fixtureFile = JSON.parse(await readFile(fixturePath, "utf8")) as { records: unknown[] };
    expect(fixtureFile.records).toHaveLength(1);
    const backend = await FixtureBackend.fromFile(fixturePath.pathname);
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    const chunks = [];
    let networkAttempts = 0;
    vi.stubGlobal("fetch", async () => {
      networkAttempts += 1;
      throw new Error("Network is disabled in fixture replay");
    });
    try {
      for await (const chunk of adapter.generate(fixtureRequest)) chunks.push(chunk);
    } finally {
      vi.unstubAllGlobals();
    }
    const output = chunks.map((chunk) => chunk.text ?? "").join("");
    expect(JSON.parse(output)).toEqual({ phase: 0, fixtureReplay: true });
    expect(adapter.mode).toBe("local");
    expect(networkAttempts).toBe(0);
  });

  it("keys cache entries by input hash, pass, model, and prompt version", () => {
    expect(inputHash(fixtureRequest)).toMatch(/^[a-f0-9]{64}$/);
    expect(responseCacheKey(fixtureRequest)).not.toBe(
      responseCacheKey({ ...fixtureRequest, promptVersion: "phase0-fixture-v2" }),
    );
  });

  it("reorders image parts ahead of text before a backend call", async () => {
    const request = {
      ...fixtureRequest,
      messages: [
        {
          role: "user",
          parts: [
            { type: "text" as const, text: "Describe this." },
            { type: "image" as const, mimeType: "image/png", data: "AA==" },
          ],
        },
      ],
    };
    let received: GenerateRequest | undefined;
    const backend = {
      mode: "local" as const,
      name: "capture",
      async *generate(input: GenerateRequest) {
        received = input;
        yield { text: "ok" };
      },
    };
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    for await (const _chunk of adapter.generate(request)) void _chunk;
    expect(received?.messages[0]?.parts[0]?.type).toBe("image");
    expect(received?.messages[0]?.parts[1]?.type).toBe("text");
  });

  it("records a backend response as an input-hash fixture and replays it", async () => {
    const temp = await mkdtemp(join(tmpdir(), "doodleforge-fixture-"));
    try {
      const path = join(temp, "recording.json");
      const backend = {
        mode: "local" as const,
        name: "deterministic-test",
        async *generate() {
          yield { text: "recorded response" };
        },
      };
      const recorder = new RecordingBackend(backend, path);
      const recordingAdapter = createGemmaAdapter({ backend: recorder, cache: new MemoryResponseCache() });
      for await (const _chunk of recordingAdapter.generate(fixtureRequest)) void _chunk;
      const replay = await FixtureBackend.fromFile(path);
      const replayAdapter = createGemmaAdapter({ backend: replay, cache: new MemoryResponseCache() });
      const output = [];
      for await (const chunk of replayAdapter.generate(fixtureRequest)) output.push(chunk.text);
      expect(output.join("")).toBe("recorded response");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("caches completed responses under the full pass/model/prompt key", async () => {
    let calls = 0;
    const backend = {
      mode: "local" as const,
      name: "counting",
      async *generate() {
        calls += 1;
        yield { text: "cached" };
      },
    };
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    for (let run = 0; run < 2; run += 1) {
      for await (const _chunk of adapter.generate(fixtureRequest)) void _chunk;
    }
    expect(calls).toBe(1);
  });

  it("feeds the validator error into up to two structured repair retries", async () => {
    let calls = 0;
    let repairPrompt = "";
    const backend = {
      mode: "local" as const,
      name: "repair-test",
      async *generate(request: GenerateRequest) {
        calls += 1;
        if (calls === 1) yield { text: '{"answer":"not a number"}' };
        else {
          const finalPart = request.messages.at(-1)?.parts[0];
          repairPrompt = finalPart?.type === "text" ? finalPart.text : "";
          yield { text: '{"answer":42}' };
        }
      },
    };
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    const result = await generateWithRepair(adapter, { ...fixtureRequest, schema: z.object({ answer: z.number() }) });
    expect(result).toEqual({ answer: 42 });
    expect(calls).toBe(2);
    expect(repairPrompt).toContain("Invalid input: expected number");
  });

  it("repairs add_node and add_edge operations that omit their payloads", async () => {
    let calls = 0;
    let repairPrompt = "";
    const operationSchema = z.discriminatedUnion("type", [
      z.object({ type: z.literal("add_node"), node: z.object({ id: z.string() }) }).strict(),
      z.object({ type: z.literal("add_edge"), edge: z.object({ id: z.string() }) }).strict(),
    ]);
    const schema = z.object({ patches: z.array(z.object({ ops: z.array(operationSchema) })) });
    const backend = {
      mode: "local" as const,
      name: "missing-op-payload-test",
      async *generate(request: GenerateRequest) {
        calls += 1;
        if (calls === 1) yield { text: '{"patches":[{"ops":[{"type":"add_node"},{"type":"add_edge"}]}]}' };
        else {
          const finalPart = request.messages.at(-1)?.parts[0];
          repairPrompt = finalPart?.type === "text" ? finalPart.text : "";
          yield { text: '{"patches":[{"ops":[{"type":"add_node","node":{"id":"n1"}},{"type":"add_edge","edge":{"id":"e1"}}]}]}' };
        }
      },
    };
    const adapter = createGemmaAdapter({ backend, cache: new MemoryResponseCache() });
    const result = await generateWithRepair(adapter, { ...fixtureRequest, schema });
    expect(result.patches[0]?.ops).toHaveLength(2);
    expect(calls).toBe(2);
    expect(repairPrompt).toContain("expected object, received undefined");
  });

  it("rejects a missing Gemini key before making a model call", async () => {
    const backend = new GoogleGenAIBackend();
    await expect(async () => { for await (const _chunk of backend.generate(fixtureRequest)) void _chunk; })
      .rejects.toThrow("GEMINI_API_KEY");
  });
});

