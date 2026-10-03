import { z } from 'zod'
import type { L10n } from './nodes/defs'

/**
 * Minecraft settings for test runs ("Test in game"), written into the run folder's options.txt before
 * the game starts. Keys not set here keep whatever the game saved last time.
 */

/** Minecraft key names (options.txt), e.g. key.keyboard.w, key.mouse.left */
const MC_KEY_RE = /^key\.(keyboard|mouse)\.[a-z0-9.]{1,24}$/

export const GameOptionsSchema = z.object({
  fullscreen: z.boolean().default(false),
  /** window size (ignored in fullscreen) */
  width: z.number().int().min(320).max(7680).default(1280),
  height: z.number().int().min(240).max(4320).default(720),
  /** 260 = unlimited */
  maxFps: z.number().int().min(10).max(260).default(120),
  vsync: z.boolean().default(false),
  /** 0 = auto */
  guiScale: z.number().int().min(0).max(6).default(0),
  renderDistance: z.number().int().min(2).max(32).default(8),
  /** master volume 0–1 */
  volume: z.number().min(0).max(1).default(1),
  /** brightness 0 (moody) – 1 (bright) */
  brightness: z.number().min(0).max(1).default(0.5),
  /** mouse sensitivity 0–1 (0.5 = 100 %) */
  sensitivity: z.number().min(0).max(1).default(0.5),
  /** game language: follow the app, or a fixed one */
  language: z.enum(['app', 'en_us', 'th_th']).default('app'),
  /** keep running when the game window loses focus (handy while switching back to the app) */
  pauseOnLostFocus: z.boolean().default(false),
  /** key bindings that differ from the defaults: action (e.g. key.jump) → key name */
  keys: z.record(z.string().regex(/^key\.[a-zA-Z.]{1,40}$/), z.string().regex(MC_KEY_RE)).default({})
})
export type GameOptions = z.infer<typeof GameOptionsSchema>

const t = (en: string, th: string): L10n => ({ en, th })

/** The key bindings offered in Settings, with Minecraft's defaults. */
export const KEY_ACTIONS: { id: string; label: L10n; def: string }[] = [
  { id: 'key.forward', label: t('Walk forward', 'เดินหน้า'), def: 'key.keyboard.w' },
  { id: 'key.left', label: t('Strafe left', 'เดินซ้าย'), def: 'key.keyboard.a' },
  { id: 'key.back', label: t('Walk backward', 'ถอยหลัง'), def: 'key.keyboard.s' },
  { id: 'key.right', label: t('Strafe right', 'เดินขวา'), def: 'key.keyboard.d' },
  { id: 'key.jump', label: t('Jump', 'กระโดด'), def: 'key.keyboard.space' },
  { id: 'key.sneak', label: t('Sneak', 'ย่อ'), def: 'key.keyboard.left.shift' },
  { id: 'key.sprint', label: t('Sprint', 'วิ่ง'), def: 'key.keyboard.left.control' },
  { id: 'key.attack', label: t('Attack / destroy', 'โจมตี / ทุบ'), def: 'key.mouse.left' },
  { id: 'key.use', label: t('Use item / place block', 'ใช้ไอเทม / วางบล็อก'), def: 'key.mouse.right' },
  { id: 'key.pickItem', label: t('Pick block', 'เลือกบล็อก'), def: 'key.mouse.middle' },
  { id: 'key.inventory', label: t('Inventory', 'ช่องเก็บของ'), def: 'key.keyboard.e' },
  { id: 'key.drop', label: t('Drop item', 'ทิ้งไอเทม'), def: 'key.keyboard.q' },
  { id: 'key.swapOffhand', label: t('Swap item to off hand', 'สลับไอเทมไปมือรอง'), def: 'key.keyboard.f' },
  { id: 'key.chat', label: t('Open chat', 'เปิดแชท'), def: 'key.keyboard.t' },
  { id: 'key.command', label: t('Open command', 'พิมพ์คำสั่ง'), def: 'key.keyboard.slash' },
  { id: 'key.playerlist', label: t('List players', 'รายชื่อผู้เล่น'), def: 'key.keyboard.tab' },
  { id: 'key.togglePerspective', label: t('Toggle perspective', 'สลับมุมกล้อง'), def: 'key.keyboard.f5' },
  { id: 'key.screenshot', label: t('Take screenshot', 'ถ่ายภาพหน้าจอ'), def: 'key.keyboard.f2' },
  { id: 'key.fullscreen', label: t('Toggle fullscreen', 'สลับเต็มจอ'), def: 'key.keyboard.f11' }
]

