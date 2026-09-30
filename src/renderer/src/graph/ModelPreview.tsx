import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { api, assetUrl } from '../api'
import type { JavaModel } from '@core/gen/model'
import { textureKeys } from '@core/gen/model'

/** BoxGeometry face order: +x east, -x west, +y up, -y down, +z south, -z north. */
const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north'] as const

/** Renders a Java block model (Blockbench export) with its connected textures. Renders on demand only. */
export default function ModelPreview({ asset, textures }: { asset: string; textures: (string | null)[] }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.1, 500)
    camera.position.set(26, 20, 30)
    scene.add(new THREE.AmbientLight(0xffffff, 1.35))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(20, 40, 25)
    scene.add(sun)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.target.set(0, 0, 0)
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    const loader = new THREE.TextureLoader()
    const disposables: { dispose(): void }[] = [renderer, controls]

    void api.readModel(asset).then((raw) => {
      if (disposed) return
      const model = raw as JavaModel
      const keys = textureKeys(model)
      const mats = new Map<string, THREE.Material>()
      const matFor = (ref: string): THREE.Material => {
        const key = ref.replace(/^#/, '')
        const slot = Math.max(0, keys.indexOf(key))
        const tex = textures[slot] ?? textures[0]
        const id = tex ?? 'none'
        if (!mats.has(id)) {
          const m = new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : 0x9ca3af, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
          if (tex)
            loader.load(assetUrl(tex), (t) => {
              t.magFilter = THREE.NearestFilter
              t.minFilter = THREE.NearestFilter
              t.colorSpace = THREE.SRGBColorSpace
              m.map = t
              m.needsUpdate = true
              disposables.push(t)
              render()
            })
          mats.set(id, m)
          disposables.push(m)
        }
        return mats.get(id)!
      }
      const invisible = new THREE.MeshBasicMaterial({ visible: false })
      disposables.push(invisible)
      const group = new THREE.Group()
      for (const e of model.elements ?? []) {
        const size = [e.to[0] - e.from[0], e.to[1] - e.from[1], e.to[2] - e.from[2]].map((v) => Math.max(0.01, v))
        const geo = new THREE.BoxGeometry(size[0], size[1], size[2])
        const uv = geo.getAttribute('uv') as THREE.BufferAttribute
        const materials = FACE_ORDER.map((f, i) => {
          const face = e.faces?.[f]
          if (!face) return invisible
          const [u1, v1, u2, v2] = face.uv ?? [0, 0, 16, 16]
          const q = [
            [u1, v1],
            [u2, v1],
            [u1, v2],
            [u2, v2]
          ]
          for (let k = 0; k < 4; k++) uv.setXY(i * 4 + k, q[k][0] / 16, 1 - q[k][1] / 16)
          return matFor(face.texture)
        })
        uv.needsUpdate = true
        disposables.push(geo)
        const mesh = new THREE.Mesh(geo, materials)
        const center = new THREE.Vector3((e.from[0] + e.to[0]) / 2 - 8, (e.from[1] + e.to[1]) / 2 - 8, (e.from[2] + e.to[2]) / 2 - 8)
        if (e.rotation) {
          const pivot = new THREE.Group()
          const o = e.rotation.origin
          pivot.position.set(o[0] - 8, o[1] - 8, o[2] - 8)
          pivot.rotation[e.rotation.axis] = THREE.MathUtils.degToRad(e.rotation.angle)
          mesh.position.copy(center).sub(pivot.position)
          pivot.add(mesh)
          group.add(pivot)
        } else {
          mesh.position.copy(center)
          group.add(mesh)
        }
      }
      scene.add(group)
      render()
    })

    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      render()
    })
    ro.observe(el)
    render()
    return () => {
      disposed = true
      ro.disconnect()
      for (const d of disposables) d.dispose()
      renderer.domElement.remove()
    }
  }, [asset, textures.join('|')])

  return <div ref={host} className="preview3d" />
}
