<template>
  <div class="dark:text-white flex flex-col h-screen">
    <div class="flex mt-2">
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
    </div>

    <div v-if="store.client" class="flex justify-center items-center mt-8 pb-8">
      <div class="flex">
        <div>
          {{ t("index.you") }}<br />
          <span class="font-bold cursor-pointer" @click="updateAlias">{{
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
          <span class="font-bold cursor-pointer" @click="updatePIN">
            {{ store.pin ?? t("index.pin.none") }}
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="!store.signaling"
      class="flex-1 flex flex-col items-center justify-center text-center px-2"
    >
      <h3 v-if="minDelayFinished" class="text-3xl">
        {{
          webCryptoSupported
            ? t("index.connecting")
            : t("index.webCryptoNotSupported")
        }}
      </h3>
    </div>

    <div
      v-else-if="store.peers.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-center px-2"
    >
      <h3 class="text-3xl">{{ t("index.empty.title") }}</h3>
      <h3 class="mt-2">{{ t("index.empty.deviceHint") }}</h3>
      <h3>{{ t("index.empty.lanHint") }}</h3>
    </div>

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

    <SessionDialog />
  </div>
</template>

<script setup lang="ts">
import { PeerDeviceType } from "@/services/signaling";
import {
  setupConnection,
  startSendSession,
  store,
  updateAliasState,
} from "@/services/store";
import { getAgentInfoString } from "~/utils/userAgent";
import { protocolVersion } from "~/services/webrtc";
import { generateRandomAlias } from "~/utils/alias";
import { useFileDialog } from "@vueuse/core";
import SessionDialog from "~/components/dialog/SessionDialog.vue";
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

onChange(async (files) => {
  if (!files) return;

  if (files.length === 0) return;

  if (!store.signaling) return;

  await startSendSession({
    files,
    targetId: targetId.value,
    onPin: async () => {
      return prompt(t("index.enterPin"));
    },
  });
});

const minDelayFinished = ref(false);
const webCryptoSupported = ref(true);

const targetId = ref("");

const selectPeer = (id: string) => {
  targetId.value = id;
  openFileDialog();
};

const updateAlias = async () => {
  if (!store.client) return;

  const current = store.client;
  if (!current) return;

  const alias = prompt(t("index.enterAlias"), current.alias);
  if (!alias || !store.signaling) return;

  store.signaling.send({
    type: "UPDATE",
    info: {
      alias: alias,
      version: current.version,
      deviceModel: current.deviceModel,
      deviceType: current.deviceType,
      token: current.token,
    },
  });

  updateAliasState(alias);
};

const updatePIN = async () => {
  const pin = prompt(t("index.enterPin"));
  if (typeof pin === "string") {
    store.pin = pin ? pin : null;
  }
};

onMounted(async () => {
  webCryptoSupported.value = isWebCryptoSupported();

  setTimeout(() => {
    // to prevent flickering during initial connection
    // i.e. show blank screen instead of "Connecting..."
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
    onPin: async () => {
      return prompt(t("index.enterPin"));
    },
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
</style>
