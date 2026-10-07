import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { textureKeys, type JavaModel } from '@core/gen/model'
import { FIT_PREFIX, SLOT_BONES, geoBones, javaModelToGeo, prepareArmorGeo, type ArmorFit, type GeoFile } from '@core/gen/geo'
import type { ArmorSlot } from '@core/ir'
import { api, assetUrl } from '../api'
import { buildGeo, defaultSkin, mannequin, pixelTexture } from './playerModel3d'

/**
 * 3D preview of one armor piece on a player mannequin (Steve or Alex arms), built exactly like
 * GeckoLib builds it: geo space mirrored on x, bone rotations applied Z·Y·X with x/y negated.
 */

/**
 * Textures stacked vertically, first frame each, same width: the sheet the generator writes.
 * The texture is created only once the sheet is drawn (a WebGL texture cannot change size later).
 */
function sheetTexture(textures: string[]): Promise<THREE.Texture> {
  const canvas = document.createElement('canvas')
  return Promise.all(
    textures.map(
      (t) =>
        new Promise<HTMLImageElement | null>((ok) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => ok(img)
          img.onerror = () => ok(null)
          img.src = assetUrl(t)
        })
    )
  ).then((imgs) => {
    const w = Math.max(16, ...imgs.map((i) => i?.naturalWidth ?? 16))
    canvas.width = w
    canvas.height = w * imgs.length
    const g = canvas.getContext('2d')!
    g.imageSmoothingEnabled = false
    imgs.forEach((img, i) => img && g.drawImage(img, 0, 0, img.naturalWidth, img.naturalWidth, 0, i * w, w, w))
    return new THREE.CanvasTexture(canvas)
  })
}

export interface ArmorPreviewProps {
  geoAsset: string | null
  texture: string | null
  /** Java block/item model: its textures (merged into one sheet like the generator does) */
  javaTextures?: string[] | null
  slot: ArmorSlot
  fit: ArmorFit | null
  slim: boolean
  /** project texture chosen as skin */
  skin: string | null
  /** the game's own Steve/Alex skin (from the downloaded Minecraft files), if any */
  gameSkin: string | null
}

export default function ArmorPreview({ geoAsset, texture, javaTextures, slot, fit, slim, skin, gameSkin }: ArmorPreviewProps) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<{ scene: THREE.Scene; render: () => void } | null>(null)
  const [geo, setGeo] = useState<GeoFile | null>(null)

  // renderer, camera and controls live as long as the panel
  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / Math.max(1, el.clientHeight), 0.5, 500)
    camera.position.set(-33, 28, -76)
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(-20, 40, -30)
    scene.add(sun)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 18, 0)
    controls.update()
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    ctx.current = { scene, render }
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      render()
    })
    ro.observe(el)
    render()
    return () => {
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      ctx.current = null
    }
  }, [])

  useEffect(() => {
    let live = true
    setGeo(null)
    if (geoAsset)
      void api
        .readModel(geoAsset)
        .then((g) => {
          if (!live) return
          const raw = g as GeoFile & JavaModel
          setGeo(javaTextures ? javaModelToGeo(raw, textureKeys(raw), javaTextures.length) : raw)
        })
        .catch(() => undefined)
    return () => {
      live = false
    }
  }, [geoAsset, javaTextures?.length])

  // mannequin
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    // plain mannequin first; a project skin or the game's Steve/Alex replaces it once loaded
    let skinTex: THREE.Texture = pixelTexture(new THREE.CanvasTexture(defaultSkin(slim)))
    const mat = new THREE.MeshLambertMaterial({ map: skinTex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    const url = skin ? assetUrl(skin) : gameSkin
    let live = true
    if (url)
      new THREE.TextureLoader().load(
        url,
        (t) => {
          if (!live) return t.dispose()
          skinTex.dispose()
          skinTex = pixelTexture(t)
          mat.map = skinTex
          mat.needsUpdate = true
          c.render()
        },
        undefined,
        () => undefined
      )
    const body = buildGeo(mannequin(slim), 64, 64, mat, new Set(['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']), () => null)
    c.scene.add(body)
    c.render()
    return () => {
      live = false
      c.scene.remove(body)
      body.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      mat.dispose()
      skinTex.dispose()
      c.render()
    }
  }, [slim, skin, gameSkin])

  // armor piece
  useEffect(() => {
    const c = ctx.current
    if (!c || !geo || !geoBones(geo).length) return
    const prepared = prepareArmorGeo(geo, slot, fit)
    const desc = prepared['minecraft:geometry'][0].description
    const tw = Number(desc.texture_width ?? 64)
    const th = Number(desc.texture_height ?? 64)
    const sheet = !!javaTextures && javaTextures.length > 1
    const tex = sheet
      ? null
      : texture
        ? new THREE.TextureLoader().load(assetUrl(texture), (t) => {
            // animated textures (frames stacked vertically): show the first frame
            const img = t.image as { width: number; height: number }
            const frame = (th / tw) * img.width
            if (img.height > frame) {
              t.repeat.set(1, frame / img.height)
              t.offset.set(0, 1 - frame / img.height)
            }
            c.render()
          })
        : null
    if (tex) pixelTexture(tex)
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      color: tex || sheet ? 0xffffff : 0x9aa4b2,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide
    })
    let sheetTex: THREE.Texture | null = null
    let live = true
    if (sheet)
      void sheetTexture(javaTextures!).then((t) => {
        if (!live) return t.dispose()
        sheetTex = pixelTexture(t)
        mat.map = sheetTex
        mat.needsUpdate = true
        c.render()
      })
    const scale = fit?.scale ?? null
    const armor = buildGeo(geoBones(prepared), tw, th, mat, new Set(SLOT_BONES[slot]), (n) => (n.startsWith(FIT_PREFIX) ? scale : null))
    c.scene.add(armor)
    c.render()
    return () => {
      c.scene.remove(armor)
      armor.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      live = false
      mat.dispose()
      tex?.dispose()
      sheetTex?.dispose()
      c.render()
    }
  }, [geo, texture, javaTextures?.join('|'), slot, JSON.stringify(fit)])

  return <div ref={host} className="preview3d armor-preview" />
}
