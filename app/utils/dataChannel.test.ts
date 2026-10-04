import { expect, test } from "vitest";
import {
  chunkStream,
  LOW_BUFFERED_AMOUNT,
  waitBufferDrained,
} from "./dataChannel";

class FakeDataChannel extends EventTarget {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = LOW_BUFFERED_AMOUNT;
}

const fake = (bufferedAmount: number) => {
  const channel = new FakeDataChannel();
  channel.bufferedAmount = bufferedAmount;
  return channel;
};

test("Should wait for the queue to drain", async () => {
  const channel = fake(2 * 1024 * 1024);
  let settled = false;
  const waiting = waitBufferDrained(channel as unknown as RTCDataChannel).then(
    () => (settled = true),
  );

  await Promise.resolve();
  expect(settled).toBe(false);

  channel.bufferedAmount = LOW_BUFFERED_AMOUNT;
  channel.dispatchEvent(new Event("bufferedamountlow"));
  await waiting;
  expect(settled).toBe(true);
});

test("Should not wait when the queue already drained", async () => {
  // The event only fires on a downward crossing, so a queue that emptied
  // before the listeners were attached must not block the sender forever.
  const channel = fake(0);
  await waitBufferDrained(channel as unknown as RTCDataChannel);
});

test("Should reject when the channel closes", async () => {
  const channel = fake(2 * 1024 * 1024);
  const waiting = waitBufferDrained(channel as unknown as RTCDataChannel);
  channel.dispatchEvent(new Event("close"));
  await expect(waiting).rejects.toThrow("Data channel closed while sending");
});

const sequence = (length: number) =>
  new Uint8Array(length).map((_, i) => i & 0xff);

const collect = async (file: File, chunkSize: number) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of chunkStream(file, chunkSize)) {
    // Views must be copied here: the generator reuses the read buffer.
    chunks.push(new Uint8Array(chunk));
  }
  return chunks;
};

// Deep-equality on large arrays dominates the runtime of these tests.
const expectSameBytes = (actual: Uint8Array, expected: Uint8Array) => {
  expect(actual.length).toBe(expected.length);
  let same = true;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      same = false;
      break;
    }
  }
  expect(same).toBe(true);
};

const concat = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

test("Should end with a short chunk", async () => {
  const bytes = sequence(2500);
  const chunks = await collect(new File([bytes], "b.bin"), 1024);
  expect(chunks.map((c) => c.length)).toEqual([1024, 1024, 452]);
  expectSameBytes(concat(chunks), bytes);
});

test("Should carry data across read boundaries", async () => {
  // A chunk larger than the stream's own read size forces the generator to
  // join several reads before it can emit anything.
  const bytes = sequence(700 * 1024);
  const chunkSize = 256 * 1024;
  const chunks = await collect(new File([bytes], "c.bin"), chunkSize);
  expect(chunks.map((c) => c.length)).toEqual([
    chunkSize,
    chunkSize,
    700 * 1024 - 2 * chunkSize,
  ]);
  expectSameBytes(concat(chunks), bytes);
});

test("Should yield nothing for an empty file", async () => {
  const chunks = await collect(new File([], "d.bin"), 1024);
  expect(chunks).toEqual([]);
});
