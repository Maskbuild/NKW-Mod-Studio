import { newModel } from '@core/modelEdit'
import { api } from '../api'
import { useStore } from '../store'
import { useIde } from './ideStore'

/** Creates models/<name>.json (one cube, the first project texture) and opens it in the model editor. */
export async function createModel(folder = 'models'): Promise<void> {
  const s = useStore.getState()
  const taken = new Set(s.assets.map((a) => a.asset))
  let path = `${folder}/model.json`
  for (let i = 2; taken.has(path); i++) path = `${folder}/model_${i}.json`
  const tex = s.assets.find((a) => a.kind === 'texture')?.asset ?? null
  try {
    await api.writeModel(path, newModel(tex ? tex.replace(/\.png$/, '') : null) as Record<string, unknown>)
    await s.refreshAssets()
    useIde.getState().openModel(path)
  } catch (e) {
    s.toast((e as Error).message, true)
  }
}
