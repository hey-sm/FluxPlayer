import { ErrorBoundary } from './ErrorBoundary'

function reload(): void {
  window.location.reload()
}

/**
 * 根兜底屏。它是「整树渲染失败」与「用户看到全白窗口」之间唯一的东西，因此不依赖
 * 任何应用状态、store、玻璃层或懒加载 chunk —— 只用内联样式，确保连样式表没加载成功
 * 时也能显示出来。
 */
export function AppCrashScreen({ error, retry }: { error: Error; retry: () => void }): React.JSX.Element {
  return (
    <div
      role="alert"
      data-app-crash-screen=""
      style={
        {
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          background: '#111113',
          color: '#f4f4f5',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>FluxPlayer 遇到了问题</h1>
      <p style={{ margin: 0, maxWidth: 480, lineHeight: 1.6, color: '#a1a1aa', fontSize: 13 }}>
        界面渲染失败，播放已中断。可以先重试，若反复出现请重启应用。
      </p>
      <pre
        style={{
          margin: 0,
          maxWidth: 480,
          maxHeight: 160,
          overflow: 'auto',
          padding: '8px 12px',
          borderRadius: 8,
          background: '#1c1c1f',
          color: '#d4d4d8',
          fontSize: 11,
          textAlign: 'left',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {error.message || String(error)}
      </pre>
      <div style={{ display: 'flex', gap: 12, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button type="button" onClick={retry} style={buttonStyle}>
          重试
        </button>
        <button type="button" onClick={reload} style={buttonStyle}>
          重新加载
        </button>
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px solid #3f3f46',
  background: '#27272a',
  color: '#f4f4f5',
  fontSize: 13,
  cursor: 'pointer',
}

/** 根级兜底：整树渲染失败时接管，避免白屏。 */
export function RootErrorBoundary({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ErrorBoundary fallback={(error, retry) => <AppCrashScreen error={error} retry={retry} />}>
      {children}
    </ErrorBoundary>
  )
}
