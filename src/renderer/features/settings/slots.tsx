import { useCallback, useMemo } from 'react'
import type { Preferences } from '@renderer/app/preferences'
import type { FeatureSlots, PreferencesSource } from '@renderer/app/slots'
import { preferencesPatch, settingsToPreferences } from './logic'
import { useSettings, useUpdateSettings } from '@renderer/lib/hooks/useSettings'

/**
 * 테마·언어를 설정 서비스와 잇는다. 시작할 때 저장된 값을 적용하고, 바꾸면 저장하며,
 * 다른 곳에서 설정이 바뀌어도(`settings:changed`) 따라간다. 읽기 전에는 공급자 기본값을 쓴다.
 */
export function useSettingsPreferencesSource(): PreferencesSource | undefined {
  const settings = useSettings()
  const update = useUpdateSettings()
  const current = settings.data
  const onChange = useCallback(
    (next: Preferences) => {
      const patch = preferencesPatch(current, next)
      if (patch) void update(patch)
    },
    [current, update]
  )
  return useMemo(() => {
    const value = settingsToPreferences(current)
    return value ? { value, onChange } : { onChange }
  }, [current, onChange])
}

export const slots: FeatureSlots = {
  usePreferencesSource: useSettingsPreferencesSource
}
