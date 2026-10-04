import { expect, test } from "vitest";
import { StreamController } from "./streamController";

test("Should add data to stream", async () => {
  const streamController = new StreamController<number>();
  streamController.add(1);
  streamController.add(2);
  streamController.add(3);

  const { asyncIterator } = streamController.createAsyncIterator();

  let emitted = [];

  for await (const value of asyncIterator) {
    emitted.push(value);
    if (value === 3) {
      break;
    }
  }

  expect(emitted).toEqual([1, 2, 3]);
});

test("Should be able to resume after break", async () => {
  const streamController = new StreamController<number>();
  streamController.add(1);
  streamController.add(2);
  streamController.add(3);

  const iterator = streamController.createAsyncIterator();

  let emitted = [];

  for await (const value of iterator.asyncIterator) {
    emitted.push(value);

    if (emitted.length === 2) {
      break;
    }
  }

  iterator.releaseLock();
  expect(emitted).toEqual([1, 2]);
  streamController.add(10);

  for await (const value of streamController.createAsyncIterator()
    .asyncIterator) {
    emitted.push(value);

    if (value === 10) {
      break;
    }
  }

  expect(emitted).toEqual([1, 2, 3, 10]);
});

test("Should deliver queued data after close, then end", async () => {
  const streamController = new StreamController<number>();
  streamController.add(1);
  streamController.close();
  streamController.add(2); // ignored, the stream has ended

  expect(await streamController.readNext()).toBe(1);
  await expect(streamController.readNext()).rejects.toThrow("No more data");
});

test("Should finish a waiting iterator on close", async () => {
  const streamController = new StreamController<number>();
  const emitted: number[] = [];
  const reading = (async () => {
    for await (const value of streamController.createAsyncIterator()
      .asyncIterator) {
      emitted.push(value);
    }
  })();

  streamController.add(1);
  streamController.close();
  await reading;
  expect(emitted).toEqual([1]);
});
