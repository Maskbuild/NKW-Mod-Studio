import { newProject, type Project } from '../../src/core/project'

export const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data })
export const skinsProject = (extra: Record<string, unknown> = {}, skins = 2): Project => {
  const p = newProject(
    { name: 'T', modId: 'skintest', version: '1.0.0', authors: 'a', description: '', license: 'MIT', homepage: '', issues: '', credits: [] },
    [{ loader: 'fabric', mc: '1.21.1' }]
  )
  p.graph = {
    nodes: [
      ...Array.from({ length: skins }, (_, i) =>
        node(`s${i}`, 'skin', {
          name: `Skin ${i}`,
          nameTh: `สกิน ${i}`,
          id: `skin_${i}`,
          file: `textures/skin${i}.png`,
          openFile: i === 0 ? 'textures/skin0_open.png' : '',
          model: i === 1 ? 'slim' : 'wide'
        })
      ),
      node('w', 'skinWardrobe', {
        keyEnabled: true,
        key: 'k',
        stationEnabled: true,
        stationId: 'wardrobe',
        stationName: 'Wardrobe',
        stationNameTh: 'ตู้',
        ...extra
      }),
      node('t', 'texture', { asset: 'textures/station.png' })
    ],
    edges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'w', targetHandle: 'stationTexture' }]
  }
  return p
}
