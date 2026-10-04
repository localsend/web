import { expect, test } from "vitest";
import { Crc32, zipBlob, type ZipEntry } from "./zip";

const crcOf = (data: Uint8Array) => {
  const crc = new Crc32();
  crc.update(data);
  return crc.digest();
};

const entry = (name: string, text: string, modified: Date): ZipEntry => {
  const data = new TextEncoder().encode(text);
  return { name, data: new Blob([data]), crc32: crcOf(data), modified };
};

/** Reads back what a ZIP reader needs: the central directory and the data. */
async function readZip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();

  let end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  let count = view.getUint16(end + 10, true);
  let centralOffset = view.getUint32(end + 16, true);
  if (centralOffset === 0xffffffff) {
    const locator = end - 20;
    expect(view.getUint32(locator, true)).toBe(0x07064b50);
    const end64 = Number(view.getBigUint64(locator + 8, true));
    expect(view.getUint32(end64, true)).toBe(0x06064b50);
    count = Number(view.getBigUint64(end64 + 32, true));
    centralOffset = Number(view.getBigUint64(end64 + 48, true));
  }

  const files = [];
  let at = centralOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc32 = view.getUint32(at + 16, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    let offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (size === 0xffffffff) {
      const extra = at + 46 + nameLength;
      expect(view.getUint16(extra, true)).toBe(0x0001);
      size = Number(view.getBigUint64(extra + 4, true));
      offset = Number(view.getBigUint64(extra + 20, true));
    }

    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    const data = bytes.slice(start, start + size);
    files.push({ name, flags, method, time, date, crc32, data });
    at += 46 + nameLength + extraLength;
  }
  return files;
}

test("Should compute the standard CRC-32 check value", () => {
  expect(crcOf(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);

  // Chunk by chunk gives the same result as all at once.
  const crc = new Crc32();
  crc.update(new TextEncoder().encode("1234"));
  crc.update(new TextEncoder().encode("56789"));
  expect(crc.digest()).toBe(0xcbf43926);
});

for (const forceZip64 of [false, true]) {
  test(`Should round-trip stored entries${forceZip64 ? " with ZIP64" : ""}`, async () => {
    const modified = new Date(2026, 9, 4, 15, 30, 12);
    const entries = [
      entry("a.txt", "hello", modified),
      entry("folder/b é.txt", "wörld", modified),
      entry("empty.bin", "", modified),
    ];

    const files = await readZip(zipBlob(entries, forceZip64));

    expect(files.map((file) => file.name)).toEqual([
      "a.txt",
      "folder/b é.txt",
      "empty.bin",
    ]);
    for (const [i, file] of files.entries()) {
      const original = new Uint8Array(await entries[i]!.data.arrayBuffer());
      expect(file.data).toEqual(original);
      expect(file.crc32).toBe(crcOf(original));
      expect(file.method).toBe(0); // stored
      expect(file.flags & 0x0800).toBe(0x0800); // UTF-8 names
      expect(file.time).toBe((15 << 11) | (30 << 5) | (12 >> 1));
      expect(file.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 4);
    }
  });
}

test("Should write an empty archive", async () => {
  expect(await readZip(zipBlob([]))).toEqual([]);
});