const NAMED: Record<string, string> = {
  Space: 'space',
  ShiftLeft: 'left.shift',
  ShiftRight: 'right.shift',
  ControlLeft: 'left.control',
  ControlRight: 'right.control',
  AltLeft: 'left.alt',
  AltRight: 'right.alt',
  Tab: 'tab',
  Enter: 'enter',
  Backspace: 'backspace',
  CapsLock: 'caps.lock',
  Escape: 'escape',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Insert: 'insert',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'page.up',
  PageDown: 'page.down',
  Slash: 'slash',
  Backslash: 'backslash',
  Backquote: 'grave.accent',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'left.bracket',
  BracketRight: 'right.bracket',
  Semicolon: 'semicolon',
  Quote: 'apostrophe',
  Comma: 'comma',
  Period: 'period'
}

/** Minecraft key name for a browser KeyboardEvent.code, or null when Minecraft has no such key. */
export function mcKeyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return `key.keyboard.${m[1].toLowerCase()}`
  m = /^Digit([0-9])$/.exec(code)
  if (m) return `key.keyboard.${m[1]}`
  m = /^F([1-9]|1[0-2])$/.exec(code)
  if (m) return `key.keyboard.f${m[1]}`
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `key.keyboard.keypad.${m[1]}`
  return NAMED[code] ? `key.keyboard.${NAMED[code]}` : null
}

/** Minecraft key name for a mouse button (MouseEvent.button). */
export function mcKeyFromMouse(button: number): string {
  return ['key.mouse.left', 'key.mouse.middle', 'key.mouse.right', 'key.mouse.4', 'key.mouse.5'][button] ?? `key.mouse.${button + 1}`
}

/** Short label for a key name: key.keyboard.left.shift → "Left Shift", key.mouse.left → "Left Click". */
export function keyLabel(key: string): string {
  const mouse = /^key\.mouse\.(.+)$/.exec(key)
  if (mouse) return { left: 'Left Click', right: 'Right Click', middle: 'Middle Click' }[mouse[1]] ?? `Mouse ${mouse[1]}`
  const name = key.replace(/^key\.keyboard\./, '')
  return name
    .split('.')
    .map((w) => (w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

/** options.txt entries for these settings. */
export function optionsEntries(o: GameOptions, appLanguage: 'th' | 'en'): Record<string, string> {
  const n = (x: number) => String(Math.round(x * 100) / 100)
  const out: Record<string, string> = {
    fullscreen: String(o.fullscreen),
    overrideWidth: String(o.width),
    overrideHeight: String(o.height),
    maxFps: String(o.maxFps),
    enableVsync: String(o.vsync),
    guiScale: String(o.guiScale),
    renderDistance: String(o.renderDistance),
    soundCategory_master: n(o.volume),
    gamma: n(o.brightness),
    mouseSensitivity: n(o.sensitivity),
    lang: o.language === 'app' ? (appLanguage === 'th' ? 'th_th' : 'en_us') : o.language,
    pauseOnLostFocus: String(o.pauseOnLostFocus)
  }
  for (const a of KEY_ACTIONS) out[`key_${a.id}`] = o.keys[a.id] ?? a.def
  return out
}

/** Merges entries into the text of an existing options.txt (keeps every other line). */
export function mergeOptionsTxt(existing: string, entries: Record<string, string>): string {
  const left = { ...entries }
  const lines = existing
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const k = l.slice(0, l.indexOf(':'))
      if (k in left) {
        const v = left[k]
        delete left[k]
        return `${k}:${v}`
      }
      return l
    })
  for (const [k, v] of Object.entries(left)) lines.push(`${k}:${v}`)
  return lines.join('\n') + '\n'
}
