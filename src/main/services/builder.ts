import { spawn, type ChildProcess } from 'node:child_process'
import { decodePng } from './iso'
import { encodePng } from './png'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { compile } from '@core/compile/compile'
import { generate, gradleJvmFor } from '@core/gen/index'
import { getProfile } from '@core/gen/profiles'
import type { GenFile, ResolvedDeps } from '@core/gen/types'
import { ASSET_RE, type Project, type Target } from '@core/project'
import { ensureGradle, ensureJdk, findJdks, gradleLaunch, type Progress } from './toolchain'
import { resolveDeps } from './versions'

const SAFE_PATH = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/

export function safeJoin(root: string, rel: string): string {
  if (!SAFE_PATH.test(rel) || rel.split('/').some((s) => s === '..' || s === '.')) throw new Error(`Unsafe path: ${rel}`)
  const full = resolve(root, rel)
  if (!full.startsWith(resolve(root) + sep)) throw new Error(`Path escapes root: ${rel}`)
  return full
}

export function assetPath(projectDir: string, asset: string): string {
  if (!ASSET_RE.test(asset)) throw new Error(`Invalid asset path: ${asset}`)
  return safeJoin(join(projectDir, 'assets'), asset)
}

export function buildDir(projectDir: string, t: Target): string {
  return join(projectDir, '.build', `${t.loader}-${t.mc}`)
}

/** Writes generated files, touching only files whose content changed, and removes stale ones. */
async function writeGenerated(projectDir: string, outDir: string, files: GenFile[]): Promise<number> {
  await mkdir(outDir, { recursive: true })
  const manifestPath = join(outDir, '.nkw-manifest.json')
  let old: string[] = []
  try {
    old = JSON.parse(await readFile(manifestPath, 'utf8')) as string[]
  } catch {
    /* first build */
  }
  let changed = 0
  const now = new Set<string>()
  for (const f of files) {
    const dest = safeJoin(outDir, f.path)
    now.add(f.path)
    await mkdir(dirname(dest), { recursive: true })
    if (f.copy !== undefined) {
      const src = assetPath(projectDir, f.copy)
      const [a, b] = await Promise.all([readFile(src), existsSync(dest) ? readFile(dest) : Promise.resolve(null)])
      if (!b || !a.equals(b)) {
        await copyFile(src, dest)
        changed++
      }
      continue
    }
    const data = f.atlas ? await buildAtlas(projectDir, f.atlas) : f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : Buffer.from(f.text ?? '', 'utf8')
    const prev = existsSync(dest) ? await readFile(dest) : null
    if (!prev || createHash('sha1').update(prev).digest('hex') !== createHash('sha1').update(data).digest('hex')) {
      await writeFile(dest, data)
      changed++
    }
  }
  for (const p of old) if (!now.has(p)) await rm(safeJoin(outDir, p), { force: true })
  await writeFile(manifestPath, JSON.stringify([...now].sort()))
  return changed
}

/** Stacks textures vertically into one PNG (first animation frame each, scaled to the widest). */
async function buildAtlas(projectDir: string, textures: string[]): Promise<Buffer> {
  const imgs = await Promise.all(textures.map(async (t) => decodePng(await readFile(assetPath(projectDir, t)))))
  const w = Math.max(16, ...imgs.map((i) => i?.w ?? 16))
  return encodePng(w, w * imgs.length, (x, y) => {
    const img = imgs[Math.floor(y / w)]
    if (!img) return [0, 0, 0, 0]
    const sx = Math.floor((x * img.w) / w)
    const sy = Math.floor(((y % w) * img.w) / w)
    const d = (sy * img.w + sx) * 4
    return [img.px[d], img.px[d + 1], img.px[d + 2], img.px[d + 3]]
  })
}

export interface BuildOptions {
  projectDir: string
  project: Project
  target: Target
  toolsDir: string
  allowDownload: boolean
  task: 'runClient' | 'build' | 'compileJava' | 'runServer'
  log: (line: string) => void
  progress: Progress
  memoryMb?: number
}

export interface RunningBuild {
  done: Promise<number>
  stop: () => void
  outDir: string
}

