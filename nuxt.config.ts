// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  modules: [
    "@nuxtjs/tailwindcss",
    "@nuxtjs/i18n",
    "@nuxt/icon",
    "@vite-pwa/nuxt",
  ],
  devtools: { enabled: true },
  app: {
    head: {
      link: [
        {
          rel: "icon",
          href: "/favicon.ico",
        },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-touch-icon.png",
        },
      ],
    },
  },
  i18n: {
    baseUrl: "https://web.localsend.org",
    strategy: "prefix_except_default",
    defaultLocale: "en",
    locales: [
      {
        code: "de",
        language: "de-DE",
        file: "de.json",
        name: "Deutsch",
      },
      {
        code: "en",
        language: "en-US",
        file: "en.json",
        name: "English",
        isCatchallLocale: true,
      },
      {
        code: "es",
        language: "es-ES",
        file: "es.json",
        name: "Español",
      },
      {
        code: "km",
        language: "km-KH",
        file: "km.json",
        name: "ភាសាខ្មែរ",
      },
      {
        code: "ko",
        language: "ko-KR",
        file: "ko.json",
        name: "한국어",
      },
      {
        code: "no",
        language: "no-NO",
        file: "no.json",
        name: "Norsk",
      },
      {
        code: "hu",
        language: "hu-HU",
        file: "hu.json",
        name: "Magyar",
      },
      {
        code: "sk",
        language: "sk-SK",
        file: "sk.json",
        name: "Slovenčina",
      },
      {
        code: "tr",
        language: "tr-TR",
        file: "tr.json",
        name: "Türkçe",
      },
      {
        code: "pt",
        language: "pt-BR",
        file: "pt.json",
        name: "Português",
      },
      {
        code: "zh",
        language: "zh-CN",
        file: "zh-cn.json",
        name: "简体中文",
      },
    ],
  },
  nitro: {
    prerender: {
      routes: [ "/" ],
      autoSubfolderIndex: false,
    },
  },
  pwa: {
    enabled: true,
    strategies: 'generateSW',
    registerType: 'autoUpdate',
    manifest: {
      name: 'LocalSend Web',
      short_name: 'LocalSend',
      theme_color: '#111827',
      background_color: '#111827',
      scope: "/",
      id: "localsend",
      start_url: "/?pwa=1",
      icons: [
        {
          src: 'apple-touch-icon.png',
          sizes: '180x180',
          type: 'image/png',
        },
        {
          src: 'logo-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    },
    workbox: {
      globPatterns: [
        '/',
        '**/*.{js,css,html,png,svg,ico}',
      ],
      navigateFallback: '/',
      runtimeCaching: [{
        urlPattern: /^https:\/\/api\.iconify\.design\/.*'/i,
        handler: "CacheFirst",
        options:  {
          cacheName: "icons",
          expiration: {
            maxEntries: 10,
          },
        }
      }],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: true,
      suppressWarnings: true,
      navigateFallback: '/',
      navigateFallbackAllowlist: [/^\/$/],
      type: 'module',
    },
  }
});
