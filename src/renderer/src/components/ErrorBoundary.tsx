import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 静态兜底 UI，或按错误与重试回调渲染的函数。省略时整棵子树静默降级为空。 */
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode)
  /** 供上层记录/上报；抛错不会影响兜底渲染。 */
  onError?: (error: Error, info: ErrorInfo) => void
  /** 该值变化时自动退出错误态，用于「切换路由/面板后重新尝试」。 */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  error: Error | null
  /** 上一次参与比较的 resetKey，用于在 render 前判断是否该退出错误态。 */
  resetKey: unknown
}

/**
 * 渲染期异常的兜底。没有它时，任何一次渲染抛错或 lazy chunk 加载失败都会让 React
 * 卸载整棵树 —— 用户看到的是全白窗口，且没有任何可操作项。
 *
 * 有意做成局部可复用而不是只在根部放一个：视觉层挂了不该拖垮播放，设置面板挂了
 * 不该拖垮主界面。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, 'error'> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): ErrorBoundaryState | null {
    if (props.resetKey === state.resetKey) return null
    return { error: null, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[FluxPlayer] render error:', error, info.componentStack)
    try {
      this.props.onError?.(error, info)
    } catch {
      // 上报失败不能反过来打断兜底渲染。
    }
  }

  private readonly retry = (): void => this.setState({ error: null, resetKey: this.props.resetKey })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback(error, this.retry)
    return fallback ?? null
  }
}
