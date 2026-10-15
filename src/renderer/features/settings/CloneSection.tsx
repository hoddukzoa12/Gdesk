import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CLONE_PROTOCOLS, type Settings, type SettingsPatch } from '@shared/domain/settings'
import '@shared/ipc/dialog'
import '@shared/ipc/local'
import { Button } from '@renderer/components'
import { invoke, useIpcQuery } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { editorOptions, editorPatch } from './logic'
import { Segmented, SettingRow, SettingsSection } from './ui'

/** 클론: 기본 클론 폴더, 클론 주소(HTTPS/SSH), 기본 편집기. */
export function CloneSection({
  settings,
  save
}: {
  settings: Settings | undefined
  save: (patch: SettingsPatch) => void
}) {
  const { t } = useTranslation('settings')
  const editors = useIpcQuery('local:listEditors')

  const chooseFolder = async (): Promise<void> => {
    const result = await invoke(
      'dialog:chooseFolder',
      settings?.cloneBaseDir ? { defaultPath: settings.cloneBaseDir } : {}
    )
    if (result.path) save({ cloneBaseDir: result.path })
  }

  const options = editorOptions(editors.data ?? [], settings?.defaultEditor ?? null)
  const noEditors = editors.isSuccess && editors.data.length === 0

  return (
    <SettingsSection id="clone" title={t('clone.title')}>
      <SettingRow label={t('clone.folder')} hint={t('clone.folderHint')}>
        <span
          className="max-w-[320px] truncate font-mono text-xs text-fg-muted"
          title={settings?.cloneBaseDir}
          data-testid="settings-clone-dir"
        >
          {settings?.cloneBaseDir ?? ''}
        </span>
        <Button
          size="sm"
          disabled={!settings}
          onClick={() => void chooseFolder()}
          data-testid="settings-clone-dir-change"
        >
          <FolderOpen aria-hidden />
          {t('clone.change')}
        </Button>
      </SettingRow>
      <SettingRow
        label={t('clone.protocol')}
        hint={t('clone.protocolHint')}
        labelId="settings-protocol-label"
      >
        <Segmented
          value={settings?.cloneProtocol}
          options={CLONE_PROTOCOLS.map((value) => ({
            value,
            label: t(`clone.protocols.${value}`)
          }))}
          onChange={(cloneProtocol) => save({ cloneProtocol })}
          labelledBy="settings-protocol-label"
          testIdPrefix="settings-protocol"
        />
      </SettingRow>
      <SettingRow
        label={t('clone.editor')}
        hint={
          noEditors
            ? t('clone.noEditors')
            : editors.isPending
              ? t('clone.editorsLoading')
              : undefined
        }
        labelId="settings-editor-label"
      >
        <select
          aria-labelledby="settings-editor-label"
          data-testid="settings-editor"
          disabled={!settings}
          value={settings?.defaultEditor ?? ''}
          onChange={(e) => save(editorPatch(e.target.value))}
          className={cn(
            'h-7 max-w-[240px] rounded-md border border-border bg-bg-subtle px-2 text-[13px] text-fg',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.kind === 'none'
                ? t('clone.editorNone')
                : opt.kind === 'missing'
                  ? t('clone.editorMissing', { name: opt.label })
                  : opt.label}
            </option>
          ))}
        </select>
      </SettingRow>
    </SettingsSection>
  )
}
