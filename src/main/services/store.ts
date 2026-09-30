import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { ProjectSchema, type Project } from '@core/project'

/** Atomic write: temp file + rename, so a crash never leaves a half-written file. */
export async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tmp, data)
  await rename(tmp, path)
}

// ───────── settings ─────────

export const SettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  language: z.enum(['th', 'en']).default('th'),
  memoryMb: z.number().int().min(1024).max(16384).default(4096),
  allowDownloads: z.boolean().default(false),
  recent: z.array(z.object({ dir: z.string().max(1024), name: z.string().max(64), modId: z.string().max(64), at: z.number() })).max(20).default([])
})
export type Settings = z.infer<typeof SettingsSchema>

export class SettingsStore {
  private data: Settings = SettingsSchema.parse({})
  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      this.data = SettingsSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.data = SettingsSchema.parse({})
    }
    return this.data
  }
  get(): Settings {
    return this.data
  }
  async update(patch: Partial<Settings>): Promise<Settings> {
    this.data = SettingsSchema.parse({ ...this.data, ...patch })
    await writeAtomic(this.file, JSON.stringify(this.data, null, 2))
    return this.data
  }
  async touchRecent(dir: string, p: Project): Promise<void> {
    const recent = [{ dir, name: p.meta.name, modId: p.meta.modId, at: Date.now() }, ...this.data.recent.filter((r) => r.dir !== dir)].slice(0, 12)
    await this.update({ recent })
  }
  async forgetRecent(dir: string): Promise<void> {
    await this.update({ recent: this.data.recent.filter((r) => r.dir !== dir) })
  }
}

// ───────── projects ─────────

export const PROJECT_FILE = 'project.json'
const BACKUPS = 10

export async function readProject(dir: string): Promise<Project> {
  const raw = JSON.parse(await readFile(join(dir, PROJECT_FILE), 'utf8')) as unknown
  return ProjectSchema.parse(raw)
}

export async function saveProject(dir: string, project: Project): Promise<void> {
  const valid = ProjectSchema.parse(project)
  const file = join(dir, PROJECT_FILE)
  if (existsSync(file)) {
    const bdir = join(dir, '.backups')
    await mkdir(bdir, { recursive: true })
    const prev = await readFile(file)
    await writeFile(join(bdir, `project-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), prev)
    const olds = (await readdir(bdir)).filter((f) => f.startsWith('project-')).sort()
    for (const f of olds.slice(0, Math.max(0, olds.length - BACKUPS))) await rm(join(bdir, f), { force: true })
  }
  await writeAtomic(file, JSON.stringify(valid, null, 2))
}

export async function createProjectDir(parent: string, folderName: string, project: Project): Promise<string> {
  const safe = folderName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 64) || project.meta.modId
  let dir = join(parent, `${safe}.nkw`)
  for (let i = 2; existsSync(dir); i++) dir = join(parent, `${safe} (${i}).nkw`)
  for (const d of ['textures', 'models', 'geo', 'sounds', 'animations']) await mkdir(join(dir, 'assets', d), { recursive: true })
  await writeAtomic(join(dir, PROJECT_FILE), JSON.stringify(ProjectSchema.parse(project), null, 2))
  await writeFile(join(dir, '.gitignore'), '.build/\n.backups/\n')
  return dir
}
