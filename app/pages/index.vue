<template>
  <div
    class="dark:text-white flex flex-col h-screen"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Header -->
    <div class="flex mt-2 items-center">
      <img
        src="/apple-touch-icon.png"
        alt="Logo"
        class="h-16 ml-2"
        style="animation: spin 10s linear infinite"
      />
      <div class="flex flex-col justify-center ml-2">
        <h1 class="text-xl font-bold">LocalSend</h1>
        <h2 class="leading-none mt-0.5">Web</h2>
      </div>

      <!-- Connection Status -->
      <div class="ml-auto mr-4 flex items-center gap-2 text-sm">
        <span
          class="inline-block w-2.5 h-2.5 rounded-full"
          :class="{
            'bg-green-500': store.connectionStatus === 'connected',
            'bg-yellow-500 animate-pulse': store.connectionStatus === 'reconnecting',
            'bg-red-500': store.connectionStatus === 'disconnected',
          }"
        ></span>
        <span class="hidden sm:inline opacity-70">
          {{ t(`index.connection.${store.connectionStatus}`) }}
        </span>
      </div>
    </div>

    <!-- Current User Info -->
    <div v-if="store.client" class="flex justify-center items-center mt-8 pb-8">
      <div class="flex">
        <div>
          {{ t("index.you") }}<br />
          <span class="font-bold cursor-pointer" @click="showAliasDialog">{{
            store.client.alias
          }}</span>
        </div>

        <div
          class="inline-block h-12 w-[2px] bg-gray-300 dark:bg-gray-700 mx-4"
        ></div>

        <div class="pr-2">
          <span>
            {{ t("index.pin.label") }}
          </span>
          <br />
          <span class="font-bold cursor-pointer" @click="showPinDialog">
            {{ store.pin ?? t("index.pin.none") }}
          </span>
        </div>
      </div>
    </div>

    <!-- Connecting State -->
    <div
      v-if="!store.signaling"
      class="flex-1 flex flex-col items-center justify-center text-center px-2"
    >
      <h3 v-if="minDelayFinished" class="text-3xl">
        {{
          webCryptoSupported
            ? store.connectionStatus === 'reconnecting'
              ? t("index.connection.reconnecting")
              : t("index.connecting")
            : t("index.webCryptoNotSupported")
        }}
      </h3>
    </div>

    <!-- No Peers -->
    <div
      v-else-if="store.peers.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-center px-2"
    >
      <h3 class="text-3xl">{{ t("index.empty.title") }}</h3>
      <h3 class="mt-2">{{ t("index.empty.deviceHint") }}</h3>
      <h3>{{ t("index.empty.lanHint") }}</h3>
    </div>

    <!-- Peer List -->
    <div v-else class="flex justify-center px-4">
      <div class="w-96">
        <PeerCard
          v-for="peer in store.peers"
          :key="peer.id"
          :peer="peer"
          class="mb-4"
          @click="selectPeer(peer.id)"
        />
      </div>
    </div>

    <!-- Drag & Drop Overlay -->
    <transition name="fade">
      <div
        v-if="isDragging"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-60 pointer-events-none"
      >
        <div class="text-center">
          <Icon
            name="material-symbols:cloud-upload"
            class="size-20 text-teal-400 mb-4"
          />
          <p class="text-white text-2xl font-bold">
            {{ t("index.dragDrop.hint") }}
          </p>
        </div>
      </div>
    </transition>

    <SessionDialog />
    <Toast />

    <!-- Alias Input Dialog -->
    <InputDialog
      :visible="aliasDialogVisible"
      :title="t('index.enterAlias')"
      :default-value="store.client?.alias ?? ''"
      :confirm-text="t('index.dialog.confirm')"
      :cancel-text="t('index.dialog.cancel')"
      @confirm="onAliasConfirm"
      @cancel="aliasDialogVisible = false"
    />

    <!-- PIN Input Dialog -->
    <InputDialog
      :visible="pinDialogVisible"
      :title="t('index.enterPin')"
      :default-value="store.pin ?? ''"
      :confirm-text="t('index.dialog.confirm')"
      :cancel-text="t('index.dialog.cancel')"
      @confirm="onPinConfirm"
      @cancel="pinDialogVisible = false"
    />

    <!-- PIN Prompt Dialog (for file transfer) -->
    <InputDialog
      :visible="transferPinDialogVisible"
      :title="t('index.enterPin')"
      :confirm-text="t('index.dialog.confirm')"
      :cancel-text="t('index.dialog.cancel')"
      @confirm="onTransferPinConfirm"
      @cancel="onTransferPinCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { PeerDeviceType } from "@/services/signaling";
