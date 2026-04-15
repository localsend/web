import type {
  ClientInfo,
  ClientInfoWithoutId,
  WsServerMessage,
  WsServerSdpMessage,
} from "~/services/signaling";
import { SignalingConnection } from "~/services/signaling";
import {
  defaultStun,
  type FileDto,
  type FileProgress,
  receiveFiles,
  sendFiles,
} from "~/services/webrtc";
import { generateClientTokenFromCurrentTimestamp } from "~/services/crypto";

export enum SessionState {
  idle = "idle",
  sending = "sending",
  receiving = "receiving",
}

export type FileState = {
  id: string;
  name: string;
  curr: number;
  total: number;
  state: "pending" | "skipped" | "sending" | "finished" | "error";
  error?: string;
};

export const store = reactive({
  // Whether the connection loop has started
  _loopStarted: false,

  // Client information of the current user that we send to the server
  _proposingClient: null as ClientInfoWithoutId | null,

  _onPin: null as (() => Promise<string | null>) | null,

  // Public and private key pair for signing and verifying messages
  key: null as CryptoKeyPair | null,

  /// PIN code used before receiving or sending files
  pin: sessionStorage.getItem("transfer_pin") ?? null,
  // Signaling connection to the server
  signaling: null as SignalingConnection | null,

  // Client information of the current user that we received from the server
  client: null as ClientInfo | null,

  // List of peers connected to the same room
  peers: [] as ClientInfo[],

  // Current session information
  session: {
    state: SessionState.idle,
    curr: 0,
    total: 1, // Avoid division by zero
    fileState: {} as Record<string, FileState>,
  },
});

export async function setupConnection({
  url,
  info,
  onPin,
}: {
  url: string;
  info: ClientInfoWithoutId;
  onPin: () => Promise<string | null>;
}) {
  store._proposingClient = info;
  store._onPin = onPin;
  if (!store._loopStarted) {
    store._loopStarted = true;
    connectionLoop(url).then(() => console.log("Connection loop ended"));
  }
}

async function connectionLoop(url: string) {
  while (true) {
    try {
      store.signaling = await SignalingConnection.connect({
        url: url,
        info: store._proposingClient!,
        onMessage: (data: WsServerMessage) => {
          switch (data.type) {
            case "HELLO":
              store.client = data.client;
              store.peers = data.peers;
              break;
            case "JOIN":
              store.peers = [...store.peers, data.peer];
              break;
            case "UPDATE":
              store.peers = store.peers.map((p) =>
                p.id === data.peer.id ? data.peer : p,
              );
              break;
            case "LEFT":
              store.peers = store.peers.filter((p) => p.id !== data.peerId);
              break;
            case "OFFER":
              acceptOffer({ offer: data, onPin: store._onPin! });
              break;
            case "ANSWER":
              break;
          }
        },
        generateNewInfo: async () => {
          const token = await generateClientTokenFromCurrentTimestamp(
            store.key!,
          );
          updateClientTokenState(token);
          return { ...store._proposingClient!, token };
        },
        onClose: () => {
          store.signaling = null;
          store.client = null;
          store.peers = [];
        },
      });

      await store.signaling.waitUntilClose();
    } catch (error) {
      console.log("Retrying connection in 5 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait before retrying
    }
  }
}
watch(
  () => store.pin,
  (newPin) => {
    if (newPin) {
      sessionStorage.setItem("transfer_pin", newPin);
    } else {
      sessionStorage.removeItem("transfer_pin");
    }
  },
  { immediate: false }
);
export function setPinState(pin: string | null) {
  store.pin = (pin && pin.trim() !== "") ? pin : null;
}

export function updateAliasState(alias: string) {
  store._proposingClient!.alias = alias;
  store.client!.alias = alias;
}

function updateClientTokenState(token: string) {
  store._proposingClient!.token = token;
  store.client!.token = token;
}

const PIN_MAX_TRIES = 3;

export async function startSendSession({
  files,
  targetId,
  onPin,
}: {
  files: FileList;
  targetId: string;
  onPin: () => Promise<string | null>;
}): Promise<void> {
  store.session.state = SessionState.sending;
  const fileState: Record<string, FileState> = {};

  const fileDtoList = convertFileListToDto(files);
  const fileMap = fileDtoList.reduce(
    (acc, file) => {
      acc[file.id] = files[parseInt(file.id)];
      fileState[file.id] = {
        id: file.id,
        name: file.fileName,
        curr: 0,
        total: file.size,
        state: "pending",
      };
      return acc;
    },
    {} as Record<string, File>,
  );

  store.session.fileState = fileState;
  store.session.curr = 0;
  store.session.total = fileDtoList.reduce((acc, file) => acc + file.size, 0);

  try {
    await sendFiles({
      signaling: store.signaling as SignalingConnection,
      stunServers: defaultStun,
      fileDtoList: fileDtoList,
      fileMap: fileMap,
      targetId: targetId,
      signingKey: store.key!,
      pin: store.pin ? { pin: store.pin, maxTries: PIN_MAX_TRIES } : undefined,
      onPin: onPin,
      onFilesSkip: (fileIds) => {
        for (const id of fileIds) {
          store.session.fileState[id].state = "skipped";
        }
      },
      onFileProgress: onFileProgress,
    });
  } finally {
    store.session.state = SessionState.idle;
  }
}

function convertFileListToDto(files: FileList): FileDto[] {
  const result: FileDto[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    result.push({
      id: i.toString(),
      fileName: file.name,
      size: file.size,
      fileType: file.type,
      metadata: {
        modified: new Date(file.lastModified).toISOString(),
      },
    });
  }

  return result;
}

export async function acceptOffer({
  offer,
  onPin,
}: {
  offer: WsServerSdpMessage;
  onPin: () => Promise<string | null>;
}) {
  store.session.state = SessionState.receiving;

  try {
    await receiveFiles({
      signaling: store.signaling as SignalingConnection,
      stunServers: defaultStun,
      offer: offer,
      signingKey: store.key!,
      pin: store.pin ? { pin: store.pin, maxTries: PIN_MAX_TRIES } : undefined,
      onPin: onPin,
      selectFiles: async (files) => {
        // Select all files
        store.session.curr = 0;
        store.session.total = files.reduce((acc, file) => acc + file.size, 0);
        store.session.fileState = {};
        for (const file of files) {
          store.session.fileState[file.id] = {
            id: file.id,
            name: file.fileName,
            curr: 0,
            total: file.size,
            state: "pending",
          };
        }
        return files.map((file) => file.id);
      },
      onFileProgress: onFileProgress,
    });
  } finally {
    store.session.state = SessionState.idle;
  }
}

function onFileProgress(progress: FileProgress) {
  store.session.fileState[progress.id].curr = progress.curr;
  store.session.curr = Object.values(store.session.fileState).reduce(
    (acc, file) => acc + file.curr,
    0,
  );
  if (progress.success) {
    store.session.fileState[progress.id].state = "finished";
  } else if (progress.error) {
    store.session.fileState[progress.id].state = "error";
    store.session.fileState[progress.id].error = progress.error;
  }
}
