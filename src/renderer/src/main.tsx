import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { RootErrorBoundary } from './components/AppCrashScreen'
import './styles/shadcn.css'
import './theme/tokens.css'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
})

// ErrorBoundary 只覆盖渲染期异常。事件回调、定时器、未 await 的 promise 里的错误绕过 React，
// 没有这两条监听就完全无声无息 —— 排查线上问题时连一行日志都拿不到。
window.addEventListener('error', (event) => {
  console.error('[FluxPlayer] uncaught error in renderer:', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[FluxPlayer] unhandled rejection in renderer:', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
)
