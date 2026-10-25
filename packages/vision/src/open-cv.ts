import { normaliseBox, type PixelRect } from "./geometry.js";

export type Marker = { marker: number; box: [number, number, number, number]; shapeGuess: string; confidence: number };
export type VisionAnalysis = {
  width: number;
  height: number;
  markers: Marker[];
  lineSegments: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  cvAvailable: boolean;
  perspectiveCorrected?: boolean;
  deskewed?: boolean;
  fallbackReason?: string;
};
export type ImageCorrection = { imageData: ImageData; perspectiveCorrected: boolean; deskewed: boolean };

type CvRuntime = Record<string, any>;
let cvPromise: Promise<CvRuntime> | undefined;

async function loadCv(): Promise<CvRuntime> {
  cvPromise ??= (async () => {
    const namespace = await import("@techstark/opencv-js") as unknown as { default?: unknown };
    let cv = namespace.default ?? namespace;
    if (cv instanceof Promise) cv = await cv;
    const runtime = cv as CvRuntime;
    if (!runtime.Mat) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("OpenCV.js did not initialize within 15 seconds")), 15_000);
        runtime.onRuntimeInitialized = () => { clearTimeout(timeout); resolve(); };
      });
    }
    return runtime;
  })();
  return cvPromise;
}

/** Applies an outer-board perspective warp when a clear quadrilateral is present, then deskews. */
export async function correctPerspectiveAndDeskew(imageData: ImageData): Promise<ImageCorrection> {
  const cv = await loadCv();
  const resources: CvRuntime[] = [];
  const keep = <T extends CvRuntime>(resource: T) => { resources.push(resource); return resource; };
  let active = keep(cv.matFromImageData(imageData));
  let perspectiveCorrected = false;
  let deskewed = false;
  try {
    const gray = keep(new cv.Mat());
    const blurred = keep(new cv.Mat());
    const edges = keep(new cv.Mat());
    cv.cvtColor(active, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 42, 128);
    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const imageArea = active.cols * active.rows;
    let best: { area: number; points: Array<[number, number]> } | undefined;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const approximation = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approximation, perimeter * 0.02, true);
        const area = Math.abs(cv.contourArea(contour));
        if (approximation.rows !== 4 || area < imageArea * 0.22 || area > imageArea * 0.98 || !cv.isContourConvex(approximation)) continue;
        const values = Array.from(approximation.data32S as Int32Array);
        if (values.length < 8) continue;
        const points: Array<[number, number]> = [];
        for (let point = 0; point < 4; point += 1) points.push([values[point * 2]!, values[point * 2 + 1]!]);
        if (!best || area > best.area) best = { area, points };
      } finally {
        contour.delete();
        approximation.delete();
      }
    }

    if (best) {
      const ordered = orderCorners(best.points);
      const [topLeft, topRight, bottomRight, bottomLeft] = ordered;
      const outputWidth = Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight)));
      const outputHeight = Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight)));
      if (outputWidth > 80 && outputHeight > 80) {
        const sourcePoints = keep(cv.matFromArray(4, 1, cv.CV_32FC2, ordered.flat()));
        const destinationPoints = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0, outputWidth - 1, 0, outputWidth - 1, outputHeight - 1, 0, outputHeight - 1,
        ]));
        const transform = keep(cv.getPerspectiveTransform(sourcePoints, destinationPoints));
        const corrected = keep(new cv.Mat());
        cv.warpPerspective(active, corrected, transform, new cv.Size(outputWidth, outputHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
        active = corrected;
        perspectiveCorrected = true;
      }
    }

    const deskewGray = keep(new cv.Mat());
    const deskewEdges = keep(new cv.Mat());
    cv.cvtColor(active, deskewGray, cv.COLOR_RGBA2GRAY);
    cv.Canny(deskewGray, deskewEdges, 42, 128);
    const detectedLines = keep(new cv.Mat());
    cv.HoughLines(deskewEdges, detectedLines, 1, Math.PI / 180, Math.max(40, Math.floor(Math.min(active.cols, active.rows) * 0.38)));
    const horizontalSlopes: number[] = [];
    for (let index = 0; index < detectedLines.rows; index += 1) {
      const theta = detectedLines.data32F[index * 2 + 1]!;
      const deviation = theta - Math.PI / 2;
      if (Math.abs(deviation) < 0.28) horizontalSlopes.push(deviation);
    }
    if (horizontalSlopes.length >= 2) {
      horizontalSlopes.sort((a, b) => a - b);
      const skewDegrees = horizontalSlopes[Math.floor(horizontalSlopes.length / 2)]! * 180 / Math.PI;
      if (Math.abs(skewDegrees) > 0.4 && Math.abs(skewDegrees) < 18) {
        const matrix = keep(cv.getRotationMatrix2D(new cv.Point(active.cols / 2, active.rows / 2), -skewDegrees, 1));
        const rotated = keep(new cv.Mat());
        cv.warpAffine(active, rotated, matrix, new cv.Size(active.cols, active.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
        active = rotated;
        deskewed = true;
      }
    }
    const correctedPixels = new ImageData(new Uint8ClampedArray(active.data), active.cols, active.rows);
    return { imageData: correctedPixels, perspectiveCorrected, deskewed };
  } catch {
    return { imageData, perspectiveCorrected: false, deskewed: false };
  } finally {
    for (const resource of resources.reverse()) resource.delete();
  }
}

