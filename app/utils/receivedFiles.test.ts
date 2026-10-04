import { expect, test } from "vitest";
import { ReceivedFiles } from "./receivedFiles";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

// Node has no origin private file system, so this runs the in-memory path.
const open = async (
  files: { id: string; fileName: string; size: number }[],
) => {
  const saved: { name: string; text: string }[] = [];
  const pending: Promise<void>[] = [];
  const received = await ReceivedFiles.open(files, (blob, name) => {
    pending.push(blob.text().then((text) => void saved.push({ name, text })));
  });
  return { received, saved, settled: () => Promise.all(pending) };
};

test("Should hand over each file in memory as it completes", async () => {
  const files = [
    { id: "a", fileName: "a.txt", size: 5 },
    { id: "b", fileName: "b.txt", size: 3 },
  ];
  const { received, saved, settled } = await open(files);

  const a = await received.begin(files[0]!);
  await a.write(bytes("hel"));
  await a.write(bytes("lo"));
  expect(await a.finish()).toBeUndefined();

  const b = await received.begin(files[1]!);
  await b.write(bytes("abc"));
  expect(await b.finish()).toBeUndefined();

  received.release();
  await settled();
  expect(saved).toEqual([
    { name: "a.txt", text: "hello" },
    { name: "b.txt", text: "abc" },
  ]);
});

test("Should reject a file that does not match its declared size", async () => {
  const files = [
    { id: "short", fileName: "short.txt", size: 10 },
    { id: "long", fileName: "long.txt", size: 2 },
  ];
  const { received, saved, settled } = await open(files);

  const short = await received.begin(files[0]!);
  await short.write(bytes("abc"));
  expect(await short.finish()).toBe("Received 3 of 10 bytes");

  const long = await received.begin(files[1]!);
  await long.write(bytes("abc"));
  expect(await long.finish()).toBe("Received more than the expected 2 bytes");

  await settled();
  expect(saved).toEqual([]);
});
