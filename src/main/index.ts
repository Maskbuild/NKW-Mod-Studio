import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, nativeTheme, protocol, session, shell } from 'electron'
import { registerAssetProtocol, registerIpc, stopRunning } from './ipc'
import { SettingsStore } from './services/store'

// Hardening that must happen before `ready`.
app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  { scheme: 'nkw-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))

const TITLEBAR = {
  light: { color: '#fafafa', symbolColor: '#111111' },
  dark: { color: '#0e0e10', symbolColor: '#f5f5f5' }
}

function applyTitleBar() {
  if (!win || process.platform === 'darwin') return
  const t = nativeTheme.shouldUseDarkColors ? TITLEBAR.dark : TITLEBAR.light
  try {
    win.setTitleBarOverlay({ ...t, height: 40 })
  } catch {
    /* overlay unsupported */
  }
}

async function createWindow() {
  const s = await settings.load()
  nativeTheme.themeSource = s.theme
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'NKW Mod Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0e10' : '#fafafa',
    titleBarStyle: 'hidden',
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    titleBarOverlay: { ...(nativeTheme.shouldUseDarkColors ? TITLEBAR.dark : TITLEBAR.light), height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  win.once('ready-to-show', () => win?.show())
  nativeTheme.on('updated', applyTitleBar)

  // No popups or navigation away from the app; https links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (!(dev && url.startsWith(dev))) e.preventDefault()
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())

  registerIpc(win, settings, applyTitleBar)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))

  if (!app.isPackaged && process.env.NKW_CONSOLE) {
    const file = process.env.NKW_CONSOLE
    win.webContents.on('console-message', (e) => void appendFile(file, `[${e.level}] ${e.message}\n`))
  }

  // Development-only visual check: NKW_SHOT=out.png [NKW_SHOT_JS=script] captures the window and quits.
  if (!app.isPackaged && process.env.NKW_SHOT) {
    const shot = process.env.NKW_SHOT
    setTimeout(async () => {
      if (process.env.NKW_SHOT_JS) await win!.webContents.executeJavaScript(process.env.NKW_SHOT_JS).catch(() => undefined)
      await new Promise((r) => setTimeout(r, Number(process.env.NKW_SHOT_WAIT ?? 1500)))
      const img = await win!.webContents.capturePage()
      await writeFile(shot, img.toPNG())
      app.quit()
    }, 1500)
  }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  // Deny every permission request (camera, mic, notifications, …) – the app needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  registerAssetProtocol()
  await createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => stopRunning())
