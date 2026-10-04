import { expect, test } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64";
import { decodeSdp, encodeSdp } from "./sdp";

const sdp = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2113937151 3c0a4b5d-8b1e-4f2a.local 54321 typ host",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "",
].join("\r\n");

// The same SDP compressed by zlib at its best level, as the native app's
// flate2 ZlibEncoder does it, then base64-encoded.
const NATIVE_ENCODED =
  "eNp1j8GKwjAURfeF_sP7gWhekrb6oAu1CoKIoH7Aaxq1oG1o4jgzXz9UZpZzl4fLudyPUqZJXwowOWKh0UhptJQZap2Dgu0etgcDqIqJnMgJpkkoRZrEUoJMEy6vQ__0tDzvq916JI-Svb-3lmPbdzCHc3WYVqfdcXpcnQ7wcvUQrWg4sr1x17l7mtjyd0O-F95Wy13TNhwdISA8Gw8KUc91gRmCtpJNnTViVqMT5qJ4cu8t3yEzWiHELw-3PsTR01onnpeBr8S1bf6IfzXE_2TsXNru6gY_tF2kcGOhshykJERSirQmYyjLKM-pKGg2o_mcFgtaLmm1oqqi9Zo2m1ETXHx6Yhs9hzCCR9vQ-16w0QvfD5EyKd_kwZ_i4ULgqxOh_XakcoXGpMkPka91Ew";

const adler32 = (data: Uint8Array) => {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

test("Should round-trip an SDP", async () => {
  expect(await decodeSdp(await encodeSdp(sdp))).toBe(sdp);
});

test("Should read what the native app writes", async () => {
  expect(await decodeSdp(NATIVE_ENCODED)).toBe(sdp);
});

test("Should write the zlib format the native app reads", async () => {
  // zlib framing (RFC 1950): a deflate header, and the Adler-32 of the
  // uncompressed data at the end. A raw deflate stream would have neither.
  const bytes = decodeBase64(await encodeSdp(sdp));
  expect(bytes[0]! & 0x0f).toBe(8);
  expect((bytes[0]! * 256 + bytes[1]!) % 31).toBe(0);

  const trailer = new DataView(
    bytes.buffer,
    bytes.byteOffset + bytes.length - 4,
  );
  expect(trailer.getUint32(0)).toBe(adler32(new TextEncoder().encode(sdp)));
});

test("Should reject data that is not zlib", async () => {
  const garbage = encodeBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  await expect(decodeSdp(garbage)).rejects.toThrow("Decompression failed.");
});
