import {
  chunkStream,
  MAX_BUFFERED_AMOUNT,
  sendDelimiter,
  waitBufferDrained,
} from "./dataChannel";
import type { StreamController } from "./streamController";

export type OutgoingFile = {
  id: string;
  token: string;
  file: File;
};

export type FileProgressUpdate = {
  id: string;
  curr: number;
  success?: boolean;
  error?: string;
};

/**
 * Send the accepted files back to back, reading the receiver's per-file
 * statuses as they arrive.
 *
 * The receiver acknowledges a file only once the next header, or the final
 * delimiter, reaches it. Waiting for that acknowledgement before starting the
 * next file left the channel idle for a round trip plus the receiver's save,
 * once per file. The native sender never waits, so receivers already accept
 * files back to back.
 */
export async function sendFileList({
  dataChannel,
  dataChannelStream,
  files,
  chunkSize,
  onFileProgress,
}: {
  dataChannel: RTCDataChannel;
  dataChannelStream: StreamController<string | ArrayBuffer>;
  files: OutgoingFile[];
  chunkSize: number;
  onFileProgress: (progress: FileProgressUpdate) => void;
}) {
  const statuses = receiveFileStatuses(
    dataChannelStream,
    files,
    onFileProgress,
  );
  // A failure surfaces at the await below; it is not unhandled meanwhile.
  statuses.catch(() => {});

  for (const { id, token, file } of files) {
    console.log(`Sending file: ${file.name}`);
    dataChannel.send(JSON.stringify({ id, token }));
    await sendFileInChunks(dataChannel, file, chunkSize, (bytes) => {
      onFileProgress({ id, curr: bytes });
    });
  }
  sendDelimiter(dataChannel);

  console.log("Waiting for file status...");
  await statuses;
}

/** One status per file, in the order the files were sent. */
async function receiveFileStatuses(
  dataChannelStream: StreamController<string | ArrayBuffer>,
  files: OutgoingFile[],
  onFileProgress: (progress: FileProgressUpdate) => void,
) {
  for (const { id, file } of files) {
    const fileStatus = await dataChannelStream.readNext();
    if (typeof fileStatus !== "string") {
      throw new Error("Expected string");
    }

    const response = JSON.parse(fileStatus) as {
      success: boolean;
      error?: string;
    };
    onFileProgress({
      id,
      curr: file.size,
      success: response.success,
      error: response.error,
    });
  }
}

/**
 * Send a file in chunks, pausing whenever the send queue is full.
 */
export async function sendFileInChunks(
  dataChannel: RTCDataChannel,
  file: File,
  chunkSize: number,
  onProgress: (bytes: number) => void,
) {
  let bytesSent = 0;

  for await (const chunk of chunkStream(file, chunkSize)) {
    if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      await waitBufferDrained(dataChannel);
    }

    dataChannel.send(chunk);

    bytesSent += chunk.length;
    onProgress(bytesSent);
  }
}
