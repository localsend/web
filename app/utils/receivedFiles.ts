import { saveFileFromBytes } from "./fileSaver";
import { Crc32, zipBlob, type ZipEntry } from "./zip";

export type IncomingFile = {
  id: string;
  fileName: string;
  size: number;
  /** ISO 8601 modification time from the sender, if it sent one. */
  modified?: string;
};

/** Receives the bytes of one file. */
export type FileWriter = {
  write(chunk: ArrayBuffer): Promise<void>;
  /** Finish the file. Resolves to an error message if it was not kept. */
  finish(): Promise<string | undefined>;
};

/**
 * Keeps the files of one receive session and hands them to the user.
 *
 * Files used to be collected in memory and downloaded from there, which
 * needs about twice the file in RAM: receiving 1 GiB peaked at 2.25 GB, and
 * larger files crash the tab. Where the browser allows it, files are now
 * written to the origin private file system as they arrive and downloaded
 * from disk.
 *
 * Several files are handed over as one ZIP. Browsers start only about ten
 * downloads on their own and hold the rest behind a permission prompt,
 * while the sender has already been told that every file arrived. All files
 * of such a session go into one stored file, so each one costs no file
 * handles of its own, and the ZIP is assembled from slices of it without
 * copying.
 */
export class ReceivedFiles {
  private readonly kept: KeptFile[] = [];
  private readonly names = new Set<string>();
  private fileCount = 0;
  private delivered = false;
  private zipSink: Promise<OpfsSink> | null = null;
  private current: OpfsSink | null = null;

  private constructor(
    private readonly storage: SessionDirectory | null,
    private asZip: boolean,
    private readonly save: (blob: Blob, name: string) => void,
  ) {}

  static async open(
    files: IncomingFile[],
    save: (blob: Blob, name: string) => void = saveFileFromBytes,
  ): Promise<ReceivedFiles> {
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const storage = await openSessionDirectory(totalSize);
    // Without disk storage a ZIP would hold every file in memory at once, so
    // files then stay separate downloads, as before.
    return new ReceivedFiles(
      storage,
      storage !== null && files.length > 1,
      save,
    );
  }

  async begin(file: IncomingFile): Promise<FileWriter> {
    if (this.asZip && this.storage) {
      try {
        this.zipSink ??= OpfsSink.create(this.storage.handle, "files");
        return this.zipEntryWriter(file, await this.zipSink);
      } catch (error) {
        // Before the first file, so the session falls back as a whole.
        console.warn("Handing over received files separately:", error);
        this.asZip = false;
        this.zipSink = null;
      }
    }

    let sink: FileSink = new MemorySink();
    if (this.storage) {
      try {
        sink = this.current = await OpfsSink.create(
          this.storage.handle,
          `${this.fileCount}`,
        );
      } catch (error) {
        console.warn("Keeping a received file in memory:", error);
      }
    }
    this.fileCount++;

    let received = 0;
    let failure: string | undefined;

    return {
      write: async (chunk) => {
        received += chunk.byteLength;
        if (failure) {
          return;
        }
        if (received > file.size) {
          failure = `Received more than the expected ${file.size} bytes`;
          return;
        }
        try {
          await sink.write(chunk);
        } catch (error) {
          console.error("Could not store a received file:", error);
          failure = "Could not store the file";
        }
      },
      finish: async () => {
        if (!failure && received !== file.size) {
          failure = `Received ${received} of ${file.size} bytes`;
        }
        let blob: Blob | undefined;
        try {
          blob = await sink.close();
        } catch (error) {
          console.error("Could not store a received file:", error);
          failure ??= "Could not store the file";
        }
        if (failure || !blob) {
          return failure;
        }

        this.handOver(blob, file.fileName);
        return undefined;
      },
    };
  }

