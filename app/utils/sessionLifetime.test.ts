import { expect, test } from "vitest";
import { SessionLifetime } from "./sessionLifetime";

test("Should stop waiting once the session ends", async () => {
  const session = new SessionLifetime();
  const waiting = session.until(new Promise(() => {}));
  session.end(new Error("Data channel closed"));
  await expect(waiting).rejects.toThrow("Data channel closed");
});

test("Should pass through a promise that settles first", async () => {
  const session = new SessionLifetime();
  expect(await session.until(Promise.resolve(42))).toBe(42);
});

test("Should run cleanups once, with the first reason", () => {
  const session = new SessionLifetime();
  let runs = 0;
  session.onEnd(() => runs++);
  session.end(new Error("first"));
  session.end(new Error("second"));
  expect(runs).toBe(1);
  expect(session.endReason?.message).toBe("first");

  // Registered after the end: runs right away.
  session.onEnd(() => runs++);
  expect(runs).toBe(2);
});

test("Should end when cancelled", async () => {
  const abort = new AbortController();
  const session = new SessionLifetime(abort.signal);
  const waiting = session.until(new Promise(() => {}));
  abort.abort();
  await expect(waiting).rejects.toThrow("Cancelled");
});

test("Should start ended when already cancelled", async () => {
  const abort = new AbortController();
  abort.abort();
  const session = new SessionLifetime(abort.signal);
  await expect(session.until(new Promise(() => {}))).rejects.toThrow(
    "Cancelled",
  );
});
