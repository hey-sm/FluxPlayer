import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@server': resolve('src/server'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        // 显式 external 会覆盖 electron-vite 默认列表：electron 必须带上；
        // NCM 运行时会用 fs 扫描自身 module 目录，必须保持外部依赖，不能内联
        external: ['electron', 'NeteaseCloudMusicApi', 'koffi', 'electron-updater'],
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
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src'),
      },
    },
    server: {
      // 开发模式下本地 API 服务固定从 43110 起找空闲端口；主进程会把实际端口
      // 通过 preload 暴露，renderer 优先用相对路径 + vite 代理。
      proxy: {
        '/api': { target: 'http://127.0.0.1:43110', changeOrigin: false },
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})
