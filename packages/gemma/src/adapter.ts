import { createHash } from "node:crypto";
import * as z from "zod";
import type {
  AdapterChunk,
  AdapterOptions,
  GenerateRequest,
  ResponseCache,
} from "./types.js";

const defaultSampling = { temperature: 1, top_p: 0.95, top_k: 64 };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function inputHash(request: GenerateRequest): string {
  const { schema, tools, ...rest } = request;
  return stableHash({
    ...rest,
    schema: schema ? z.toJSONSchema(schema, { unrepresentable: "any", cycles: "ref" }) : undefined,
    tools: tools?.map((tool) => ({
      ...tool,
      parameters:
        tool.parameters instanceof z.ZodType
          ? z.toJSONSchema(tool.parameters, { unrepresentable: "any", cycles: "ref" })
          : tool.parameters,
    })),
  });
}

export function responseCacheKey(request: GenerateRequest): string {
  return stableHash({
    inputHash: inputHash(request),
    pass: request.pass,
    model: request.model,
    promptVersion: request.promptVersion,
  });
}

export class MemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, AdapterChunk[]>();

  async get(key: string): Promise<AdapterChunk[] | undefined> {
    const value = this.entries.get(key);
    return value ? structuredClone(value) : undefined;
  }

  async set(key: string, chunks: AdapterChunk[]): Promise<void> {
    this.entries.set(key, structuredClone(chunks));
  }
}

export function createGemmaAdapter({ backend, cache = new MemoryResponseCache() }: AdapterOptions) {
  return {
    mode: backend.mode,
    backendName: backend.name,
    async *generate<T = unknown>(request: GenerateRequest<T>): AsyncIterable<AdapterChunk<T>> {
      const normalized: GenerateRequest<T> = {
        ...request,
        sampling: { ...defaultSampling, ...request.sampling },
        messages: request.messages.map((message) => ({
          ...message,
          // Keep visual evidence first for servers that process multimodal parts positionally.
          parts: [
            ...message.parts.filter((part) => part.type === "image"),
            ...message.parts.filter((part) => part.type === "audio"),
            ...message.parts.filter((part) => part.type === "text"),
          ],
        })),
      };
      const key = responseCacheKey(normalized);
      let chunks = await cache.get(key);
      if (!chunks) {
        chunks = [];
        for await (const chunk of backend.generate(normalized)) {
          chunks.push(chunk);
          yield chunk as AdapterChunk<T>;
        }
        if (normalized.schema) {
          const responseText = chunks.map((chunk) => chunk.text ?? "").join("").trim();
          const jsonText = responseText.startsWith("```")
            ? responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
            : responseText;
          let value: T;
          try {
            value = normalized.schema.parse(JSON.parse(jsonText)) as T;
          } catch (error) {
            throw new StructuredResponseError(error, responseText);
          }
          chunks.push({ value });
          yield { value };
        }
        await cache.set(key, chunks);
      } else {
        for (const chunk of chunks) yield chunk as AdapterChunk<T>;
      }
    },
  };
}

export class StructuredResponseError extends Error {
  readonly validatorError: unknown;
  readonly responseText: string;

  constructor(validatorError: unknown, responseText: string) {
    const details = validatorError instanceof Error ? validatorError.message : String(validatorError);
    super(`Model response failed JSON/Zod validation: ${details}`);
    this.name = "StructuredResponseError";
    this.validatorError = validatorError;
    this.responseText = responseText;
  }
}

export async function generateWithRepair<T>(
  adapter: ReturnType<typeof createGemmaAdapter>,
  request: GenerateRequest<T>,
  maxRepairRetries = 2,
  validate?: (value: T) => void,
): Promise<T> {
  if (!request.schema) throw new Error("generateWithRepair requires a Zod schema");
  let activeRequest = request;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRepairRetries; attempt += 1) {
    try {
      let result: T | undefined;
      let responseText = "";
      for await (const chunk of adapter.generate(activeRequest)) {
        if (chunk.text) responseText += chunk.text;
        if (chunk.value !== undefined) result = chunk.value as T;
      }
      if (result === undefined) throw new Error("Model returned no structured value");
      if (validate) {
        try { validate(result); }
        catch (error) { throw new StructuredResponseError(error, responseText); }
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!(error instanceof StructuredResponseError) || attempt === maxRepairRetries) break;
      activeRequest = {
        ...activeRequest,
        messages: [
          ...activeRequest.messages,
          { role: "assistant", parts: [{ type: "text", text: error.responseText }] },
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: `Repair this response. ${error.message}`,
              },
            ],
          },
        ],
      };
    }
  }
  throw lastError;
}

