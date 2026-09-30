import type { BlockIR, ItemIR, ModelRef } from '../ir'
import { armorIconModel, fitAnimation, geoLoopName, javaModelToGeo, prepareArmorGeo, type GeoFile } from './geo'
import { textureKeys, type JavaModel } from './model'
import { parseJavaModel, remapTextures } from './model'
import { RES, fabricLike, json, type GenCtx } from './types'

/** Resource-pack side: models, blockstates, textures, lang, sounds. */
export function genAssets(ctx: GenCtx): void {
  const { ir, ns, p, files } = ctx
  const A = `${RES}/assets/${ns}`
  const copied = new Set<string>()

  const tex = (asset: string, folder: string, name: string, namespace = ns): string => {
    const path = `${RES}/assets/${namespace}/textures/${folder}/${name}.png`
    if (!copied.has(path)) {
      copied.add(path)
      files.push({ path, copy: asset })
      const anim = ir.textureAnims[asset]
      if (anim) files.push({ path: `${path}.mcmeta`, text: json({ animation: { frametime: anim.frametime, interpolate: anim.interpolate } }) })
    }
    return `${namespace}:${folder}/${name}`
  }

  const renderType = !fabricLike(ctx.loader) && p.modelRenderType ? 'minecraft:cutout' : undefined

  const modelFile = (ref: ModelRef, folder: 'item' | 'block', id: string, withRenderType: boolean): unknown => {
    const model = parseJavaModel(ctx.read.readText(ref.asset))
    const refs = ref.textures.map((t, i) => (t ? tex(t, folder, `${id}_${i}`) : '')).filter(Boolean)
    return remapTextures(model, refs, withRenderType ? renderType : undefined)
  }

  const itemDefinition = (id: string, model: string) => {
    if (p.itemDefinitions) files.push({ path: `${A}/items/${id}.json`, text: json({ model: { type: 'minecraft:model', model } }) })
  }

  // ── items ──
  const flat = (texture: string | null, id: string, handheld: boolean) => ({
    parent: handheld ? 'minecraft:item/handheld' : 'minecraft:item/generated',
    textures: { layer0: texture ? tex(texture, 'item', id) : 'minecraft:item/barrier' }
  })
  for (const it of ir.items) {
    const handheld = it.handheld || it.kind === 'tool'
    const iconOnly = it.separateIcon ? separateIconMode(ctx) : null
    if (it.model && iconOnly) {
      // 3D model in hand, the texture as the inventory icon
      const model3d = modelFile(it.model, 'item', it.id, false)
      files.push({ path: `${A}/models/item/${it.id}_icon.json`, text: json(flat(it.texture, it.id, handheld)) })
      if (iconOnly === 'itemDefinition') {
        files.push({ path: `${A}/models/item/${it.id}.json`, text: json(model3d) })
        files.push({
          path: `${A}/items/${it.id}.json`,
          text: json({
            model: {
              type: 'minecraft:select',
              property: 'minecraft:display_context',
              cases: [{ when: ['gui', 'ground', 'fixed'], model: { type: 'minecraft:model', model: `${ns}:item/${it.id}_icon` } }],
              fallback: { type: 'minecraft:model', model: `${ns}:item/${it.id}` }
            }
          })
        })
      } else {
        files.push({ path: `${A}/models/item/${it.id}_3d.json`, text: json(model3d) })
        const icon = { parent: `${ns}:item/${it.id}_icon` }
        files.push({
          path: `${A}/models/item/${it.id}.json`,
          text: json({ loader: iconOnly, base: { parent: `${ns}:item/${it.id}_3d` }, perspectives: { gui: icon, ground: icon, fixed: icon } })
        })
      }
      continue
    }
    // armor piece shown as its 3D model (converted from the GeckoLib model)
    const geo = it.geoIcon ? it.armor?.geo : null
    if (geo) {
      let icon: unknown = null
      try {
        icon = armorIconModel(JSON.parse(ctx.read.readText(geo.asset)) as GeoFile, it.armor!.slot, tex(geo.texture, 'item/armor', ctx.geoNames.get(it.id) ?? it.id))
      } catch {
        icon = null
      }
      files.push({ path: `${A}/models/item/${it.id}.json`, text: json(icon ?? flat(it.texture, it.id, handheld)) })
      itemDefinition(it.id, `${ns}:item/${it.id}`)
      continue
    }
    const modelJson = it.model ? modelFile(it.model, 'item', it.id, false) : flat(it.texture, it.id, handheld)
    files.push({ path: `${A}/models/item/${it.id}.json`, text: json(modelJson) })
    itemDefinition(it.id, `${ns}:item/${it.id}`)
  }
  // hidden items that carry a creative tab's logo
  for (const t of ir.tabs) {
    if (!t.logo || t.icon) continue
    const id = `${t.id}_tab_icon`
    files.push({ path: `${A}/models/item/${id}.json`, text: json(flat(t.logo, id, false)) })
    itemDefinition(id, `${ns}:item/${id}`)
  }

  // ── blocks ──
  for (const b of ir.blocks) genBlock(ctx, b, tex, modelFile)
  for (const b of ir.blocks) if (b.hasItem) itemDefinition(b.id, `${ns}:block/${b.id}`)

  // ── armor textures ──
  for (const m of ir.armorMats) {
    if (!m.layer1 || !m.layer2) continue
    switch (p.armorApi) {
      case 'slot':
      case 'type':
        // vanilla resolves "<name>_layer_N" in the minecraft namespace; name is prefixed with the mod id
        tex(m.layer1, 'models/armor', `${ns}_${m.id}_layer_1`, 'minecraft')
        tex(m.layer2, 'models/armor', `${ns}_${m.id}_layer_2`, 'minecraft')
        break
      case 'holder':
        tex(m.layer1, 'models/armor', `${m.id}_layer_1`)
        tex(m.layer2, 'models/armor', `${m.id}_layer_2`)
        break
      case 'equipment':
        tex(m.layer1, 'entity/equipment/humanoid', m.id)
        tex(m.layer2, 'entity/equipment/humanoid_leggings', m.id)
        files.push({
          path: `${A}/equipment/${m.id}.json`,
          text: json({ layers: { humanoid: [{ texture: `${ns}:${m.id}` }], humanoid_leggings: [{ texture: `${ns}:${m.id}` }] } })
        })
        break
    }
  }

  // ── GeckoLib armor models ──
  if (ctx.gecko) {
    const done = new Set<string>()
    for (const it of ir.items) {
      const g = it.armor?.geo
      if (!g) continue
      const set = ctx.geoNames.get(it.id)!
      if (done.has(set)) continue
      done.add(set)
      // the model as worn: attached to the slot's bones (plain Blockbench models) and fitted
      const slot = it.armor!.slot
      let model: GeoFile | null = null
      try {
        const raw = JSON.parse(ctx.read.readText(g.asset))
        model = g.java ? javaModelToGeo(raw as JavaModel, textureKeys(raw as JavaModel), g.java.textures.length, `geometry.${set}`) : (raw as GeoFile)
      } catch {
        model = null
      }
      if (model) files.push({ path: `${A}/geo/item/armor/${set}.geo.json`, text: json(prepareArmorGeo(model, slot, g.fit)) })
      else files.push({ path: `${A}/geo/item/armor/${set}.geo.json`, copy: g.asset })
      if (g.java && g.java.textures.length > 1) files.push({ path: `${A}/textures/item/armor/${set}.png`, atlas: g.java.textures })
      else tex(g.texture, 'item/armor', set)
      const animPath = `${A}/animations/item/armor/${set}.animation.json`
      const scaled = !!g.fit && g.fit.scale.some((v) => v !== 1)
      if (scaled) {
        let anim = null
        try {
          anim = g.animation ? JSON.parse(ctx.read.readText(g.animation.asset)) : null
        } catch {
          anim = null
        }
        files.push({ path: animPath, text: json(fitAnimation(anim, geoLoopName(g.animation, g.fit), slot, g.fit!).file) })
      } else if (g.animation) files.push({ path: animPath, copy: g.animation.asset })
      else files.push({ path: animPath, text: json({ format_version: '1.8.0', animations: {}, geckolib_format_version: 2 }) })
    }
  }

  // ── sounds ──
  if (ir.sounds.length) {
    const sj: Record<string, unknown> = {}
    for (const s of ir.sounds) {
      sj[s.id] = {
        sounds: s.files.map((f, i) => {
          const name = `${s.id}_${i}`
          files.push({ path: `${A}/sounds/${name}.ogg`, copy: f })
          const entry: Record<string, unknown> = { name: `${ns}:${name}` }
          if (s.stream) entry.stream = true
          if (s.volume !== 1) entry.volume = s.volume
          if (s.pitch !== 1) entry.pitch = s.pitch
          // jukeboxes play at volume 4, so hearing range = max(4 × volume, 1) × attenuation_distance (default 16 → 64 blocks)
          const range = Math.max(0, ...ir.items.filter((it) => it.disc?.sound === s.id).map((it) => it.disc!.range))
          if (range && range !== 64) entry.attenuation_distance = Math.max(1, Math.round(range / Math.max(4 * s.volume, 1)))
          return Object.keys(entry).length === 1 ? entry.name : entry
        }),
        ...(s.subtitle || s.subtitleTh ? { subtitle: `subtitles.${ns}.${s.id}` } : {})
      }
    }
    files.push({ path: `${A}/sounds.json`, text: json(sj) })
  }

  // ── lang ──
  const en: Record<string, string> = {}
  const th: Record<string, string> = {}
  const put = (k: string, e: string, t: string) => {
    en[k] = e
    th[k] = t || e
  }
  for (const it of ir.items) {
    put(`item.${ns}.${it.id}`, it.name, it.nameTh)
    if (it.disc) {
      const cr = COPYRIGHT[it.disc.copyright]
      const song = cr ? `${it.disc.song} (${cr.en})` : it.disc.song
      const songTh = cr ? `${it.disc.songTh || it.disc.song} (${cr.th})` : it.disc.songTh
      if (p.jukeboxSongs) put(`jukebox_song.${ns}.${it.id}`, song, songTh)
      else put(`item.${ns}.${it.id}.desc`, song, songTh)
    }
  }
  for (const b of ir.blocks) {
    put(`block.${ns}.${b.id}`, b.name, b.nameTh)
    put(`item.${ns}.${b.id}`, b.name, b.nameTh)
  }
  for (const s of ir.sounds) if (s.subtitle || s.subtitleTh) put(`subtitles.${ns}.${s.id}`, s.subtitle || s.id, s.subtitleTh)
  for (const t of ir.tabs) {
    put(`itemGroup.${ns}.${t.id}`, t.title, t.titleTh)
    put(`itemGroup.${ns}_${t.id}`, t.title, t.titleTh)
    if (t.logo && !t.icon) put(`item.${ns}.${t.id}_tab_icon`, t.title, t.titleTh)
  }
  files.push({ path: `${A}/lang/en_us.json`, text: json(en) })
  files.push({ path: `${A}/lang/th_th.json`, text: json(th) })
}


