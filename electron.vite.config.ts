import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['NeteaseCloudMusicApi', 'electron-updater', 'zod'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@server': resolve('src/server'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        external: ['electron'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
    build: {
      rollupOptions: {
        input: { main: resolve('src/preload/main.ts') },
        // ESM preload 会阻塞页面加载且出错时静默悬死（LOAD_TIMEOUT），一律用 CJS
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
        },
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src'),
      },
    },
    // three-text inlines harfbuzzjs' emscripten glue, whose Node branch references __dirname and
    // whose pattern loader uses `new URL('.', import.meta.url)`. Both are dead code in the Chromium
    // renderer (process.type === 'renderer'), but Vite's static commonjs→ESM translation still trips
    // on the bare __dirname. Defining it to an empty string satisfies the transform harmlessly.
    define: {
      __dirname: '""',
    },
    build: {
      minify: 'oxc',
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})
