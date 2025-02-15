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

    <div v-if="store.client" class="text-center mt-8 pb-8">
      {{ t("index.you") }}<br />
      <span class="font-bold cursor-pointer" @click="updateAlias">{{
        store.client.alias
      }}</span>
    </div>

    <div
      v-if="!store.signaling"
      class="flex-1 flex flex-col items-center justify-center text-center px-2"
    >
      <h3 v-if="minDelayFinished" class="text-3xl">
        {{ t("index.connecting") }}
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
  generateEd25519KeyPair,
  generateFingerprint,
} from "~/services/crypto";

definePageMeta({
  title: "index.seo.title",
  description: "index.seo.description",
});

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
    type: "update",
    alias: alias,
    version: current.version,
    deviceModel: current.deviceModel,
    deviceType: current.deviceType,
    fingerprint: current.fingerprint,
  });

  updateAliasState(alias);
};

onMounted(async () => {
  setTimeout(() => {
    // to prevent flickering during initial connection
    minDelayFinished.value = true;
  }, 1000);

  store.key = await generateEd25519KeyPair();

  console.log(await cryptoKeyToPem(store.key.publicKey));

  const userAgent = navigator.userAgent;
  const fingerprint = await generateFingerprint(store.key);

  const info = {
    alias: generateRandomAlias(),
    version: protocolVersion,
    deviceModel: getAgentInfoString(userAgent),
    deviceType: PeerDeviceType.web,
    fingerprint: fingerprint,
  };

  await setupConnection(info);
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
