import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

declare const process: { env: Record<string, string | undefined> } // avoids a @types/node dependency
// Hosted on GitHub Pages under /langtutor/ (set by the deploy workflow); '/' for local dev and preview.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      // bundle.json (~47MB) lives in IndexedDB after first run; keep it out of the precache
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'], globIgnores: ['data/bundle.json'], navigateFallbackDenylist: [/privacy\.html$/] },
      manifest: {
        name: 'LangTutor',
        short_name: 'LangTutor',
        description: 'Personal Italian learning',
        theme_color: '#14171c',
        background_color: '#14171c',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