/** Runs grayscale cleanup, CLAHE, contour segmentation, and probabilistic line detection. */
export async function analyzeWithOpenCv(imageData: ImageData): Promise<VisionAnalysis> {
  const { width, height } = imageData;
  const cv = await loadCv();
  let source: CvRuntime | undefined;
  let gray: CvRuntime | undefined;
  let enhanced: CvRuntime | undefined;
  let edges: CvRuntime | undefined;
  let contours: CvRuntime | undefined;
  let hierarchy: CvRuntime | undefined;
  let lines: CvRuntime | undefined;
  let clahe: CvRuntime | undefined;
  try {
    source = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    enhanced = new cv.Mat();
    edges = new cv.Mat();
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
    clahe!.apply(gray, enhanced);
    cv.Canny(enhanced, edges, 48, 140);
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const minimumArea = Math.max(1_800, width * height * 0.002);
    const maximumArea = width * height * 0.92;
    const candidates: Array<{ rect: PixelRect; shapeGuess: string; confidence: number; area: number }> = [];
    for (let index = 0; index < contours!.size(); index += 1) {
      const contour = contours!.get(index);
      try {
        const rect = cv.boundingRect(contour) as PixelRect;
        const area = rect.width * rect.height;
        if (area < minimumArea || area > maximumArea || rect.width < 50 || rect.height < 38) continue;
        const aspect = rect.width / rect.height;
        const shapeGuess = aspect > 2.8 ? "wide_note" : aspect < 0.36 ? "line" : "rectangle";
        const confidence = Math.max(0.28, Math.min(0.92, contour.rows >= 4 ? 0.78 : 0.52));
        candidates.push({ rect, shapeGuess, confidence, area });
      } finally {
        contour.delete();
      }
    }

    // Keep one representative contour per overlapping region and number by reading order.
    const unique = candidates
      .sort((a, b) => b.area - a.area)
      .filter((candidate, index, all) => !all.slice(0, index).some((prior) => overlapRatio(candidate.rect, prior.rect) > 0.82))
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .slice(0, 80);
    const markerRows = unique.map((candidate, index) => ({
      marker: index + 1,
      box: normaliseBox(candidate.rect, width, height),
      shapeGuess: candidate.shapeGuess,
      confidence: candidate.confidence,
    }));

    lines = new cv.Mat();
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 48, 36, 14);
    const lineSegments: VisionAnalysis["lineSegments"] = [];
    for (let index = 0; index < lines!.rows; index += 1) {
      const x1 = lines!.data32S[index * 4]!;
      const y1 = lines!.data32S[index * 4 + 1]!;
      const x2 = lines!.data32S[index * 4 + 2]!;
      const y2 = lines!.data32S[index * 4 + 3]!;
      if (Math.hypot(x2 - x1, y2 - y1) > 42) lineSegments.push({ x1, y1, x2, y2 });
    }
    return {
      width,
      height,
      markers: markerRows,
      lineSegments: lineSegments.slice(0, 240),
      cvAvailable: true,
      ...(markerRows.length === 0 ? { fallbackReason: "No usable shape contours found; Pass A may estimate boxes at low confidence." } : {}),
    };
  } finally {
    for (const resource of [source, gray, enhanced, edges, contours, hierarchy, lines, clahe]) resource?.delete();
  }
}

export function noCvFallback(width: number, height: number, reason: string): VisionAnalysis {
  return { width, height, markers: [], lineSegments: [], cvAvailable: false, fallbackReason: reason };
}

function distance(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function orderCorners(points: Array<[number, number]>) {
  const bySum = [...points].sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  const topLeft = bySum[0]!;
  const bottomRight = bySum.at(-1)!;
  const other = points.filter((point) => point !== topLeft && point !== bottomRight).sort((a, b) => b[0] - b[1] - (a[0] - a[1]));
  return [topLeft, other[0]!, bottomRight, other[1]!] as const;
}

function overlapRatio(a: PixelRect, b: PixelRect) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}
