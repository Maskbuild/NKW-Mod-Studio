// Renders the NKW logo to build/icon.png (512×512) using Electron's offscreen capture.
// Run: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#0b0b0d"/>
  <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="none" stroke="#2a2a30" stroke-width="0.6"/>
  <path d="M5 20.5v-9l4.2 9v-9M12.4 11.5v9M12.4 17l4.4-5.5M14.2 14.8l2.8 5.7M18.6 11.5l1.7 9 1.9-6.2 1.9 6.2 1.7-9"
    stroke="#fafafa" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  mkdirSync(join(__dirname, '..', 'build'), { recursive: true })
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), img.toPNG())
  app.quit()
})
