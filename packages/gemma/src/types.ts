import type * as z from "zod";

export type ModelSize = "small" | "main" | "large";
export type ModelMode = "local" | "hosted";
export type ImageBudget = 70 | 140 | 280 | 560 | 1120;

export type TextPart = { type: "text"; text: string };
export type ImagePart = {
  type: "image";
  mimeType: string;
  data?: string;
  url?: string;
  detail?: "low" | "high" | "auto";
};
export type AudioPart = {
  type: "audio";
  data: string;
  format: "wav" | "mp3" | "m4a" | "webm";
};
export type MessagePart = ImagePart | AudioPart | TextPart;

export type ToolDeclaration = {
  name: string;
  description?: string;
  parameters: z.ZodType | Record<string, unknown>;
};

export type Sampling = { temperature: number; top_p: number; top_k: number };

export type GenerateRequest<T = unknown> = {
  model: ModelSize;
  pass: string;
  promptVersion: string;
  system: string;
  messages: Array<{ role: string; parts: MessagePart[] }>;
  schema?: z.ZodType<T>;
  tools?: ToolDeclaration[];
  imageBudget?: ImageBudget;
  thinking?: boolean;
  sampling?: Partial<Sampling>;
};

export type AdapterChunk<T = unknown> = {
  text?: string;
  value?: T;
  toolCalls?: Array<{ name: string; arguments: unknown }>;
  done?: boolean;
};

export type FixtureRecord = {
  inputHash: string;
  chunks: AdapterChunk[];
  metadata?: Record<string, unknown>;
};

export interface GemmaBackend {
  readonly mode: ModelMode;
  readonly name: string;
  generate(request: GenerateRequest): AsyncIterable<AdapterChunk>;
}

export interface ResponseCache {
  get(key: string): Promise<AdapterChunk[] | undefined>;
  set(key: string, chunks: AdapterChunk[]): Promise<void>;
}

export type AdapterOptions = {
  backend: GemmaBackend;
  cache?: ResponseCache;
};

