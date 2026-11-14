import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Для GitHub Pages сборка идёт с базой /yadisk-photo-ai/,
// для APK — с базой / (см. script build:android).
export default defineConfig({
  base: '/yadisk-photo-ai/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Диск Фото AI',
        short_name: 'ДискФото',
        description:
          'ИИ-поиск фотографий по описанию на Яндекс Диске, сортировка по папкам и группировка лиц, животных и сюжетов.',
        lang: 'ru',
        dir: 'ltr',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        categories: ['photo', 'utilities', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdn\.)?(huggingface\.co|hf\.co)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'hf-models',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Ядро и worker Tesseract (распознавание текста) — качаются один раз.
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|tessdata\.projectnaptha\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\/models\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-models',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\/assets\/.*\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnx-wasm',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
