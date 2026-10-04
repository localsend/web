<template>
  <div
    class="flex py-2 text-white drop-shadow-lg rounded-lg bg-teal-700 hover:bg-teal-600 cursor-pointer"
  >
    <div class="flex items-center justify-center px-2">
      <Icon :name="iconName" class="size-10" />
    </div>
    <div class="flex-1">
      <p class="text-xl">{{ props.peer.alias }}</p>
      <p class="text-xs mt-1 mb-1">
        <span class="bg-teal-900 px-1 py-0.5 rounded">{{
          props.peer.deviceModel ?? "Unknown"
        }}</span>
        <span class="ml-2 bg-teal-900 px-1 py-0.5 rounded">WebRTC</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type ClientInfo, PeerDeviceType } from "@/services/signaling";

const props = defineProps<{
  peer: ClientInfo;
}>();

const iconName = computed(() => {
  switch (props.peer.deviceType) {
    case PeerDeviceType.mobile:
      return "material-symbols:smartphone";
    case PeerDeviceType.desktop:
      return "material-symbols:computer";
    case PeerDeviceType.web:
      return "material-symbols:language";
    case PeerDeviceType.headless:
      return "material-symbols:terminal";
    case PeerDeviceType.server:
      return "material-symbols:dns";
    default:
      return "material-symbols:help";
  }
});
</script>
