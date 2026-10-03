import { copyFile, rm } from 'node:fs/promises'
import { GameOptionsSchema, optionsEntries } from '@core/gameOptions'
import { ModelControlsSchema } from '@core/modelControls'
import { existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { MetaSchema, ProjectSchema, TargetSchema, newProject, type Project } from '@core/project'
import { NeedsDownloadError, findJdks } from './services/toolchain'
import {
  EXTENSIONS,
  FOLDER_RE,
  animationNames,
  assetsUnder,
  detectKind,
  importAsset,
  listAssets,
  makeFolder,
  moveAsset,
  readModel,
  type AssetKind,
  writeModel,
  writeTexture
} from './services/assets'
import { CONVERTIBLE } from './services/audio'
import { ensureFarmersDelight, ensureVanilla, loadFarmersDelight, loadVanilla, vanillaIconPath, vanillaSkinPath } from './services/vanilla'
import { assetPath, buildDir, findJar, previewFiles, startBuild, type RunningBuild } from './services/builder'
import { createProjectDir, readProject, saveProject, type SettingsStore } from './services/store'
import { TEMPLATE_IDS, applyTemplate } from './templates'

/** The one project the renderer may touch. All paths are resolved relative to it. */
let currentDir: string | null = null
let running: RunningBuild | null = null
/** true from "build:start" until the build runs (or fails to start): stops a double click starting two builds */
let starting = false

const toolsDir = () => (!app.isPackaged && process.env.NKW_TOOLS_DIR ? process.env.NKW_TOOLS_DIR : join(app.getPath('userData'), 'tools'))

/** Stops a running build/game (used when the app quits). */
export function stopRunning() {
  running?.stop()
}

function requireProject(): string {
  if (!currentDir) throw new Error('No project is open')
  return currentDir
}

/**
 * nkw-asset://project/<folder>/<file> → current project's asset (read-only)
 * nkw-asset://vanilla/<mc>/<item>.png → extracted vanilla item icon
 */
export function registerAssetProtocol() {
  protocol.handle('nkw-asset', async (req) => {
    try {
      const url = new URL(req.url)
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      let file: string | null
      if (url.hostname === 'vanilla') {
        const skin = /^(\d+\.\d+(?:\.\d+)?)\/skins\/(steve|alex)\.png$/.exec(rel)
        const m = /^(\d+\.\d+(?:\.\d+)?)\/(?:(farmersdelight)\/)?([a-z0-9_]{1,64})\.png$/.exec(rel)
        file = skin ? vanillaSkinPath(toolsDir(), skin[1], skin[2]) : m ? vanillaIconPath(toolsDir(), m[1], m[3], m[2] ?? 'minecraft') : null
        if (!file) return new Response('Not found', { status: 404 })
      } else file = assetPath(requireProject(), rel)
      const res = await net.fetch(pathToFileURL(file).toString())
      const type = rel.endsWith('.png') ? 'image/png' : rel.endsWith('.ogg') ? 'audio/ogg' : 'application/json'
      return new Response(res.body, {
        headers: { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

type Handler<S extends z.ZodTypeAny> = (arg: z.infer<S>, win: BrowserWindow) => unknown

export function registerIpc(win: BrowserWindow, settings: SettingsStore, onTheme: () => void) {
  const handle = <S extends z.ZodTypeAny>(channel: string, schema: S, fn: Handler<S>) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (e, raw) => {
      // Only accept calls from our own window's main frame.
      if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame) throw new Error('Forbidden')
      const arg = schema.parse(raw)
      return fn(arg, win)
    })
  }
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // ───────── app / settings ─────────
  handle('app:info', z.undefined(), () => ({ version: app.getVersion(), platform: process.platform, electron: process.versions.electron }))
  handle('settings:get', z.undefined(), () => settings.get())
  handle(
    'settings:set',
    z.object({
      theme: z.enum(['system', 'light', 'dark']).optional(),
      language: z.enum(['th', 'en']).optional(),
      memoryMb: z.number().int().min(1024).max(16384).optional(),
      allowDownloads: z.boolean().optional(),
      game: GameOptionsSchema.optional(),
      modelControls: ModelControlsSchema.optional()
    }),
    async (patch) => {
      const s = await settings.update(patch)
      if (patch.theme) {
        nativeTheme.themeSource = patch.theme
        onTheme()
      }
      return s
    }
  )

  // ───────── projects ─────────
  const opened = async (dir: string) => {
    const project = await readProject(dir)
    currentDir = dir
    await settings.touchRecent(dir, project)
    return { dir, project }
  }

  handle(
    'project:create',
    z.object({ meta: MetaSchema, targets: z.array(TargetSchema).min(1).max(32), template: z.enum(TEMPLATE_IDS) }),
    async ({ meta, targets, template }) => {
      const r = await dialog.showOpenDialog(win, {
        title: settings.get().language === 'th' ? 'เลือกโฟลเดอร์สำหรับเก็บโปรเจกต์' : 'Choose where to save the project',
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || !r.filePaths[0]) return null
      let project: Project = newProject(meta, targets)
      const dir = await createProjectDir(r.filePaths[0], meta.name, project)
      project = await applyTemplate(dir, project, template)
      await saveProject(dir, project)
      return opened(dir)
    }
  )
  handle('project:open', z.undefined(), async () => {
    const r = await dialog.showOpenDialog(win, {
      title: settings.get().language === 'th' ? 'เปิดโปรเจกต์ (เลือกไฟล์ project.json)' : 'Open project (select project.json)',
      properties: ['openFile'],
      filters: [{ name: 'NKW project', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0] || basename(r.filePaths[0]) !== 'project.json') return null
    return opened(resolve(r.filePaths[0], '..'))
  })
  handle('project:openRecent', z.object({ dir: z.string().max(1024) }), async ({ dir }) => {
    if (!settings.get().recent.some((r) => r.dir === dir)) throw new Error('Unknown project')
    if (!existsSync(join(dir, 'project.json'))) {
      await settings.forgetRecent(dir)
      throw new Error('Project folder no longer exists')
    }
    return opened(dir)
  })
  handle('project:forgetRecent', z.object({ dir: z.string().max(1024) }), async ({ dir }) => settings.forgetRecent(dir))
  handle('project:save', ProjectSchema, async (project) => {
    const dir = requireProject()
    await saveProject(dir, project)
    await settings.touchRecent(dir, project)
    return true
  })
  handle('project:close', z.undefined(), () => {
    running?.stop()
    currentDir = null
    return true
  })
  handle('project:reveal', z.undefined(), () => shell.openPath(requireProject()))

  // ───────── assets ─────────
  handle('assets:list', z.undefined(), () => listAssets(requireProject()))
  const KIND = z.enum(['texture', 'model', 'geo', 'sound', 'animation'])
  const AUDIO = z.object({ mono: z.boolean(), volume: z.number().min(0.05).max(4) }).default({ mono: true, volume: 1 })
  const FOLDER = z.string().regex(FOLDER_RE).optional()
  // any supported file: type detected from content, audio/video converted to .ogg
  handle('assets:importAny', z.object({ folder: FOLDER, audio: AUDIO }), async ({ folder, audio }) => {
    const dir = requireProject()
    const th = settings.get().language === 'th'
    const all = [...new Set(Object.values(EXTENSIONS).flat())]
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: th ? 'ไฟล์ที่รองรับทั้งหมด' : 'All supported files', extensions: all }]
    })
    if (r.canceled) return { imported: [], errors: [] }
    const out = []
    const errors: string[] = []
    for (const p of r.filePaths.slice(0, 32)) {
      try {
        const k = await detectKind(p)
        if (!k) throw new Error('Unsupported file')
        // keep the chosen folder only when it matches the file's section
        out.push(...(await importAsset(dir, p, k, audio, folder)))
      } catch (e) {
        errors.push(`${basename(p)}: ${(e as Error).message}`)
      }
    }
    return { imported: out, errors }
  })
  handle('assets:import', z.object({ kind: KIND, folder: FOLDER, audio: AUDIO }), async ({ kind, folder, audio }) => {
    const dir = requireProject()
    const th = settings.get().language === 'th'
    const names: Record<AssetKind, string> = th
      ? { texture: 'รูปภาพ PNG', model: 'โมเดล Blockbench', geo: 'โมเดล GeckoLib', sound: 'เสียง/วิดีโอ (แปลงเป็น OGG ให้)', animation: 'อนิเมชัน GeckoLib' }
      : { texture: 'PNG image', model: 'Blockbench model', geo: 'GeckoLib model', sound: 'Audio / video (converted to OGG)', animation: 'GeckoLib animation' }
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: names[kind], extensions: EXTENSIONS[kind] }]
    })
    if (r.canceled) return []
    const out = []
    for (const f of r.filePaths.slice(0, 32)) out.push(...(await importAsset(dir, f, kind, audio, folder)))
    return out
  })
  handle('assets:readModel', z.object({ asset: z.string().max(200) }), ({ asset }) => readModel(requireProject(), asset))
  handle('assets:animationNames', z.object({ asset: z.string().max(200) }), ({ asset }) => animationNames(requireProject(), asset))
  // Files dropped from the OS (paths obtained in preload via webUtils). Type is checked by content.
  handle(
    'assets:importPaths',
    z.object({ paths: z.array(z.string().min(3).max(1024)).max(32), kind: KIND.optional(), folder: FOLDER, audio: AUDIO }),
    async ({ paths, kind, folder, audio }) => {
      const dir = requireProject()
      const out = []
      const errors: string[] = []
      for (const p of paths) {
        try {
          const k = kind ?? (await detectKind(p))
          if (!k) throw new Error('Unsupported file')
          out.push(...(await importAsset(dir, p, k, audio, folder)))
        } catch (e) {
          errors.push(`${basename(p)}: ${(e as Error).message}`)
        }
      }
      return { imported: out, errors }
    }
  )

  // Audio converter: pick audio/video files, convert to .ogg inside the project
  handle('audio:convert', z.object({ folder: FOLDER, audio: AUDIO }), async ({ folder, audio }) => {
    const dir = requireProject()
    const th = settings.get().language === 'th'
    const r = await dialog.showOpenDialog(win, {
      title: th ? 'เลือกไฟล์เสียงหรือวิดีโอที่จะแปลงเป็น OGG' : 'Choose audio or video files to convert to OGG',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: th ? 'เสียง / วิดีโอ' : 'Audio / video', extensions: CONVERTIBLE }]
    })
    if (r.canceled) return { imported: [], errors: [] }
    const out = []
    const errors: string[] = []
    for (const p of r.filePaths.slice(0, 32)) {
      try {
        out.push(...(await importAsset(dir, p, 'sound', audio, folder)))
      } catch (e) {
        errors.push(`${basename(p)}: ${(e as Error).message}`)
      }
    }
    return { imported: out, errors }
  })

  // ───────── asset tree: folders, rename, move, delete ─────────
  const PATH = z.string().min(3).max(300)
  handle('assets:writeModel', z.object({ asset: PATH, model: z.record(z.string(), z.unknown()) }), ({ asset, model }) =>
    writeModel(requireProject(), asset, model)
  )
  handle('assets:writeTexture', z.object({ asset: PATH, png: z.string().max(11_000_000) }), ({ asset, png }) => writeTexture(requireProject(), asset, png))
  handle('assets:mkdir', z.object({ folder: PATH }), ({ folder }) => makeFolder(requireProject(), folder))
  handle('assets:move', z.object({ from: PATH, to: PATH }), ({ from, to }) => moveAsset(requireProject(), from, to))
  handle('assets:delete', z.object({ path: PATH }), async ({ path }) => {
    const dir = requireProject()
    const gone = await assetsUnder(dir, path)
    // to the Recycle Bin / Trash, never a permanent delete
    await shell.trashItem(join(dir, 'assets', ...path.split('/')))
    return gone
  })

  // ───────── vanilla items ─────────
  const VSRC = z.object({ mc: z.string().regex(/^\d+\.\d+(\.\d+)?$/), source: z.enum(['minecraft', 'farmersdelight']).default('minecraft') })
  handle('vanilla:get', VSRC, ({ mc, source }) => (source === 'farmersdelight' ? loadFarmersDelight(toolsDir(), mc) : loadVanilla(toolsDir(), mc)))
  handle('vanilla:download', VSRC, ({ mc, source }) => {
    const progress = (msg: string, done?: number, total?: number) => send('vanilla:progress', { mc, source, msg, done, total })
    return source === 'farmersdelight' ? ensureFarmersDelight(toolsDir(), mc, progress) : ensureVanilla(toolsDir(), mc, progress)
  })

  // ───────── build / run ─────────
  handle('toolchain:status', z.undefined(), async () => {
    const jdks = await findJdks(toolsDir())
    return { jdks: jdks.map((j) => ({ major: j.major, home: j.home, managed: j.managed })), toolsDir: toolsDir() }
  })

  handle('code:preview', z.object({ project: ProjectSchema, target: TargetSchema }), ({ project, target }) => previewFiles(requireProject(), project, target))
  handle(
    'build:start',
    z.object({ project: ProjectSchema, target: TargetSchema, task: z.enum(['runClient', 'build', 'compileJava']) }),
    async ({ project, target, task }) => {
      const dir = requireProject()
      if (running || starting) throw new Error('A build is already running')
      starting = true
      try {
        return await startRun(dir, project, target, task)
      } finally {
        starting = false
      }
    }
  )
  const startRun = async (dir: string, project: Project, target: z.infer<typeof TargetSchema>, task: 'runClient' | 'build' | 'compileJava') => {
    await saveProject(dir, project)
    const th = settings.get().language === 'th'
    let allowDownload = settings.get().allowDownloads
    let buf: string[] = []
    const flush = setInterval(() => {
      if (buf.length) {
        send('build:log', buf)
        buf = []
      }
    }, 80)
    const log = (line: string) => {
      buf.push(line)
      if (buf.length > 500) {
        send('build:log', buf)
        buf = []
      }
    }
    const progress = (msg: string, done?: number, total?: number) => send('build:progress', { msg, done, total })

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        running = await startBuild({
          projectDir: dir,
          project,
          target,
          toolsDir: toolsDir(),
          allowDownload,
          task,
          log,
          progress,
          memoryMb: settings.get().memoryMb,
          gameOptions: optionsEntries(settings.get().game, settings.get().language)
        })
        break
      } catch (e) {
        if (e instanceof NeedsDownloadError && !allowDownload) {
          const what = e.what === 'jdk' ? `Java ${e.version} (Eclipse Temurin, ~200 MB)` : `Gradle ${e.version} (~140 MB)`
          const r = await dialog.showMessageBox(win, {
            type: 'question',
            buttons: th ? ['ดาวน์โหลด', 'ดาวน์โหลดเสมอ', 'ยกเลิก'] : ['Download', 'Always download', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            title: th ? 'ต้องดาวน์โหลดเครื่องมือ' : 'Tools required',
            message: th ? `ต้องใช้ ${what} เพื่อทดสอบม็อดนี้` : `${what} is required to test this mod.`,
            detail: th
              ? 'ดาวน์โหลดจากแหล่งทางการ ตรวจสอบ checksum และเก็บไว้ในโฟลเดอร์ของแอป'
              : 'It is downloaded from the official source, checksum-verified and stored in the app folder.'
          })
          if (r.response === 2) {
            clearInterval(flush)
            send('build:done', { code: -1, cancelled: true })
            return false
          }
          allowDownload = true
          if (r.response === 1) await settings.update({ allowDownloads: true })
          continue
        }
        clearInterval(flush)
        throw e
      }
    }
    const run = running
    if (!run) {
      clearInterval(flush)
      return false
    }
    void run.done.then(async (code) => {
      clearInterval(flush)
      if (buf.length) send('build:log', buf)
      buf = []
      running = null
      let jar: string | null = null
      if (task === 'build' && code === 0) jar = await findJar(run.outDir)
      send('build:done', { code, jar: jar ? basename(jar) : null })
      if (jar) {
        const r = await dialog.showSaveDialog(win, {
          title: th ? 'บันทึกไฟล์ม็อด (.jar)' : 'Save mod file (.jar)',
          defaultPath: basename(jar),
          filters: [{ name: 'Minecraft mod', extensions: ['jar'] }]
        })
        if (!r.canceled && r.filePath && extname(r.filePath).toLowerCase() === '.jar') {
          try {
            await copyFile(jar, r.filePath)
            shell.showItemInFolder(r.filePath)
          } catch (e) {
            dialog.showErrorBox(th ? 'บันทึกไฟล์ม็อดไม่สำเร็จ' : 'Could not save the mod file', (e as Error).message)
          }
        }
      }
    })
    return true
  }
  handle('build:stop', z.undefined(), () => {
    running?.stop()
    return true
  })
  handle('build:clean', TargetSchema, async (t) => {
    if (running) throw new Error('Stop the running build first')
    await rm(buildDir(requireProject(), t), { recursive: true, force: true })
    return true
  })
  handle('build:openFolder', TargetSchema, async (t) => {
    const d = buildDir(requireProject(), t)
    if (existsSync(d)) await shell.openPath(d)
    return true
  })
  handle('shell:openExternal', z.object({ url: z.string().url() }), async ({ url }) => {
    const allowed = [
      'https://www.blockbench.net',
      'https://blockbench.net',
      'https://modrinth.com',
      'https://github.com',
      'https://audacityteam.org',
      'https://www.audacityteam.org'
    ]
    if (allowed.some((a) => url === a || url.startsWith(a + '/'))) await shell.openExternal(url)
    return true
  })
}
