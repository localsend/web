<template>
  <Dialog :visible="store.session.state !== SessionState.idle">
    <div class="mt-4 mx-4">
      <h1 class="text-xl text-center mb-4">
        {{
          store.session.state === SessionState.sending
            ? t("index.progress.titleSending")
            : t("index.progress.titleReceiving")
        }}
      </h1>

      <div class="flex">
        <span class="flex-1 font-bold">Total:</span>
        <span>{{ totalCurr }} / {{ totalTotal }}</span>
      </div>
      <ProgressBar :progress="store.session.curr / store.session.total" />

      <p class="mt-4 font-bold">Files:</p>
    </div>

    <div class="pl-4 pt-2 pr-4 max-h-[300px] overflow-y-auto">
      <FileProgress
        v-for="file in store.session.fileState"
        :state="file"
        class="mb-4"
      />
    </div>
  </Dialog>
</template>
<script setup lang="ts">
import { SessionState, store } from "~/services/store";
import { formatBytes } from "~/utils/fileSize";

const { t } = useI18n();

// Wake lock: keep screen on during file transfer
// useWakeLock registers its own onUnmounted cleanup, so we don't need one here.
const { acquire, release } = useWakeLock();

onMounted(() => {
  // Check if session is already active (e.g., page refresh during transfer)
  if (store.session.state !== SessionState.idle) {
    acquire();
  }
});

// Acquire/release wake lock when transfer starts or ends
watch(
  () => store.session.state,
  (newState, oldState) => {
    if (newState !== SessionState.idle && oldState === SessionState.idle) {
      acquire();
    } else if (
      newState === SessionState.idle &&
      oldState !== SessionState.idle
    ) {
      release();
    }
  },
);

const totalCurr = computed(() => {
  return formatBytes(store.session.curr);
});

const totalTotal = computed(() => {
  return formatBytes(store.session.total);
});
</script>
