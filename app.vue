<template>
  <NuxtLayout>
    <NuxtPwaManifest />
    <NuxtPage />
    <div class="absolute flex gap-2" style="top: 20px; right: 20px">
      <ThemeSwitcher />
      <LanguageSwitcher />
    </div>
  </NuxtLayout>
</template>