/** Generates the project for `target` and runs a Gradle task on it. */
export async function startBuild(o: BuildOptions): Promise<RunningBuild> {
  const { ir, diagnostics } = compile(o.project, o.target)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length) throw new Error(`Fix ${errors.length} error(s) first: ${errors[0].message.en}`)
  const profile = getProfile(o.target.mc)

  o.progress('Resolving versions')
  const deps: ResolvedDeps = await resolveDeps(o.target, o.toolsDir)
  const outDir = buildDir(o.projectDir, o.target)
  const files = generate(ir, o.target, deps, { readText: (a) => readFileSyncUtf8(assetPath(o.projectDir, a)) })
  const changed = await writeGenerated(o.projectDir, outDir, files)
  o.log(`[NKW] Generated ${files.length} files (${changed} changed) → ${outDir}`)

  const gradleJdk = await ensureJdk(o.toolsDir, gradleJvmFor(deps.gradle), o.progress, o.allowDownload)
  const targetJdk = profile.java === gradleJdk.major ? gradleJdk : await ensureJdk(o.toolsDir, profile.java, o.progress, o.allowDownload)
  const home = await ensureGradle(o.toolsDir, deps.gradle, o.progress, o.allowDownload)
  const launch = await gradleLaunch(home)
  const javaPaths = (await findJdks(o.toolsDir)).map((j) => j.home)
  if (!javaPaths.includes(targetJdk.home)) javaPaths.push(targetJdk.home)

  const args = [
    ...launch,
    o.task,
    '--console=plain',
    // ForgeGradle keeps per-JVM state bound to the first project it set up; a shared daemon breaks the next Forge project
    ...(o.target.loader === 'forge' ? ['--no-daemon'] : []),
    `-Porg.gradle.java.installations.paths=${javaPaths.join(',')}`,
    `-PnkwMem=${Math.max(1024, Math.min(16384, Math.round(o.memoryMb ?? 4096)))}`,
    `-Dorg.gradle.java.installations.auto-download=false`
  ]
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JAVA_HOME: gradleJdk.home,
    GRADLE_USER_HOME: join(o.toolsDir, 'gradle-home')
  }
  delete env.ELECTRON_RUN_AS_NODE
  if (o.task === 'runClient' && profile.smithingTransform && !existsSync(join(outDir, 'run', 'saves', 'NKW Test')))
    o.log(
      '[NKW] Tip: create a world named "NKW Test" once — later tests will open it automatically. / สร้างโลกชื่อ "NKW Test" ครั้งเดียว ครั้งต่อไประบบจะเข้าโลกนี้ให้อัตโนมัติ'
    )
  o.progress(`Running ${o.task}`)
  o.log(`[NKW] gradle ${o.task} (Java ${gradleJdk.major} for Gradle, Java ${targetJdk.major} for Minecraft ${o.target.mc})`)

  const child: ChildProcess = spawn(join(gradleJdk.home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), args, {
    cwd: outDir,
    env,
    windowsHide: true,
    shell: false
  })
  const pipe = (s: NodeJS.ReadableStream | null) => {
    let buf = ''
    s?.setEncoding('utf8')
    s?.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        o.log(buf.slice(0, i).replace(/\r$/, ''))
        buf = buf.slice(i + 1)
      }
    })
    s?.on('end', () => buf && o.log(buf))
  }
  pipe(child.stdout)
  pipe(child.stderr)
  const done = new Promise<number>((ok) => {
    child.on('error', (e) => {
      o.log(`[NKW] ${e.message}`)
      ok(-1)
    })
    child.on('close', (code) => ok(code ?? -1))
  })
  const stop = () => {
    if (child.exitCode !== null || !child.pid) return
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, shell: false })
    else child.kill('SIGTERM')
  }
  return { done, stop, outDir }
}

function readFileSyncUtf8(p: string): string {
  return readFileSync(p, 'utf8')
}

/** Finds the built mod jar (excluding sources/dev jars). */
export async function findJar(outDir: string): Promise<string | null> {
  const libs = join(outDir, 'build', 'libs')
  try {
    const jars = (await readdir(libs)).filter((f) => f.endsWith('.jar') && !/-(sources|dev|slim|all)\.jar$/.test(f))
    return jars.length ? join(libs, jars[0]) : null
  } catch {
    return null
  }
}
