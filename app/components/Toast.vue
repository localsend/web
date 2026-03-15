<template>
  <transition-group name="toast" tag="div" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
    <div
      v-for="toast in store.toasts"
      :key="toast.id"
      class="flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg min-w-[280px] max-w-sm"
      :class="{
        'bg-teal-600 text-white': toast.type === 'success',
        'bg-red-600 text-white': toast.type === 'error',
        'bg-gray-700 text-white': toast.type === 'info',
      }"
    >
      <Icon
        :name="toast.type === 'success'
          ? 'material-symbols:check-circle'
          : toast.type === 'error'
            ? 'material-symbols:error'
            : 'material-symbols:info'"
        class="size-5 shrink-0"
      />
      <span class="flex-1 text-sm">{{ toast.message }}</span>
      <button
        class="shrink-0 opacity-70 hover:opacity-100"
        @click="dismissToast(toast.id)"
      >
        <Icon name="material-symbols:close" class="size-4" />
      </button>
    </div>
  </transition-group>
</template>

<script setup lang="ts">
import { store, dismissToast } from "~/services/store";
</script>

<style scoped>
.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
