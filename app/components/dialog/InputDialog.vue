<template>
  <Dialog :visible="visible">
    <div class="p-6">
      <h2 class="text-lg font-bold mb-4">{{ title }}</h2>
      <input
        ref="inputRef"
        v-model="inputValue"
        type="text"
        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
               bg-white dark:bg-gray-700 text-black dark:text-white
               focus:outline-none focus:ring-2 focus:ring-teal-500"
        :placeholder="placeholder"
        @keyup.enter="confirm"
      />
      <div class="flex justify-end gap-2 mt-4">
        <button
          class="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-300
                 hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="cancel"
        >
          {{ cancelText }}
        </button>
        <button
          class="px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-500"
          @click="confirm"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from "~/components/dialog/Dialog.vue";

const props = defineProps<{
  visible: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{
  confirm: [value: string];
  cancel: [];
}>();

const inputValue = ref(props.defaultValue ?? "");
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.visible,
  (val) => {
    if (val) {
      inputValue.value = props.defaultValue ?? "";
      nextTick(() => {
        inputRef.value?.focus();
        inputRef.value?.select();
      });
    }
  },
);

const confirm = () => {
  emit("confirm", inputValue.value);
};

const cancel = () => {
  emit("cancel");
};
</script>
