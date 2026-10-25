const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Strips JPEG EXIF/XMP APP1 segments without changing the encoded image data. */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new TypeError("Expected a JPEG image");
  }
  const chunks: Uint8Array[] = [input.subarray(0, 2)];
  let offset = 2;
  while (offset < input.length) {
    const segmentStart = offset;
    if (input[offset] !== 0xff) {
      chunks.push(input.subarray(offset));
      break;
    }
    while (input[offset] === 0xff) offset += 1;
    const marker = input[offset];
    if (marker === undefined) break;
    offset += 1;
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(input.subarray(segmentStart));
      break;
    }
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) {
      chunks.push(input.subarray(segmentStart, offset));
      continue;
    }
    if (offset + 2 > input.length) throw new TypeError("Truncated JPEG segment");
    const length = (input[offset]! << 8) | input[offset + 1]!;
    if (length < 2 || offset + length > input.length) throw new TypeError("Invalid JPEG segment length");
    const segment = input.subarray(segmentStart, offset + length);
    if (marker !== 0xe1) chunks.push(segment);
    offset += length;
  }
  return concat(chunks);
}

/** Removes optional PNG eXIf chunks and keeps every other chunk byte-for-byte. */
export function stripPngMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 8 || PNG_SIGNATURE.some((value, index) => input[index] !== value)) {
    throw new TypeError("Expected a PNG image");
  }
  const chunks: Uint8Array[] = [input.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = readUint32(input, offset);
    const end = offset + 12 + length;
    if (end > input.length) throw new TypeError("Truncated PNG chunk");
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    if (type !== "eXIf") chunks.push(input.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  if (offset !== input.length) chunks.push(input.subarray(offset));
  return concat(chunks);
}

export function stripImageMetadata(input: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return stripJpegMetadata(input);
  if (mimeType === "image/png") return stripPngMetadata(input);
  return input.slice();
}

function readUint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function concat(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
