/** Stop refilling the send queue above this. */
export const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MiB

/** Resume refilling once the queue has drained to this, so the wire never idles. */
export const LOW_BUFFERED_AMOUNT = 256 * 1024; // 256 KiB

/** Message size every peer accepts, the native app included. */
export const CHUNK_SIZE = 16 * 1024; // 16 KiB

/** Message size for peers that advertise room for larger messages. */
export const LARGE_CHUNK_SIZE = 64 * 1024; // 64 KiB

/**
 * Pick the size of file chunks for a connection, from the peer's advertised
 * limit (RTCSctpTransport.maxMessageSize).
 *
 * 64 KiB chunks need a quarter of the sends, message events and progress
 * updates. Browsers advertise their limit (Chromium 256 KiB). The native
 * app's WebRTC stack advertises
 * none, which browsers read as the RFC 8841 default of 64 KiB, yet it reads
 * each message into a 65,535-byte buffer and closes the channel on anything
 * larger. So only go above 16 KiB when the peer explicitly allows more than
 * 64 KiB.
 */
export function fileChunkSize(maxMessageSize: number | undefined): number {
  return maxMessageSize !== undefined && maxMessageSize > LARGE_CHUNK_SIZE
    ? LARGE_CHUNK_SIZE
    : CHUNK_SIZE;
}

/** Send the string that ends a chunked message or the list of files. */
export function sendDelimiter(dataChannel: RTCDataChannel) {
  // Not empty: empty messages do not reach the native peer.
  dataChannel.send("0");
}

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
    // A close that fired before we got here would never reach the listeners,
    // and bufferedAmount does not reset on close, so nothing would wake us.
    if (dataChannel.readyState !== "open") {
      reject(new Error("Data channel closed while sending"));
      return;
    }

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
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const reader = file.stream().getReader();

  // Tail of the previous read, when it did not end on a chunk boundary.
  let pending: Uint8Array<ArrayBuffer> | null = null;

  try {
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
  } finally {
    // Release the file when the consumer stops early, e.g. on a send error.
    reader.cancel().catch(() => {});
  }
}
