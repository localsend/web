/** Longest wait for ICE gathering before the description is sent anyway. */
export const ICE_GATHERING_TIMEOUT_MS = 2000;

/**
 * Wait until ICE gathering completes, or ICE_GATHERING_TIMEOUT_MS at most.
 *
 * Without trickle ICE, the offer and answer carry the candidates gathered by
 * the time they are sent. Gathering only reports "complete" once every STUN
 * request has been answered or has timed out, and one that is never answered
 * (UDP to the server blocked, IPv6 without a route) takes about 40 s to time
 * out, while the candidates a connection needs arrive within milliseconds.
 * Sending what has been gathered after a short grace period keeps STUN for
 * the networks where it works without stalling the ones where it does not.
 */
export async function waitICEGathering(
  peerConnection: RTCPeerConnection,
  timeoutMs = ICE_GATHERING_TIMEOUT_MS,
) {
  if (peerConnection.iceGatheringState === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      peerConnection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        done();
      }
    };
    const timer = setTimeout(done, timeoutMs);
    peerConnection.addEventListener("icegatheringstatechange", onChange);
  });
}
