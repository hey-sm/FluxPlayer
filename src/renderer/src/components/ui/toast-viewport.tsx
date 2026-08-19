import { useToast } from '../../stores/toast'
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewportPrimitive } from './toast'

export function ToastViewport(): React.JSX.Element {
  const items = useToast((state) => state.items)
  const dismiss = useToast((state) => state.dismiss)

  return (
    <ToastProvider swipeDirection="right">
      {items.map((item) => (
        <Toast
          key={item.id}
          open
          duration={item.duration}
          tone={item.tone}
          type={item.tone === 'error' ? 'foreground' : 'background'}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id)
          }}
          data-toast-item=""
          data-toast-tone={item.tone}
        >
          <div className="min-w-0 flex-1">
            {item.title ? <ToastTitle>{item.title}</ToastTitle> : null}
            <ToastDescription>{item.message}</ToastDescription>
          </div>
        </Toast>
      ))}
      <ToastViewportPrimitive data-toast-viewport="" />
    </ToastProvider>
  )
}
