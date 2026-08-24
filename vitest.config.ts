import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  // renderer 的 JSX 由 @vitejs/plugin-react 处理，但那份配置不作用于 vitest。
  // 组件测试要能编译 TSX，这里必须单独声明自动 JSX 运行时。
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@server': resolve(__dirname, 'src/server'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    // 默认 node 环境：绝大多数单测是纯逻辑。需要 DOM 的用文件顶部的
    // `// @vitest-environment jsdom` 逐个开启，避免整套测试为了少数组件测试变慢。
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
