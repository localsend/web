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

    <div class="flex justify-end px-4 pb-4">
      <button
        class="px-4 py-2 rounded-lg font-medium text-teal-700 hover:bg-gray-100"
        @click="cancelSession"
      >
        {{ t("index.progress.cancel") }}
      </button>
    </div>
  </Dialog>
</template>
<script setup lang="ts">
import { cancelSession, SessionState, store } from "~/services/store";
import { formatBytes } from "~/utils/fileSize";

const { t } = useI18n();

const totalCurr = computed(() => {
  return formatBytes(store.session.curr);
});

const totalTotal = computed(() => {
  return formatBytes(store.session.total);
});
</script>