  /** Appends a file to the session's shared file, for the ZIP. */
  private zipEntryWriter(file: IncomingFile, sink: OpfsSink): FileWriter {
    const crc = new Crc32();
    const start = sink.size;
    let received = 0;
    let failure: string | undefined;

    return {
      write: async (chunk) => {
        received += chunk.byteLength;
        if (failure) {
          return;
        }
        if (received > file.size) {
          failure = `Received more than the expected ${file.size} bytes`;
          return;
        }
        try {
          crc.update(new Uint8Array(chunk));
          await sink.write(chunk);
        } catch (error) {
          console.error("Could not store a received file:", error);
          failure = "Could not store the file";
        }
      },
      finish: async () => {
        if (!failure && received !== file.size) {
          failure = `Received ${received} of ${file.size} bytes`;
        }
        if (failure) {
          // Its bytes stay in the shared file, but no entry points at them.
          return failure;
        }

        this.kept.push({
          fileName: file.fileName,
          name: this.uniqueName(entryName(file.fileName)),
          start,
          end: start + received,
          crc32: crc.digest(),
          modified: parseDate(file.modified),
        });
        return undefined;
      },
    };
  }

  /** Hand over the files kept for one download, after the last file. */
  async deliver() {
    if (!this.zipSink || this.kept.length === 0) {
      return;
    }

    let stored: Blob;
    try {
      stored = await (await this.zipSink).close();
    } catch (error) {
      console.error("Could not store the received files:", error);
      return;
    }

    const [first] = this.kept;
    if (this.kept.length === 1 && first) {
      this.handOver(stored.slice(first.start, first.end), first.fileName);
      return;
    }

    const entries: ZipEntry[] = this.kept.map((file) => ({
      name: file.name,
      data: stored.slice(file.start, file.end),
      crc32: file.crc32,
      modified: file.modified,
    }));
    this.handOver(zipBlob(entries), zipName());
  }

  /** Remove the stored files once their downloads no longer need them. */
  release() {
    const storage = this.storage;
    if (!storage) {
      return;
    }
    const delivered = this.delivered;
    const current = this.current;
    const zipSink = delivered ? null : this.zipSink;
    void (async () => {
      // A file still open for writing cannot be removed; let go of it first.
      await current?.abort();
      await (await zipSink?.catch(() => null))?.abort();
      removeSessionDirectory(storage, delivered);
    })();
  }

  private handOver(blob: Blob, name: string) {
    this.delivered = true;
    this.save(blob, name);
  }

  private uniqueName(name: string): string {
    let candidate = name;
    const slash = name.lastIndexOf("/");
    const dot = name.lastIndexOf(".");
    const [stem, extension] =
      dot > slash + 1 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 2; this.names.has(candidate); n++) {
      candidate = `${stem} (${n})${extension}`;
    }
    this.names.add(candidate);
    return candidate;
  }
}

/** A file kept for the ZIP, as a range of the session's shared file. */
type KeptFile = {
  fileName: string;
  /** Path inside the archive. */
  name: string;
  start: number;
  end: number;
  crc32: number;
  modified: Date;
};

/** A path inside the archive: no empty, "." or ".." segments, "/" separated. */
export function entryName(fileName: string): string {
  const segments = fileName
    .split(/[\\/]+/)
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/") || "file";
}

function parseDate(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function zipName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `LocalSend-${date}-${time}.zip`;
}

/** Where the bytes of a received file go while it arrives. */
interface FileSink {
  write(chunk: ArrayBuffer): Promise<void>;
  close(): Promise<Blob>;
}

class MemorySink implements FileSink {
  private readonly parts: ArrayBuffer[] = [];

  async write(chunk: ArrayBuffer) {
    this.parts.push(chunk);
  }

  async close() {
    return new Blob(this.parts);
  }
}

/** Writes are batched, one per MiB instead of one per message. */
const WRITE_SIZE = 1024 * 1024;

