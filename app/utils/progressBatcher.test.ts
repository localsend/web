import { expect, test } from "vitest";
import { ProgressBatcher } from "./progressBatcher";

/** Frames that only run when the test says so. */
const manualFrames = () => {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    schedule: (callback: () => void) => {
      callbacks.set(next, callback);
      return next++;
    },
    cancel: (handle: number) => callbacks.delete(handle),
    pending: () => callbacks.size,
    run: () => {
      const due = [...callbacks.values()];
      callbacks.clear();
      due.forEach((callback) => callback());
    },
  };
};

test("Should apply only the latest value per file, once per frame", () => {
  const frames = manualFrames();
  const applied: Record<string, number>[] = [];
  const batcher = new ProgressBatcher(
    (updates) => applied.push(Object.fromEntries(updates)),
    frames.schedule,
    frames.cancel,
  );

  batcher.push("a", 1);
  batcher.push("a", 2);
  batcher.push("b", 5);
  batcher.push("a", 3);
  expect(applied).toEqual([]);
  expect(frames.pending()).toBe(1);

  frames.run();
  expect(applied).toEqual([{ a: 3, b: 5 }]);

  batcher.push("b", 6);
  frames.run();
  expect(applied).toEqual([{ a: 3, b: 5 }, { b: 6 }]);
});

test("Should apply pending values at once on flush", () => {
  const frames = manualFrames();
  const applied: Record<string, number>[] = [];
  const batcher = new ProgressBatcher(
    (updates) => applied.push(Object.fromEntries(updates)),
    frames.schedule,
    frames.cancel,
  );

  batcher.push("a", 1);
  batcher.flush();
  expect(applied).toEqual([{ a: 1 }]);

  // The frame was cancelled, so nothing is applied twice.
  expect(frames.pending()).toBe(0);
  frames.run();
  expect(applied).toEqual([{ a: 1 }]);
});

test("Should not apply anything when nothing is pending", () => {
  const frames = manualFrames();
  let calls = 0;
  const batcher = new ProgressBatcher(
    () => calls++,
    frames.schedule,
    frames.cancel,
  );

  batcher.flush();
  expect(calls).toBe(0);
});
