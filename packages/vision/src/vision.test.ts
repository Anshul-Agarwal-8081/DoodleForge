import { describe, expect, it } from "vitest";
import { normaliseBox, boxToPixels } from "./geometry.js";
import { stripJpegMetadata, stripPngMetadata } from "./exif.js";
import { noCvFallback } from "./open-cv.js";

describe("vision intake contracts", () => {
  it("normalises and reverses pixel boxes in [ymin, xmin, ymax, xmax] order", () => {
    expect(normaliseBox({ x: 100, y: 50, width: 300, height: 250 }, 1000, 500)).toEqual([100, 100, 600, 400]);
    expect(boxToPixels([100, 100, 600, 400], 1000, 500)).toEqual({ x: 100, y: 50, width: 300, height: 250 });
  });

  it("clamps boxes to the image bounds", () => {
    expect(normaliseBox({ x: -20, y: -10, width: 200, height: 110 }, 100, 100)).toEqual([0, 0, 1000, 1000]);
  });

  it("strips JPEG APP1 metadata and keeps image markers", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd9]);
    expect([...stripJpegMetadata(jpeg)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("strips PNG eXIf chunks while preserving image chunks", () => {
    const chunk = (type: string, data: number[]) => Uint8Array.from([
      0, 0, 0, data.length,
      ...Array.from(type).map((char) => char.charCodeAt(0)),
      ...data,
      0, 0, 0, 0,
    ]);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    const png = Uint8Array.from([...signature, ...chunk("eXIf", [1, 2]), ...chunk("IDAT", [3]), ...chunk("IEND", [])]);
    const cleaned = stripPngMetadata(png);
    expect(new TextDecoder().decode(cleaned)).not.toContain("eXIf");
    expect(new TextDecoder().decode(cleaned)).toContain("IDAT");
    expect(new TextDecoder().decode(cleaned)).toContain("IEND");
  });

  it("returns a marked fallback when no usable CV worker is available", () => {
    expect(noCvFallback(1200, 800, "worker unavailable")).toMatchObject({
      width: 1200,
      height: 800,
      markers: [],
      cvAvailable: false,
      fallbackReason: "worker unavailable",
    });
  });
});