class OpfsSink implements FileSink {
  private batch = new Uint8Array(WRITE_SIZE);
  private filled = 0;
  private flushed = 0;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly handle: FileSystemFileHandle,
    private readonly writable: FileSystemWritableFileStream,
  ) {}

  static async create(directory: FileSystemDirectoryHandle, name: string) {
    const handle = await directory.getFileHandle(name, { create: true });
    return new OpfsSink(handle, await handle.createWritable());
  }

  async write(chunk: ArrayBuffer) {
    let data = new Uint8Array(chunk);
    while (data.length > 0) {
      const n = Math.min(data.length, WRITE_SIZE - this.filled);
      this.batch.set(data.subarray(0, n), this.filled);
      this.filled += n;
      data = data.subarray(n);
      if (this.filled === WRITE_SIZE) {
        await this.flush();
      }
    }
  }

  /** Drop what has not been written yet and release the file. */
  async abort() {
    await this.writable.abort().catch(() => {});
  }

  /** Bytes written so far, including those still batched. */
  get size(): number {
    return this.flushed + this.filled;
  }

  async close() {
    await this.flush();
    await this.writing;
    await this.writable.close();
    // Backed by the file on disk, not by memory.
    return await this.handle.getFile();
  }

  private async flush() {
    if (this.filled === 0) {
      return;
    }
    const batch = this.batch.subarray(0, this.filled);
    this.batch = new Uint8Array(WRITE_SIZE);
    this.flushed += this.filled;
    this.filled = 0;
    // Let one write run while the next batch fills; wait only for the last.
    await this.writing;
    this.writing = this.writable.write(batch);
    this.writing.catch(() => {}); // reported by the next flush or close
  }
}

// Storage layout: received/<tab>/<session>/<file>. Each tab holds a lock
// named after its directory while it is open, so other tabs can tell which
// directories are left over from tabs that have closed.

const STORAGE_DIRECTORY = "received";

/** Room to leave in the quota beyond the files themselves. */
const QUOTA_MARGIN = 64 * 1024 * 1024;

/** How long delivered files stay, for downloads that start late. */
const KEEP_AFTER_DELIVERY_MS = 30 * 60 * 1000;

type SessionDirectory = {
  parent: FileSystemDirectoryHandle;
  name: string;
  handle: FileSystemDirectoryHandle;
};

let tabDirectory: Promise<FileSystemDirectoryHandle> | null = null;
let sessionCount = 0;

function supportsDiskStorage(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof navigator.locks?.request === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

const lockName = (tab: string) => `localsend-received-${tab}`;

async function storageRoot() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(STORAGE_DIRECTORY, { create: true });
}

function openTabDirectory(): Promise<FileSystemDirectoryHandle> {
  tabDirectory ??= (async () => {
    const tab = crypto.randomUUID();
    await new Promise<void>((held) => {
      navigator.locks.request(lockName(tab), () => {
        held();
        return new Promise<void>(() => {}); // released when the tab closes
      });
    });
    const root = await storageRoot();
    return await root.getDirectoryHandle(tab, { create: true });
  })().catch((error) => {
    tabDirectory = null;
    throw error;
  });
  return tabDirectory;
}

async function openSessionDirectory(
  totalSize: number,
): Promise<SessionDirectory | null> {
  if (!supportsDiskStorage()) {
    return null;
  }
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (quota - usage < totalSize + QUOTA_MARGIN) {
      return null;
    }
    const parent = await openTabDirectory();
    const name = `${sessionCount++}`;
    const handle = await parent.getDirectoryHandle(name, { create: true });
    return { parent, name, handle };
  } catch (error) {
    console.warn("Keeping received files in memory:", error);
    return null;
  }
}

function removeSessionDirectory(storage: SessionDirectory, delivered: boolean) {
  const remove = () => {
    storage.parent
      .removeEntry(storage.name, { recursive: true })
      .catch((error) =>
        console.warn("Could not remove received files:", error),
      );
  };
  // A download reads the file while it runs and fails if it is gone.
  if (delivered) {
    setTimeout(remove, KEEP_AFTER_DELIVERY_MS);
  } else {
    remove();
  }
}

/** Remove what tabs that have since closed left in storage. */
export async function removeReceivedLeftovers() {
  if (!supportsDiskStorage()) {
    return;
  }
  try {
    const root = await storageRoot();
    const tabs: string[] = [];
    // Async iteration of a directory is not in the TypeScript DOM library used here.
    for await (const name of (
      root as unknown as { keys(): AsyncIterable<string> }
    ).keys()) {
      tabs.push(name);
    }
    for (const tab of tabs) {
      await navigator.locks.request(
        lockName(tab),
        { ifAvailable: true },
        async (lock) => {
          if (lock) {
            await root.removeEntry(tab, { recursive: true });
          }
        },
      );
    }
  } catch (error) {
    console.warn("Could not remove received leftovers:", error);
  }
}
