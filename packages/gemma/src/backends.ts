import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import * as z from "zod";
import { inputHash } from "./adapter.js";
import type {
  AdapterChunk,
  FixtureRecord,
  GemmaBackend,
  GenerateRequest,
  ModelMode,
  ResponseCache,
} from "./types.js";

export const GEMINI_MODEL_ID = "gemini-3.8-flash";

export class FixtureBackend implements GemmaBackend {
  readonly name = "fixture";
  readonly mode: ModelMode = "local";
  private readonly records: Map<string, FixtureRecord>;

  constructor(records: FixtureRecord[]) {
    this.records = new Map(records.map((record) => [record.inputHash, record]));
  }

  static async fromFile(path: string): Promise<FixtureBackend> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { records: FixtureRecord[] };
    return new FixtureBackend(parsed.records);
  }

  async *generate(request: GenerateRequest): AsyncIterable<AdapterChunk> {
    const hash = inputHash(request);
    const record = this.records.get(hash);
    if (!record) throw new Error(`No recorded model fixture matches input hash ${hash}`);
    for (const chunk of record.chunks) yield structuredClone(chunk);
  }
}

export class JsonResponseCache implements ResponseCache {
  private readonly path: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(path = ".doodleforge/response-cache.json") { this.path = path; }

  private async readEntries(): Promise<Record<string, AdapterChunk[]>> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as Record<string, AdapterChunk[]>; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(key: string): Promise<AdapterChunk[] | undefined> {
    const chunks = (await this.readEntries())[key];
    return chunks ? structuredClone(chunks) : undefined;
  }

  async set(key: string, chunks: AdapterChunk[]): Promise<void> {
    this.pending = this.pending.then(async () => {
      const entries = await this.readEntries();
      entries[key] = structuredClone(chunks);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
    });
    await this.pending;
  }
}

export class RecordingBackend implements GemmaBackend {
  readonly mode: ModelMode;
  readonly name: string;
  private readonly inner: GemmaBackend;
  private readonly path: string;

  constructor(inner: GemmaBackend, path: string) {
    this.inner = inner;
    this.path = path;
    this.mode = inner.mode;
    this.name = `recording(${inner.name})`;
  }

  async *generate(request: GenerateRequest): AsyncIterable<AdapterChunk> {
    const chunks: AdapterChunk[] = [];
    for await (const chunk of this.inner.generate(request)) {
      chunks.push(structuredClone(chunk));
      yield chunk;
    }
    let records: FixtureRecord[] = [];
    try { records = (JSON.parse(await readFile(this.path, "utf8")) as { records: FixtureRecord[] }).records; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const record: FixtureRecord = {
      inputHash: inputHash(request), chunks,
      metadata: { model: GEMINI_MODEL_ID, pass: request.pass, promptVersion: request.promptVersion },
    };
    const index = records.findIndex((entry) => entry.inputHash === record.inputHash);
    if (index < 0) records.push(record);
    else records[index] = record;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ records }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

export type NativeGenAIClient = {
  models: {
    generateContent(parameters: GenerateContentParameters): Promise<GenerateContentResponse>;
  };
};

export class GoogleGenAIBackend implements GemmaBackend {
  readonly name = "google-genai";
  readonly mode: ModelMode = "hosted";
  private readonly apiKey?: string;
  private readonly client?: NativeGenAIClient;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];

  constructor(options: { apiKey?: string; client?: NativeGenAIClient; timeoutMs?: number; retryDelaysMs?: number[] } = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.client = options.client;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  async *generate(request: GenerateRequest): AsyncIterable<AdapterChunk> {
    if (!this.client && !this.apiKey) throw new Error("Set GEMINI_API_KEY on the API server before using Gemini 3.8 Flash");
    if (googleRateLimitedUntil > Date.now()) {
      const waitSeconds = googleRateLimitRemainingSeconds();
      throw new GeminiRequestError(`Google rate-limited this project recently. DoodleForge paused model requests for ${waitSeconds}s to avoid repeating the 429. The API key was not rejected; use this page's offline demo or wait for the cooldown.`, { status: 429, retryable: false, attempts: 0 });
    }
    const client = this.client ?? new GoogleGenAI({ apiKey: this.apiKey! });
    const contents = request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: message.parts.map((part) => {
        if (part.type === "text") return { text: part.text };
        if (part.type === "image") {
          if (!part.data) throw new Error("Google Gemini image requests require inline image data");
          return { inlineData: { mimeType: part.mimeType, data: part.data } };
        }
        return { inlineData: { mimeType: audioMimeType(part.format), data: part.data } };
      }),
    }));
    const schema = request.schema
      ? (request.pass === "A" && request.promptVersion.includes("transcribe")
        ? compactTranscriptionProviderSchema()
        : request.pass === "B" && request.promptVersion.includes("structure")
          ? compactPatchBatchProviderSchema()
          : z.toJSONSchema(request.schema, { unrepresentable: "any", cycles: "ref" })) as Record<string, unknown>
      : undefined;
    if (schema) delete schema.$schema;
    const functionDeclarations = request.tools?.map((tool) => {
      const parametersJsonSchema = tool.parameters instanceof z.ZodType
        ? z.toJSONSchema(tool.parameters, { unrepresentable: "any", cycles: "ref" })
        : tool.parameters;
      if (parametersJsonSchema && typeof parametersJsonSchema === "object" && "$schema" in parametersJsonSchema) {
        delete (parametersJsonSchema as Record<string, unknown>).$schema;
      }
      return {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parametersJsonSchema,
      };
    });
    const config: NonNullable<GenerateContentParameters["config"]> = {
      systemInstruction: request.system,
      httpOptions: { timeout: this.timeoutMs },
      ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}),
      ...(request.thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      ...(functionDeclarations?.length ? {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: functionDeclarations.map((tool) => tool.name) } },
      } : {}),
    };
    const response = await generateWithTransientRetry(
      () => client.models.generateContent({ model: GEMINI_MODEL_ID, contents, config }),
      request.pass,
      this.retryDelaysMs,
    );
    if (response.text) yield { text: response.text };
    const toolCalls = (response.functionCalls ?? []).filter((call) => call.name).map((call) => ({
      name: call.name!,
      arguments: call.args ?? {},
    }));
    if (toolCalls.length) yield { toolCalls };
    yield { done: true };
  }
}

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [700, 1_600];
const GOOGLE_RATE_LIMIT_COOLDOWN_MS = 60_000;
let googleRateLimitedUntil = 0;

