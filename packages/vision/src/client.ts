import { intakeImage, type ImageIntakeResult } from "./intake.js";
import { noCvFallback, type VisionAnalysis } from "./open-cv.js";

export type VisionResult = ImageIntakeResult & { analysis: VisionAnalysis };
type Pending = { resolve(value: VisionResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type WorkerReply = { id: string; analysis: VisionAnalysis; workingCopy?: Blob; error?: string };

export async function processImageInWorker(file: File, timeoutMs = 25_000): Promise<VisionResult> {
  const intake = await intakeImage(file);
  if (typeof Worker === "undefined") {
    return { ...intake, analysis: noCvFallback(intake.width, intake.height, "Web Workers are unavailable; use server processing.") };
  }
  const worker = new Worker(new URL("./vision.worker.ts", import.meta.url), { type: "module", name: "doodleforge-vision" });
  try {
    const bytes = await intake.cleanedOriginal.arrayBuffer();
    const result = await new Promise<WorkerReply>((resolve, reject) => {
      const id = crypto.randomUUID();
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      const onMessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.id !== id) return;
        cleanup();
        resolve(event.data);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "Vision worker failed"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Vision worker timed out"));
      }, timeoutMs);
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError, { once: true });
      worker.postMessage({ id, bytes, mimeType: intake.mimeType }, [bytes]);
    });
    return {
      ...intake,
      workingCopy: result.workingCopy ?? intake.workingCopy,
      mimeType: result.workingCopy ? "image/jpeg" : intake.mimeType,
      width: result.analysis.width || intake.width,
      height: result.analysis.height || intake.height,
      analysis: result.analysis,
    };
  } catch (error) {
    return {
      ...intake,
      analysis: noCvFallback(intake.width, intake.height, `Worker unavailable: ${error instanceof Error ? error.message : String(error)}; server fallback is available.`),
    };
  } finally {
    worker.terminate();
  }
}