import {
  setupConnection,
  startSendSession,
  store,
  updateAliasState,
  showToast,
  requestNotificationPermission,
} from "@/services/store";
import { getAgentInfoString } from "~/utils/userAgent";
import { protocolVersion } from "~/services/webrtc";
import { generateRandomAlias } from "~/utils/alias";
import { useFileDialog } from "@vueuse/core";
import SessionDialog from "~/components/dialog/SessionDialog.vue";
import InputDialog from "~/components/dialog/InputDialog.vue";
import Toast from "~/components/Toast.vue";
import {
  cryptoKeyToPem,
  generateClientTokenFromCurrentTimestamp,
  generateKeyPair,
  isWebCryptoSupported,
  upgradeToEd25519IfSupported,
} from "~/services/crypto";

definePageMeta({
  title: "index.seo.title",
  description: "index.seo.description",
});

const runtimeConfig = useRuntimeConfig();

const { t } = useI18n();

const { open: openFileDialog, onChange } = useFileDialog();

// --- Drag & Drop ---
const isDragging = ref(false);
let dragLeaveTimeout: ReturnType<typeof setTimeout> | null = null;

const onDragOver = () => {
  if (dragLeaveTimeout) clearTimeout(dragLeaveTimeout);
  isDragging.value = true;
};

const onDragLeave = () => {
  dragLeaveTimeout = setTimeout(() => {
    isDragging.value = false;
  }, 100);
};

const onDrop = async (e: DragEvent) => {
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  if (!store.signaling) {
    showToast(t("index.dragDrop.noPeer"), "error");
    return;
  }

  if (store.peers.length === 0) {
    showToast(t("index.dragDrop.noPeer"), "error");
    return;
  }

  // Send to the first available peer
  const peerId = store.peers[0].id;
  await startSendSession({
    files,
    targetId: peerId,
    onPin: requestTransferPin,
  });
};

// --- Custom Input Dialogs ---
const aliasDialogVisible = ref(false);
const pinDialogVisible = ref(false);
const transferPinDialogVisible = ref(false);
let transferPinResolve: ((value: string | null) => void) | null = null;

const showAliasDialog = () => {
  aliasDialogVisible.value = true;
};

const onAliasConfirm = (value: string) => {
  aliasDialogVisible.value = false;
  if (!value || !store.signaling || !store.client) return;

  store.signaling.send({
    type: "UPDATE",
    info: {
      alias: value,
      version: store.client.version,
      deviceModel: store.client.deviceModel,
      deviceType: store.client.deviceType,
      token: store.client.token,
    },
  });

  updateAliasState(value);
};

const showPinDialog = () => {
  pinDialogVisible.value = true;
};

const onPinConfirm = (value: string) => {
  pinDialogVisible.value = false;
  store.pin = value ? value : null;
};

const requestTransferPin = (): Promise<string | null> => {
  return new Promise((resolve) => {
    transferPinResolve = resolve;
    transferPinDialogVisible.value = true;
  });
};

const onTransferPinConfirm = (value: string) => {
  transferPinDialogVisible.value = false;
  transferPinResolve?.(value || null);
  transferPinResolve = null;
};

const onTransferPinCancel = () => {
  transferPinDialogVisible.value = false;
  transferPinResolve?.(null);
  transferPinResolve = null;
};

// --- File Selection via Click ---
onChange(async (files) => {
  if (!files) return;
  if (files.length === 0) return;
  if (!store.signaling) return;

  await startSendSession({
    files,
    targetId: targetId.value,
    onPin: requestTransferPin,
  });
});

const minDelayFinished = ref(false);
const webCryptoSupported = ref(true);
const targetId = ref("");

const selectPeer = (id: string) => {
  targetId.value = id;
  openFileDialog();
};

onMounted(async () => {
  webCryptoSupported.value = isWebCryptoSupported();

  requestNotificationPermission();

  setTimeout(() => {
    minDelayFinished.value = true;
  }, 1000);

  if (!webCryptoSupported.value) {
    console.error("Web Crypto API is not supported in this browser.");
    return;
  }

  await upgradeToEd25519IfSupported();

  store.key = await generateKeyPair();

  console.log(await cryptoKeyToPem(store.key.publicKey));

  const userAgent = navigator.userAgent;
  const token = await generateClientTokenFromCurrentTimestamp(store.key);

  const info = {
    alias: generateRandomAlias(),
    version: protocolVersion,
    deviceModel: getAgentInfoString(userAgent),
    deviceType: PeerDeviceType.web,
    token: token,
  };

  await setupConnection({
    url: runtimeConfig.public.signalingUrl,
    info,
    onPin: requestTransferPin,
  });
});
</script>

<style>
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
