import { processImageInWorker } from "@doodleforge/vision";

export type DiagramDomain = "userstory" | "software" | "erd" | "cloud" | "circuit" | "workflow";

export type SketchJobRequest =
  | { kind: "fixture"; fixtureId: string }
  | { kind: "text"; text: string; domainHint?: DiagramDomain; mode: "fixture" | "live" }
  | {
    kind: "image";
    name: string;
    mimeType: "image/jpeg" | "image/png";
    data: string;
    width: number;
    height: number;
    markers: Array<{ marker: number; box: [number, number, number, number]; shapeGuess: string; confidence: number }>;
    domainHint?: DiagramDomain;
    mode: "live";
  };

export type VoiceJobRequest = { kind: "voice"; data: string; mimeType: "audio/wav"; durationMs: number; domainHint?: DiagramDomain };

export type SketchEvent = { event: string; data: Record<string, unknown> };
export type ModelConnectionStatus = { provider: "Google Gemini API"; mode: "hosted"; model: string; apiKeyConfigured: boolean };

export async function getModelConnectionStatus(): Promise<ModelConnectionStatus> {
  const response = await fetch("/api/model/status");
  if (!response.ok) throw new Error(`Model settings could not load (HTTP ${response.status}). Restart the API server.`);
  return await response.json() as ModelConnectionStatus;
}

export async function testModelConnection(): Promise<{ ok: boolean; message: string; mode?: string; model?: string; retryAfterSeconds?: number }> {
  const response = await fetch("/api/model/test", { method: "POST" });
  const result = await response.json() as { ok: boolean; message: string; mode?: string; model?: string; retryAfterSeconds?: number };
  if (!response.ok && result.ok !== false) throw new Error(`Connection check failed (HTTP ${response.status})`);
  return result;
}

export async function saveModelCredential(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const response = await fetch("/api/model/credential", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const result = await response.json() as { ok: boolean; message: string };
  if (!response.ok) throw new Error(result.message || `Credential save failed (HTTP ${response.status})`);
  return result;
}

export async function prepareImageJob(file: File, domainHint?: DiagramDomain) {
  const result = await processImageInWorker(file);
  const data = await blobToBase64(result.workingCopy);
  return {
    preview: result.workingCopy,
    analysis: result.analysis,
    job: {
      kind: "image" as const,
      name: file.name || "pasted-image.jpg",
      mimeType: result.mimeType as "image/jpeg" | "image/png",
      data,
      width: result.width,
      height: result.height,
      markers: result.analysis.markers,
      ...(domainHint ? { domainHint } : {}),
      mode: "live" as const,
    },
  };
}

export async function postSketchJob(
  body: SketchJobRequest,
  onEvent: (message: SketchEvent) => void,
  signal?: AbortSignal,
) {
  await streamJob("/api/jobs", body, onEvent, signal);
}

export async function postVoiceJob(
  body: VoiceJobRequest,
  onEvent: (message: SketchEvent) => void,
  signal?: AbortSignal,
) {
  await streamJob("/api/voice/jobs", body, onEvent, signal);
}

async function streamJob(endpoint: string, body: unknown, onEvent: (message: SketchEvent) => void, signal?: AbortSignal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error ?? `Sketch service returned ${response.status}`);
  }
  if (!response.body) throw new Error("Sketch service did not return an event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    let separator = pending.search(/\r?\n\r?\n/);
    while (separator >= 0) {
      const block = pending.slice(0, separator);
      const separatorLength = pending.slice(separator).startsWith("\r\n\r\n") ? 4 : 2;
      pending = pending.slice(separator + separatorLength);
      const message = parseSseBlock(block);
      if (message) onEvent(message);
      separator = pending.search(/\r?\n\r?\n/);
    }
    if (done) break;
  }
  const last = parseSseBlock(pending);
  if (last) onEvent(last);
}

/** Browser microphone formats vary; normalize to compact 16 kHz mono PCM WAV for Gemini. */
export async function prepareVoiceJob(blob: Blob, durationMs: number, domainHint?: DiagramDomain): Promise<VoiceJobRequest> {
  if (durationMs <= 0 || durationMs > 30_000) throw new Error("Voice clips must be 30 seconds or shorter");
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = 16_000;
    const sampleCount = Math.ceil(decoded.duration * sampleRate);
    if (!sampleCount || sampleCount > sampleRate * 30) throw new Error("Voice clip is empty or exceeds 30 seconds");
    const pcm = new Int16Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const sourceIndex = index * decoded.sampleRate / sampleRate;
      const leftIndex = Math.floor(sourceIndex);
      const fraction = sourceIndex - leftIndex;
      let mixed = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const samples = decoded.getChannelData(channel);
        const left = samples[Math.min(leftIndex, samples.length - 1)] ?? 0;
        const right = samples[Math.min(leftIndex + 1, samples.length - 1)] ?? left;
        mixed += left + (right - left) * fraction;
      }
      mixed /= decoded.numberOfChannels;
      pcm[index] = Math.max(-1, Math.min(1, mixed)) < 0
        ? Math.round(Math.max(-1, mixed) * 0x8000)
        : Math.round(Math.min(1, mixed) * 0x7fff);
    }
    const wav = new ArrayBuffer(44 + pcm.byteLength);
    const view = new DataView(wav);
    const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
    write(0, "RIFF"); view.setUint32(4, 36 + pcm.byteLength, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, pcm.byteLength, true);
    for (let index = 0; index < pcm.length; index += 1) view.setInt16(44 + index * 2, pcm[index]!, true);
    return { kind: "voice", data: await blobToBase64(new Blob([wav], { type: "audio/wav" })), mimeType: "audio/wav", durationMs: Math.round(durationMs), ...(domainHint ? { domainHint } : {}) };
  } finally {
    await audioContext.close();
  }
}

function parseSseBlock(block: string): SketchEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return undefined;
  try {
    const parsed = JSON.parse(data.join("\n")) as Record<string, unknown>;
    return { event, data: parsed };
  } catch {
    throw new Error("Sketch service sent an invalid event payload");
  }
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}
