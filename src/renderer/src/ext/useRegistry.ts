import { useSyncExternalStore } from 'react'
import { registry } from '@core/ext/registry'

/** Re-renders when nodes, categories or pin types are added or removed (an extension turned on / off). */
export function useRegistryVersion(): number {
  return useSyncExternalStore(registry.subscribe, registry.getVersion)
}