export function resetGoogleRateLimitForTests() { googleRateLimitedUntil = 0; }
export function googleRateLimitRemainingSeconds() { return Math.max(0, Math.ceil((googleRateLimitedUntil - Date.now()) / 1000)); }

export class GeminiRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryable: boolean;
  readonly attempts: number;

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean; attempts?: number } = {}) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.attempts = options.attempts ?? 1;
  }
}

async function generateWithTransientRetry<T>(operation: () => Promise<T>, pass: string, retryDelays = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const info = providerErrorInfo(error);
      const retryable = TRANSIENT_STATUS_CODES.has(info.status ?? 0) || info.code === "ECONNRESET" || info.code === "ETIMEDOUT" || info.code === "ENOTFOUND" || info.code === "EAI_AGAIN";
      if (info.status === 429) {
        googleRateLimitedUntil = Date.now() + GOOGLE_RATE_LIMIT_COOLDOWN_MS;
        throw new GeminiRequestError(formatGeminiFailure(info, pass, attempt), { ...info, retryable: false, attempts: attempt });
      }
      const retryIndex = attempt - 1;
      if (!retryable || retryIndex >= retryDelays.length) {
        throw new GeminiRequestError(formatGeminiFailure(info, pass, attempt), { ...info, retryable, attempts: attempt });
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelays[retryIndex]!));
    }
  }
}

function providerErrorInfo(error: unknown): { message: string; status?: number; code?: string } {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(candidate.status ?? candidate.statusCode);
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  let message = rawMessage;
  try {
    const parsed = JSON.parse(rawMessage) as { error?: { message?: string; status?: string; code?: number } };
    message = parsed.error?.message ?? rawMessage;
  } catch { /* SDK messages can be plain text */ }
  return { message: message.slice(0, 500), ...(Number.isFinite(status) && status > 0 ? { status } : {}), ...(code ? { code } : {}) };
}

function formatGeminiFailure(info: { message: string; status?: number; code?: string }, pass: string, attempts: number) {
  const status = info.status;
  if (status === 429) return `Google rate-limited the Gemini request (429) during ${pass}. DoodleForge made one attempt and paused further model requests for 60 seconds. This does not mean the API key is invalid. Use the page's offline demo or wait for the cooldown.`;
  if (status === 503) return `Gemini is temporarily overloaded (503) during the ${pass} request. DoodleForge made ${attempts} attempts, including ${Math.max(0, attempts - 1)} retries. Please wait a minute and retry, or use the page's offline demo.`;
  if (status === 504 || info.code === "ETIMEDOUT") return `Gemini took too long to finish the ${pass} request${status ? ` (${status})` : ""}. DoodleForge retried ${attempts} times. Try a smaller image or retry shortly.`;
  if (status === 401 || status === 403) return `Gemini rejected the API key or its access (${status}). Add a valid Google AI Studio key in Model setup.`;
  if (status === 400) return `Gemini rejected the ${pass} request (${status}): ${info.message}. Check the feature input and try again.`;
  if (info.code === "ECONNRESET" || info.code === "ENOTFOUND" || info.code === "EAI_AGAIN") return `Could not reach Gemini (${info.code}). Check the internet connection and retry.`;
  return `Gemini ${pass} request failed${status ? ` (${status})` : ""}: ${info.message}`;
}

export function explainGeminiError(error: unknown) {
  if (error instanceof GeminiRequestError) return error.message;
  const info = providerErrorInfo(error);
  return formatGeminiFailure(info, "model", 1);
}

