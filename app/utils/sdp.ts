import { decodeBase64, encodeBase64 } from "./base64";

/**
 * Compress an SDP for the signaling server: zlib, then base64 (url-safe,
 * no padding).
 *
 * "deflate" in the Compression Streams API is the zlib format, the same as
 * the native app's flate2 ZlibEncoder and ZlibDecoder, so the browser does
 * this without a compression library in the bundle.
 */
export async function encodeSdp(sdp: string): Promise<string> {
  const compressed = await transform(
    new TextEncoder().encode(sdp),
    new CompressionStream("deflate"),
  );
  return encodeBase64(compressed);
}

/** Reverse of encodeSdp. */
export async function decodeSdp(encoded: string): Promise<string> {
  let decompressed: Uint8Array;
  try {
    decompressed = await transform(
      decodeBase64(encoded),
      new DecompressionStream("deflate"),
    );
  } catch (error) {
    throw new Error("Decompression failed.", { cause: error });
  }

  return new TextDecoder().decode(decompressed);
}

async function transform(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Invalid input errors the readable side, which is what gets awaited.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
