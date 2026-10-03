import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const INVOKE = new Set([
  'app:info',
  'settings:get',
  'settings:set',
  'project:create',
  'project:open',
  'project:openRecent',
  'project:forgetRecent',
  'project:save',
  'project:close',
  'project:reveal',
  'assets:list',
  'assets:import',
  'assets:importAny',
  'assets:readModel',
  'assets:animationNames',
  'assets:importPaths',
  'assets:mkdir',
  'assets:move',
  'assets:delete',
  'audio:convert',
  'vanilla:get',
  'vanilla:download',
  'mods:search',
  'mods:importJars',
  'toolchain:status',
  'build:start',
  'assets:writeModel',
  'assets:writeTexture',
  'code:preview',
  'build:stop',
  'build:openFolder',
  'build:clean',
  'shell:openExternal'
])
const EVENTS = new Set(['build:log', 'build:progress', 'build:done', 'vanilla:progress'])

const api = {
  invoke(channel: string, arg?: unknown): Promise<unknown> {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, arg)
  },
  on(channel: string, cb: (payload: unknown) => void): () => void {
    if (!EVENTS.has(channel)) throw new Error(`Blocked event ${channel}`)
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  /** Real path of a file dropped from the OS (File.path no longer exists in sandboxed renderers). */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('nkw', Object.freeze(api))
