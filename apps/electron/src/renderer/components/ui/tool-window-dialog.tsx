import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRegisterModal } from '@/context/ModalContext'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface ToolWindowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Shared in-app window for interactive tools such as Terminal and Browser.
 *
 * Unlike content preview overlays, tool windows keep a fixed viewport so their
 * interactive content can measure and resize against stable dimensions.
 */
export function ToolWindowDialog({
  open,
  onOpenChange,
  title,
  icon,
  children,
  className,
}: ToolWindowDialogProps) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'flex h-[calc(100vh-1rem)] max-h-[780px] w-[calc(100vw-1rem)] max-w-[1200px] flex-col gap-0 overflow-hidden p-0 sm:h-[calc(100vh-4rem)] sm:w-[calc(100vw-4rem)]',
          className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <header className="flex h-10 shrink-0 items-center border-b border-foreground/10 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-foreground/65">
            {icon}
            <span className="truncate">{title}</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
