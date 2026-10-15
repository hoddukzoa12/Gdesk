import { useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import type { InsecureStorageChoice } from '@shared/domain/session'
import '@shared/ipc/auth'
import { Button } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { useSession } from '@renderer/lib/hooks/useSession'

/**
 * 리눅스에서 키링이 없어 토큰을 안전하게 암호화할 수 없을 때(spec §5) 저장 방법을 고르게 한다.
 * 고를 때까지 닫히지 않는다(고르기 전에는 메인이 토큰을 메모리에만 둔다).
 */
export function StoragePromptDialog() {
  const { t } = useTranslation('auth')
  const session = useSession()
  const [busy, setBusy] = useState(false)
  const open = session?.storagePrompt === 'linux_insecure'

  const choose = async (choice: InsecureStorageChoice): Promise<void> => {
    setBusy(true)
    try {
      await invoke('auth:chooseInsecureStorage', { choice })
    } catch {
      // 실패하면 대화상자가 그대로 남아 다시 고를 수 있다
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[1001] bg-black/50" />
        <AlertDialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          data-testid="storage-prompt"
          className={cn(
            'fixed top-1/2 left-1/2 z-[1001] flex w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4 text-fg shadow-xl'
          )}
        >
          <AlertDialog.Title className="text-[15px] font-semibold">
            {t('storage.title')}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="flex flex-col gap-2 text-[13px] text-fg-muted">
              <p>{t('storage.description')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t('storage.saveExplain')}</li>
                <li>{t('storage.memoryExplain')}</li>
              </ul>
            </div>
          </AlertDialog.Description>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button disabled={busy} onClick={() => void choose('memory')}>
              {t('storage.memory')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void choose('save')}>
              {t('storage.save')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