const COPYRIGHT: Record<string, { en: string; th: string } | undefined> = {
  free: { en: 'Copyright-free', th: 'ไม่มีลิขสิทธิ์' },
  licensed: { en: 'Used with permission', th: 'ได้รับอนุญาตแล้ว' },
  copyrighted: { en: 'Copyrighted', th: 'มีลิขสิทธิ์' }
}

/**
 * How a 3D item can show a separate 2D inventory icon on this target, or null when it can't
 * (then the 3D model is used everywhere).
 */
export function separateIconMode(ctx: Pick<GenCtx, 'p' | 'loader'>): 'itemDefinition' | 'forge:separate_transforms' | 'neoforge:separate_transforms' | null {
  if (ctx.p.itemDefinitions) return 'itemDefinition'
  if (ctx.loader === 'neoforge') return 'neoforge:separate_transforms'
  if (ctx.loader === 'forge' && ctx.p.modelRenderType) return 'forge:separate_transforms'
  return null
}

function genBlock(
  ctx: GenCtx,
  b: BlockIR,
  tex: (asset: string, folder: string, name: string) => string,
  modelFile: (ref: ModelRef, folder: 'item' | 'block', id: string, rt: boolean) => unknown
): void {
  const { ns, files } = ctx
  const A = `${RES}/assets/${ns}`
  const model = `${ns}:block/${b.id}`
  let modelJson: unknown
  let states: unknown = { variants: { '': { model } } }

  if (b.kind === 'model' && b.model) {
    modelJson = modelFile(b.model, 'block', b.id, true)
    if (b.rotatable)
      states = {
        variants: {
          'facing=north': { model },
          'facing=east': { model, y: 90 },
          'facing=south': { model, y: 180 },
          'facing=west': { model, y: 270 }
        }
      }
  } else {
    const side = b.textures.side ? tex(b.textures.side, 'block', b.id) : 'minecraft:block/stone'
    const top = b.textures.top ? tex(b.textures.top, 'block', `${b.id}_top`) : side
    const bottom = b.textures.bottom ? tex(b.textures.bottom, 'block', `${b.id}_bottom`) : top
    if (b.shape === 'cube_all') modelJson = { parent: 'minecraft:block/cube_all', textures: { all: side } }
    else if (b.shape === 'pillar') {
      modelJson = { parent: 'minecraft:block/cube_column', textures: { end: top, side } }
      states = {
        variants: {
          'axis=y': { model },
          'axis=z': { model, x: 90 },
          'axis=x': { model, x: 90, y: 90 }
        }
      }
    } else modelJson = { parent: 'minecraft:block/cube_bottom_top', textures: { top, bottom, side } }
  }
  files.push({ path: `${A}/models/block/${b.id}.json`, text: json(modelJson) })
  files.push({ path: `${A}/blockstates/${b.id}.json`, text: json(states) })
  files.push({ path: `${A}/models/item/${b.id}.json`, text: json({ parent: model }) })
}