/** Small provider schema for Pass A; local Zod enforces numeric bounds and the exact four-value box tuple. */
function compactTranscriptionProviderSchema() {
  return {
    type: "object", additionalProperties: false, required: ["tags", "arrows"],
    properties: {
      tags: { type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["tagId", "kind", "text", "shape", "box", "confidence", "unreadable"],
        properties: {
          tagId: { type: "integer" }, kind: { type: "string", enum: ["header", "note", "arrow", "text", "icon"] },
          text: { type: "string" }, shape: { type: "string" },
          box: { type: "array", items: { type: "integer" } },
          confidence: { type: "number" }, unreadable: { type: "boolean" },
        },
      } },
      arrows: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["tagId", "tailTag", "headTag"],
        properties: {
          tagId: { type: "integer" }, tailTag: { type: "integer", nullable: true }, headTag: { type: "integer", nullable: true },
        },
      } },
    },
  };
}

/** Keep Gemini's constrained schema small for the IR patch union; full Zod validation remains authoritative. */
function compactPatchBatchProviderSchema() {
  const opTypes = ["add_node", "update_node", "remove_node", "merge_nodes", "add_edge", "update_edge", "remove_edge", "group", "ungroup", "set_domain", "set_style", "set_constraints", "add_assumption", "ask_question", "resolve_question", "replace_all"];
  const origin = ["gemma", "rule", "user"];
  const via = ["sketch", "text", "voice", "manual"];
  return {
    type: "object", additionalProperties: false, required: ["patches", "assumptions", "questions"],
    properties: {
      patches: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["id", "base_version", "origin", "via", "reason", "ops"],
        properties: {
          id: { type: "string" }, base_version: { type: "integer", minimum: 0 },
          origin: { type: "string", enum: origin }, via: { type: "string", enum: via }, reason: { type: "string" },
          ops: { type: "array", items: {
            type: "object", additionalProperties: true, required: ["type"],
            properties: {
              type: { type: "string", enum: opTypes },
              node: { type: "object" }, edge: { type: "object" }, group: { type: "object" },
              assumption: { type: "object" }, question: { type: "object" }, graph: { type: "object" },
              id: { type: "string" }, source_id: { type: "string" }, target_id: { type: "string" },
              question_id: { type: "string" }, domain: { type: "string" }, label: { type: "string" },
              style: { type: "object" }, constraints: { type: "object" }, diagnostics: { type: "array" },
            },
            anyOf: [
              ...["add_node", "update_node"].map((type) => ({ properties: { type: { enum: [type] } }, required: ["type", "node"] })),
              ...["add_edge", "update_edge"].map((type) => ({ properties: { type: { enum: [type] } }, required: ["type", "edge"] })),
              { properties: { type: { enum: ["group"] } }, required: ["type", "group"] },
              { properties: { type: { enum: ["add_assumption"] } }, required: ["type", "assumption"] },
              { properties: { type: { enum: ["ask_question"] } }, required: ["type", "question"] },
              { properties: { type: { enum: ["replace_all"] } }, required: ["type", "graph"] },
              ...["remove_node", "remove_edge", "ungroup", "remove_assumption", "remove_question"].map((type) => ({ properties: { type: { enum: [type] } }, required: ["type", "id"] })),
              { properties: { type: { enum: ["merge_nodes"] } }, required: ["type", "source_id", "target_id"] },
              { properties: { type: { enum: ["set_domain"] } }, required: ["type", "domain"] },
              { properties: { type: { enum: ["set_style"] } }, required: ["type", "style"] },
              { properties: { type: { enum: ["set_constraints"] } }, required: ["type", "constraints"] },
              { properties: { type: { enum: ["set_diagnostics"] } }, required: ["type", "diagnostics"] },
              { properties: { type: { enum: ["resolve_question"] } }, required: ["type", "question_id"] },
              { properties: { type: { enum: ["set_source"] } }, required: ["type"] },
            ],
          } },
        },
      } },
      assumptions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text", "status", "patchId"], properties: {
        id: { type: "string" }, text: { type: "string" }, status: { type: "string", enum: ["open", "accepted", "rejected"] }, patchId: { type: "string" },
      } } },
      questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text", "options", "targets"], properties: {
        id: { type: "string" }, text: { type: "string" }, options: { type: "array", items: { type: "string" } }, targets: { type: "array", items: { type: "string" } },
      } } },
    },
  };
}

export function geminiApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return env.GEMINI_API_KEY?.trim() || env.GEMMA_API_KEY?.trim() || undefined;
}

export function googleGenAiBackendFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return new GoogleGenAIBackend({ apiKey: geminiApiKeyFromEnv(env) });
}

export function getGeminiConnectionSettings(env: NodeJS.ProcessEnv = process.env) {
  return {
    provider: "Google Gemini API",
    mode: "hosted" as const,
    model: GEMINI_MODEL_ID,
    apiKeyConfigured: Boolean(geminiApiKeyFromEnv(env)),
  };
}

function audioMimeType(format: "wav" | "mp3" | "m4a" | "webm") {
  return { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm" }[format];
}
