import { afterEach, expect, test, vi } from "vitest";
import { ICE_GATHERING_TIMEOUT_MS, waitICEGathering } from "./iceGathering";

class FakePeerConnection extends EventTarget {
  iceGatheringState: RTCIceGatheringState = "gathering";

  complete() {
    this.iceGatheringState = "complete";
    this.dispatchEvent(new Event("icegatheringstatechange"));
  }
}

const asPeer = (fake: FakePeerConnection) =>
  fake as unknown as RTCPeerConnection;

afterEach(() => {
  vi.useRealTimers();
});

test("Should resolve when gathering completes", async () => {
  const peer = new FakePeerConnection();
  const waiting = waitICEGathering(asPeer(peer));
  peer.complete();
  await waiting;
});

test("Should not wait when gathering already completed", async () => {
  const peer = new FakePeerConnection();
  peer.iceGatheringState = "complete";
  await waitICEGathering(asPeer(peer));
});

test("Should stop waiting for a STUN request that never returns", async () => {
  // Gathering stays "gathering" until the request times out, about 40 s.
  vi.useFakeTimers();
  const peer = new FakePeerConnection();
  let settled = false;
  const waiting = waitICEGathering(asPeer(peer)).then(() => (settled = true));

  await vi.advanceTimersByTimeAsync(ICE_GATHERING_TIMEOUT_MS - 1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(settled).toBe(true);
});
