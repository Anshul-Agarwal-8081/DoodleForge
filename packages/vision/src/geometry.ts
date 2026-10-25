import type { Box } from "@doodleforge/ir";

export type PixelRect = { x: number; y: number; width: number; height: number };

/** The single conversion point between pixel-space rectangles and the IR box contract. */
export function normaliseBox(rect: PixelRect, imageWidth: number, imageHeight: number): Box {
  if (!(imageWidth > 0 && imageHeight > 0)) throw new RangeError("Image dimensions must be positive");
  const xmin = clamp(Math.round((rect.x / imageWidth) * 1000));
  const ymin = clamp(Math.round((rect.y / imageHeight) * 1000));
  const xmax = clamp(Math.round(((rect.x + rect.width) / imageWidth) * 1000));
  const ymax = clamp(Math.round(((rect.y + rect.height) / imageHeight) * 1000));
  return [Math.min(ymin, ymax), Math.min(xmin, xmax), Math.max(ymin, ymax), Math.max(xmin, xmax)];
}

export function boxToPixels(box: Box, imageWidth: number, imageHeight: number): PixelRect {
  const [ymin, xmin, ymax, xmax] = box;
  const x = Math.round((xmin / 1000) * imageWidth);
  const y = Math.round((ymin / 1000) * imageHeight);
  return {
    x,
    y,
    width: Math.round(((xmax - xmin) / 1000) * imageWidth),
    height: Math.round(((ymax - ymin) / 1000) * imageHeight),
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1000, value));
}
