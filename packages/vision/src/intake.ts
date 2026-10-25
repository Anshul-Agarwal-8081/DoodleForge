import { stripImageMetadata } from "./exif.js";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_WORKING_EDGE = 2048;
const acceptedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif"]);

export type ImageIntakeResult = {
  original: Blob;
  cleanedOriginal: Blob;
  workingCopy: Blob;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

export async function intakeImage(file: File): Promise<ImageIntakeResult> {
  if (!acceptedTypes.has(file.type.toLowerCase())) throw new TypeError("Choose a JPEG, PNG, HEIC, or HEIF image");
  if (file.size > MAX_IMAGE_BYTES) throw new RangeError("Image exceeds the 15 MB upload limit");

  let source: Blob = file;
  let type: "image/jpeg" | "image/png" = file.type === "image/png" ? "image/png" : "image/jpeg";
  if (file.type === "image/heic" || file.type === "image/heif") {
    const converter = await import("heic2any") as unknown as { default(input: { blob: Blob; toType: string; quality: number }): Promise<Blob | Blob[]> };
    const converted = await converter.default({ blob: file, toType: "image/jpeg", quality: 0.92 });
    source = Array.isArray(converted) ? converted[0]! : converted;
    type = "image/jpeg";
  }

  const cleanBytes = stripImageMetadata(new Uint8Array(await source.arrayBuffer()), type);
  const cleanBuffer = cleanBytes.buffer.slice(cleanBytes.byteOffset, cleanBytes.byteOffset + cleanBytes.byteLength) as ArrayBuffer;
  const cleanedOriginal = new Blob([cleanBuffer], { type });
  const bitmap = await createImageBitmap(cleanedOriginal, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create image processing context");
    context.drawImage(bitmap, 0, 0, width, height);
    const workingCopy = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode working image")), type, 0.9);
    });
    return { original: file, cleanedOriginal, workingCopy, mimeType: type, width, height };
  } finally {
    bitmap.close();
  }
}
