/** Stop refilling the send queue above this. */
export const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MiB

/** Resume refilling once the queue has drained to this, so the wire never idles. */
export const LOW_BUFFERED_AMOUNT = 256 * 1024; // 256 KiB

/**
 * Wait until the send queue has drained to the channel's low threshold.
 *
 * Polling this with a fixed sleep capped every transfer: a fast link drains
 * the 1 MiB queue in a few ms and the sender then slept out the rest of the
 * interval instead of refilling it, so most of the wall clock went to the
 * timer rather than to the network.
 */
export function waitBufferDrained(dataChannel: RTCDataChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      dataChannel.removeEventListener("bufferedamountlow", onDrained);
      dataChannel.removeEventListener("close", onClosed);
      dataChannel.removeEventListener("error", onClosed);
    };

    const onDrained = () => {
      cleanup();
      resolve();
    };

    const onClosed = () => {
      cleanup();
      reject(new Error("Data channel closed while sending"));
    };

    dataChannel.addEventListener("bufferedamountlow", onDrained);
    dataChannel.addEventListener("close", onClosed);
    dataChannel.addEventListener("error", onClosed);

    // The event only fires on a downward crossing, so a queue that drained
    // between the caller's check and these listeners would never wake us.
    if (dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold) {
      onDrained();
    }
  });
}

/**
 * Split a file into chunks of at most chunkSize, the last one short.
 *
 * Reads are carried over between iterations, so a read that does not land on
 * a chunk boundary does not force the whole remainder to be recopied. Each
 * chunk is a view into the read buffer, which is safe because
 * RTCDataChannel.send copies synchronously.
 */
export async function* chunkStream(
  file: File,
  chunkSize: number,
): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();

  // Tail of the previous read, when it did not end on a chunk boundary.
  let pending: Uint8Array | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    let block = value;
    if (pending) {
      // Copies the carried-over tail, never the whole file.
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      block = merged;
      pending = null;
    }

    let offset = 0;
    while (block.length - offset >= chunkSize) {
      yield block.subarray(offset, offset + chunkSize);
      offset += chunkSize;
    }

    if (offset < block.length) {
      pending = block.subarray(offset);
    }
  }

  if (pending && pending.length > 0) {
    yield pending;
  }
}
