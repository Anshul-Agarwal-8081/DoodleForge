import { analyzeWithOpenCv, correctPerspectiveAndDeskew, noCvFallback, type VisionAnalysis } from "./open-cv.js";
import { MAX_WORKING_EDGE } from "./intake.js";

type VisionRequest = { id: string; bytes: ArrayBuffer; mimeType: string };
type VisionResponse = { id: string; analysis: VisionAnalysis; workingCopy?: Blob; error?: string };

self.addEventListener("message", (event: MessageEvent<VisionRequest>) => {
  void handle(event.data);
});

async function handle(request: VisionRequest) {
  let width = 0;
  let height = 0;
  let workingCopy: Blob | undefined;
  try {
    const bitmap = await createImageBitmap(new Blob([request.bytes], { type: request.mimeType }));
    const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(bitmap.width, bitmap.height));
    width = Math.max(1, Math.round(bitmap.width * scale));
    height = Math.max(1, Math.round(bitmap.height * scale));
    let canvas = new OffscreenCanvas(width, height);
    const initialContext = canvas.getContext("2d", { alpha: false });
    if (!initialContext) throw new Error("Could not create worker image context");
    initialContext.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = initialContext.getImageData(0, 0, width, height);
    let analysis: VisionAnalysis;
    let outputContext: OffscreenCanvasRenderingContext2D | null = initialContext;
    try {
      const correction = await correctPerspectiveAndDeskew(pixels);
      if (correction.imageData.width !== canvas.width || correction.imageData.height !== canvas.height) {
        canvas = new OffscreenCanvas(correction.imageData.width, correction.imageData.height);
        outputContext = canvas.getContext("2d", { alpha: false });
        if (!outputContext) throw new Error("Could not create corrected image context");
      }
      width = canvas.width;
      height = canvas.height;
      outputContext?.putImageData(correction.imageData, 0, 0);
      analysis = {
        ...await analyzeWithOpenCv(correction.imageData),
        perspectiveCorrected: correction.perspectiveCorrected,
        deskewed: correction.deskewed,
      };
    } catch (error) {
      analysis = noCvFallback(width, height, `OpenCV worker failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    drawNumberedMarkers(outputContext, analysis);
    workingCopy = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    self.postMessage({ id: request.id, analysis, workingCopy } satisfies VisionResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      id: request.id,
      analysis: noCvFallback(width, height, `Worker intake failed: ${message}`),
      error: message,
    } satisfies VisionResponse);
  }
}

function drawNumberedMarkers(context: OffscreenCanvasRenderingContext2D | null, analysis: VisionAnalysis) {
  if (!context || analysis.markers.length === 0) return;
  const width = analysis.width;
  const height = analysis.height;
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.022));
  const radius = Math.round(fontSize * 0.85);
  context.font = `700 ${fontSize}px ui-sans-serif, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const marker of analysis.markers) {
    const [ymin, xmin] = marker.box;
    const x = Math.max(radius + 2, Math.min(width - radius - 2, (xmin / 1000) * width));
    const y = Math.max(radius + 2, Math.min(height - radius - 2, (marker.box[0] / 1000) * height));
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = "#c34c3f";
    context.fill();
    context.lineWidth = Math.max(2, Math.round(fontSize * 0.12));
    context.strokeStyle = "#fffefa";
    context.stroke();
    context.fillStyle = "#fffefa";
    context.fillText(String(marker.marker), x, y + 0.5);
  }
}
