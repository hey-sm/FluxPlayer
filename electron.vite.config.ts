import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // 打包模型是「全部内联」：electron-builder.yml 的 files 含 '!node_modules/**/*'，
    // 安装包里没有可解析的 node_modules。因此 externalizeDepsPlugin externalize 掉的
    // 任何包（= package.json `dependencies` 里的包）在装机后都会 import 失败，而 pnpm dev
    // 走源码解析永远复现不出来。
    //
    // 不变量：main/preload 只要 import 某个包，它就必须 **不在** `dependencies` 里，
    // 或者显式列进下面的 exclude。exclude 三项正是 node 侧仅有的运行时依赖：
    // zod（'zod/mini'）、electron-updater、NeteaseCloudMusicApi（SDK 门面的 deep import）。
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
