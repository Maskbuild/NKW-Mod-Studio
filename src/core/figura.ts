/**
 * Figura avatars made from the skins of a project: one avatar folder per set (skins without a set go into "all"),
 * each with avatar.json, the skin pictures and a small script that puts the skin on the vanilla player model
 * (`renderer:setPrimaryTexture("CUSTOM", …)`) and cycles through the skins with a key.
 */

export interface FiguraSkin {
  id: string
  name: string
  file: string
  openFile: string
  slim: boolean
  set: string
}

export interface FiguraFile {
  /** path inside the avatar folder */
  path: string
  text?: string
  /** a project asset to copy */
  copy?: string
}

export interface FiguraAvatar {
  /** folder name */
  dir: string
  files: FiguraFile[]
}

const safe = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'all'
const lua = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\n/g, ' ')}"`

export function figuraAvatars(skins: FiguraSkin[], mod: { name: string; authors: string }): FiguraAvatar[] {
  const bySet = new Map<string, FiguraSkin[]>()
  for (const s of skins) {
    if (!s.file || !/^[a-z][a-z0-9_]{0,62}$/.test(s.id)) continue
    const key = s.set.trim() || 'all'
    bySet.set(key, [...(bySet.get(key) ?? []), s])
  }
  const used = new Set<string>()
  const out: FiguraAvatar[] = []
  for (const [set, list] of bySet) {
    let dir = safe(set)
    for (let n = 2; used.has(dir); n++) dir = `${safe(set)}_${n}`
    used.add(dir)
    const files: FiguraFile[] = [
      {
        path: 'avatar.json',
        text:
          JSON.stringify(
            {
              name: `${mod.name} - ${set}`,
              description: `Skins of ${mod.name}`,
              authors: mod.authors
                .split(',')
                .map((a) => a.trim())
                .filter(Boolean),
              version: '1.0.0'
            },
            null,
            2
          ) + '\n'
      }
    ]
    for (const s of list) {
      files.push({ path: `skin_${s.id}.png`, copy: s.file })
      if (s.openFile) files.push({ path: `skin_${s.id}_open.png`, copy: s.openFile })
    }
    files.push({
      path: 'script.lua',
      text: `-- Made by NKW Mod Studio: the skins of "${set}". Put this folder in Figura's avatar folder.
local skins = {
${list.map((s) => `  { name = ${lua(s.name)}, texture = "skin_${s.id}"${s.openFile ? `, open = "skin_${s.id}_open"` : ''} }`).join(',\n')}
}
local index = 1
local mouthOpen = false

local function apply()
  local skin = skins[index]
  local name = (mouthOpen and skin.open) or skin.texture
  renderer:setPrimaryTexture("CUSTOM", textures[name])
end

apply()

local next = keybinds:newKeybind("Next skin", "key.keyboard.right.bracket")
next.press = function()
  index = index % #skins + 1
  apply()
end

function events.tick()
  -- the mouth follows Figura's own "is talking" information when it is there
  local talking = player:isLoaded() and player.getVoiceVolume ~= nil and player:getVoiceVolume() > 0
  if talking ~= mouthOpen then
    mouthOpen = talking
    apply()
  end
end
`
    })
    out.push({ dir, files })
  }
  return out
}
