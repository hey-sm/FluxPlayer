// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { AppCrashScreen } from '@renderer/components/AppCrashScreen'

function Boom({ message = '渲染炸了' }: { message?: string }): React.JSX.Element {
  throw new Error(message)
}

afterEach(() => {
  // vitest 未开 globals，testing-library 的自动 cleanup 不会注册，必须显式卸载，
  // 否则上一个用例的 DOM 会残留并让 getBy* 命中多个元素。
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('渲染抛错时不再让整棵子树消失，而是显示兜底内容', () => {
    // React 会把边界捕获的错误再 console.error 一次，静音以免污染测试输出。
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary fallback={<p>已降级</p>}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('已降级')).toBeTruthy()
  })

  it('把错误对象与重试回调交给函数式 fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary fallback={(error) => <p>{error.message}</p>}>
        <Boom message="具体原因" />
      </ErrorBoundary>,
    )

    expect(screen.getByText('具体原因')).toBeTruthy()
  })

  it('调用 onError 上报，且上报本身抛错不影响兜底渲染', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(() => {
      throw new Error('上报通道也挂了')
    })

    render(
      <ErrorBoundary fallback={<p>仍然可见</p>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalled()
    expect(screen.getByText('仍然可见')).toBeTruthy()
  })

  it('resetKey 变化后退出错误态，重新渲染子树', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={<p>已降级</p>}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('已降级')).toBeTruthy()

    rerender(
      <ErrorBoundary resetKey="b" fallback={<p>已降级</p>}>
        <p>恢复正常</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('恢复正常')).toBeTruthy()
  })

  it('没有子树抛错时对渲染毫无影响', () => {
    render(
      <ErrorBoundary fallback={<p>不该出现</p>}>
        <p>正常内容</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('正常内容')).toBeTruthy()
    expect(screen.queryByText('不该出现')).toBeNull()
  })
})

describe('AppCrashScreen', () => {
  it('给出错误信息与两个可操作出口，而不是一片空白', () => {
    const retry = vi.fn()
    render(<AppCrashScreen error={new Error('根节点炸了')} retry={retry} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('根节点炸了')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
  })

  it('重试按钮触发传入的回调', () => {
    const retry = vi.fn()
    render(<AppCrashScreen error={new Error('x')} retry={retry} />)

    screen.getByRole('button', { name: '重试' }).click()

    expect(retry).toHaveBeenCalledOnce()
  })
})
