import { analyzeWithOpenCv, correctPerspectiveAndDeskew, noCvFallback, type VisionAnalysis } from "./open-cv.js";

/** Server-side fallback used when browser workers or OpenCV initialization fail. */
export async function processImageOnServer(bytes: Uint8Array, mimeType: string): Promise<VisionAnalysis> {
  try {
    const namespace = await import("@techstark/opencv-js") as unknown as { default?: unknown };
    let cv = namespace.default ?? namespace;
    if (cv instanceof Promise) cv = await cv;
    const runtime = cv as Record<string, any>;
    if (!runtime.Mat) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("OpenCV.js server runtime timed out")), 15_000);
        runtime.onRuntimeInitialized = () => { clearTimeout(timer); resolve(); };
      });
    }
    const encoded = runtime.matFromArray(1, bytes.length, runtime.CV_8UC1, Array.from(bytes));
    let decoded: Record<string, any> | undefined;
    try {
      const initial = runtime.imdecode(encoded, runtime.IMREAD_UNCHANGED) as Record<string, any>;
      if (!initial || initial.empty()) throw new Error(`OpenCV could not decode ${mimeType}`);
      let active = initial;
      const scale = Math.min(1, 2048 / Math.max(active.cols, active.rows));
      if (scale < 1) {
        const resized = new runtime.Mat();
        runtime.resize(active, resized, new runtime.Size(Math.round(active.cols * scale), Math.round(active.rows * scale)));
        active.delete();
        active = resized;
      }
      decoded = active;
      const rgba = new runtime.Mat() as Record<string, any>;
      const conversion = active.channels() === 4 ? runtime.COLOR_BGRA2RGBA : runtime.COLOR_BGR2RGBA;
      try {
        runtime.cvtColor(active, rgba, conversion);
        const pixels = { width: rgba.cols, height: rgba.rows, data: new Uint8ClampedArray(rgba.data) } as ImageData;
        const correction = await correctPerspectiveAndDeskew(pixels);
        const result = await analyzeWithOpenCv(correction.imageData);
        return { ...result, perspectiveCorrected: correction.perspectiveCorrected, deskewed: correction.deskewed };
      } finally {
        rgba.delete();
      }
    } finally {
      encoded.delete();
      decoded?.delete();
    }
  } catch (error) {
    return noCvFallback(0, 0, `Server OpenCV fallback unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
