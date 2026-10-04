import { expect, test, vi } from "vitest";
import { type FileProgressUpdate, sendFileList } from "./fileSender";
import { StreamController } from "./streamController";

/** Records what is sent: strings as they are, binary messages by size. */
class FakeDataChannel extends EventTarget {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 256 * 1024;
  readyState: RTCDataChannelState = "open";
  sent: (string | number)[] = [];

  send(data: string | Uint8Array) {
    this.sent.push(typeof data === "string" ? data : data.byteLength);
  }
}

const file = (name: string, size: number) =>
  new File([new Uint8Array(size)], name);

const header = (id: string, token: string) => JSON.stringify({ id, token });

test("Should send every file before the first status arrives", async () => {
  const channel = new FakeDataChannel();
  const stream = new StreamController<string | ArrayBuffer>();
  const progress: FileProgressUpdate[] = [];

  const sending = sendFileList({
    dataChannel: channel as unknown as RTCDataChannel,
    dataChannelStream: stream,
    files: [
      { id: "a", token: "ta", file: file("a.bin", 2500) },
      { id: "b", token: "tb", file: file("b.bin", 1000) },
    ],
    chunkSize: 1024,
    onFileProgress: (update) => progress.push(update),
  });

  // No status has arrived, yet both files and the delimiter go out.
  await vi.waitFor(() => expect(channel.sent.at(-1)).toBe("0"));
  expect(channel.sent).toEqual([
    header("a", "ta"),
    1024,
    1024,
    452,
    header("b", "tb"),
    1000,
    "0",
  ]);
  expect(
    progress.filter((update) => update.id === "a").map((u) => u.curr),
  ).toEqual([1024, 2048, 2500]);

  stream.add(JSON.stringify({ id: "a", success: true }));
  stream.add(JSON.stringify({ id: "b", success: false, error: "Disk full" }));
  await sending;

  expect(progress.filter((update) => update.success !== undefined)).toEqual([
    { id: "a", curr: 2500, success: true, error: undefined },
    { id: "b", curr: 1000, success: false, error: "Disk full" },
  ]);
});

test("Should reject when a status is not a string", async () => {
  const channel = new FakeDataChannel();
  const stream = new StreamController<string | ArrayBuffer>();

  const sending = sendFileList({
    dataChannel: channel as unknown as RTCDataChannel,
    dataChannelStream: stream,
    files: [{ id: "a", token: "ta", file: file("a.bin", 10) }],
    chunkSize: 1024,
    onFileProgress: () => {},
  });

  stream.add(new ArrayBuffer(1));
  await expect(sending).rejects.toThrow("Expected string");
});
