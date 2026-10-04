/**
 * A minimal ZIP writer for files that have already been received.
 *
 * Entries are stored without compression, so the archive is a Blob put
 * together from the files themselves plus a few headers: nothing is read,
 * compressed or copied. ZIP64 records are added only when an entry, an
 * offset or the entry count outgrows the classic format.
 */

export type ZipEntry = {
  /** Path inside the archive, "/" separated. */
  name: string;
  data: Blob;
  /** CRC-32 of data, see Crc32. */
  crc32: number;
  modified: Date;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as ZIP uses it, computed chunk by chunk while a file arrives. */
export class Crc32 {
  private crc = 0xffffffff;

  update(data: Uint8Array) {
    let crc = this.crc;
    for (let i = 0; i < data.length; i++) {
      crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
    }
    this.crc = crc;
  }

  digest(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const UTF8_NAMES = 0x0800;
const STORED = 0;

/** MS-DOS date and time, the only timestamp every ZIP reader understands. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Build a ZIP archive of the entries, in order.
 * @param forceZip64 write ZIP64 records even when not needed, for tests
 */
export function zipBlob(entries: ZipEntry[], forceZip64 = false): Blob {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.size;
    const zip64 = forceZip64 || size >= UINT32_MAX || offset >= UINT32_MAX;
    const version = zip64 ? 45 : 20;
    const { time, date } = dosDateTime(entry.modified);

    // Local header. In ZIP64, both sizes move to the extra field.
    const localExtra = zip64 ? 20 : 0;
    const local = new DataView(new ArrayBuffer(30 + name.length + localExtra));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, version, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, STORED, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, entry.crc32, true);
    local.setUint32(18, zip64 ? UINT32_MAX : size, true);
    local.setUint32(22, zip64 ? UINT32_MAX : size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, localExtra, true);
    new Uint8Array(local.buffer).set(name, 30);
    if (zip64) {
      const extra = 30 + name.length;
      local.setUint16(extra, 0x0001, true);
      local.setUint16(extra + 2, 16, true);
      local.setBigUint64(extra + 4, BigInt(size), true);
      local.setBigUint64(extra + 12, BigInt(size), true);
    }
    parts.push(local.buffer, entry.data);

    // Central directory record. In ZIP64, sizes and offset move to the extra field.
    const centralExtra = zip64 ? 28 : 0;
    const record = new DataView(
      new ArrayBuffer(46 + name.length + centralExtra),
    );
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, version, true);
    record.setUint16(6, version, true);
    record.setUint16(8, UTF8_NAMES, true);
    record.setUint16(10, STORED, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, entry.crc32, true);
    record.setUint32(20, zip64 ? UINT32_MAX : size, true);
    record.setUint32(24, zip64 ? UINT32_MAX : size, true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, centralExtra, true);
    record.setUint32(42, zip64 ? UINT32_MAX : offset, true);
    new Uint8Array(record.buffer).set(name, 46);
    if (zip64) {
      const extra = 46 + name.length;
      record.setUint16(extra, 0x0001, true);
      record.setUint16(extra + 2, 24, true);
      record.setBigUint64(extra + 4, BigInt(size), true);
      record.setBigUint64(extra + 12, BigInt(size), true);
      record.setBigUint64(extra + 20, BigInt(offset), true);
    }
    central.push(new Uint8Array(record.buffer));

    offset += local.byteLength + size;
  }

  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  parts.push(...central);

  const zip64End =
    forceZip64 ||
    entries.length >= UINT16_MAX ||
    offset >= UINT32_MAX ||
    centralSize >= UINT32_MAX;
  if (zip64End) {
    // ZIP64 end of central directory record, then its locator.
    const end64 = new DataView(new ArrayBuffer(56 + 20));
    end64.setUint32(0, 0x06064b50, true);
    end64.setBigUint64(4, 44n, true);
    end64.setUint16(12, 45, true);
    end64.setUint16(14, 45, true);
    end64.setBigUint64(24, BigInt(entries.length), true);
    end64.setBigUint64(32, BigInt(entries.length), true);
    end64.setBigUint64(40, BigInt(centralSize), true);
    end64.setBigUint64(48, BigInt(offset), true);
    end64.setUint32(56, 0x07064b50, true);
    end64.setBigUint64(64, BigInt(offset + centralSize), true);
    end64.setUint32(72, 1, true);
    parts.push(end64.buffer);
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64End ? UINT16_MAX : entries.length, true);
  end.setUint16(10, zip64End ? UINT16_MAX : entries.length, true);
  end.setUint32(12, zip64End ? UINT32_MAX : centralSize, true);
  end.setUint32(16, zip64End ? UINT32_MAX : offset, true);
  parts.push(end.buffer);

  return new Blob(parts, { type: "application/zip" });
}
