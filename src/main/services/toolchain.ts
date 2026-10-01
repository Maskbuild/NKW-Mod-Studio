import { existsSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { download, getJson, getText } from './net'
import { unzip } from './unzip'

export interface Jdk {
  home: string
  major: number
  managed: boolean
}

export type Progress = (msg: string, done?: number, total?: number) => void

const isWin = process.platform === 'win32'
const exe = (name: string) => (isWin ? `${name}.exe` : name)

async function jdkMajor(home: string): Promise<number | null> {
  try {
    if (!existsSync(join(home, 'bin', exe('javac')))) return null
    const rel = await readFile(join(home, 'release'), 'utf8')
    const m = /JAVA_VERSION="(\d+)(?:\.(\d+))?/.exec(rel)
    if (!m) return null
    const a = Number(m[1])
    return a === 1 ? Number(m[2]) : a
  } catch {
    return null
  }
}

async function childDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

/** Finds installed JDKs (system + ones managed by the app). */
export async function findJdks(toolsDir: string): Promise<Jdk[]> {
  const candidates = new Set<string>()
  if (process.env.JAVA_HOME) candidates.add(process.env.JAVA_HOME)
  const roots = isWin
    ? [
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Zulu',
        'C:\\Program Files\\Amazon Corretto',
        'C:\\Program Files\\BellSoft'
      ]
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines']
  for (const r of roots) for (const d of await childDirs(r)) candidates.add(d)
  for (const d of await childDirs(join(toolsDir, 'jdk'))) {
    candidates.add(d)
    for (const inner of await childDirs(d)) candidates.add(inner)
  }
  const out: Jdk[] = []
  for (const c of candidates) {
    const home = existsSync(join(c, 'Contents', 'Home')) ? join(c, 'Contents', 'Home') : c
    const major = await jdkMajor(home)
    if (major) out.push({ home, major, managed: home.startsWith(join(toolsDir, 'jdk')) })
  }
  return out
}

async function findJdk(toolsDir: string, major: number): Promise<Jdk | null> {
  const all = await findJdks(toolsDir)
  return all.find((j) => j.major === major) ?? null
}

interface AdoptiumAsset {
  binary: { package: { link: string; checksum: string; name: string; size: number } }
  release_name: string
}

/** Downloads Eclipse Temurin (checksum-verified) into the tools folder. */
async function installJdk(toolsDir: string, major: number, progress: Progress): Promise<Jdk> {
  const os = isWin ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const assets = await getJson<AdoptiumAsset[]>(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jdk&os=${os}&vendor=eclipse`
  )
  const pkg = assets[0]?.binary.package
  if (!pkg) throw new Error(`No Temurin ${major} build for ${os}/${arch}`)
  if (!pkg.name.endsWith('.zip')) throw new Error(`Unsupported JDK archive ${pkg.name}`)
  const zip = join(toolsDir, 'downloads', pkg.name)
  progress(`Downloading Java ${major} (${assets[0].release_name})`)
  await download(pkg.link, zip, pkg.checksum, (d, t) => progress(`Downloading Java ${major}`, d, t))
  const dest = join(toolsDir, 'jdk', `temurin-${major}`)
  await rm(dest, { recursive: true, force: true })
  progress(`Extracting Java ${major}`)
  await unzip(zip, dest)
  await rm(zip, { force: true })
  const jdk = await findJdk(toolsDir, major)
  if (!jdk) throw new Error(`Java ${major} install failed`)
  return jdk
}

export async function ensureJdk(toolsDir: string, major: number, progress: Progress, allowDownload: boolean): Promise<Jdk> {
  const found = await findJdk(toolsDir, major)
  if (found) return found
  if (!allowDownload) throw new NeedsDownloadError('jdk', major)
  return installJdk(toolsDir, major, progress)
}

export class NeedsDownloadError extends Error {
  constructor(
    readonly what: 'jdk' | 'gradle',
    readonly version: number | string
  ) {
    super(`${what} ${version} is not installed`)
  }
}

function gradleHome(toolsDir: string, version: string): string {
  return join(toolsDir, 'gradle', `gradle-${version}`)
}

export async function ensureGradle(toolsDir: string, version: string, progress: Progress, allowDownload: boolean): Promise<string> {
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) throw new Error('Bad Gradle version')
  const home = gradleHome(toolsDir, version)
  // the marker is written only after a complete extraction, so a half-deleted install gets reinstalled
  const marker = join(home, '.nkw-complete')
  if (existsSync(marker)) return home
  if (!allowDownload) throw new NeedsDownloadError('gradle', version)
  await rm(home, { recursive: true, force: true })
  const url = `https://services.gradle.org/distributions/gradle-${version}-bin.zip`
  const sha = (await getText(`${url}.sha256`)).trim()
  if (!/^[a-f0-9]{64}$/i.test(sha)) throw new Error('Bad Gradle checksum file')
  const zip = join(toolsDir, 'downloads', `gradle-${version}-bin.zip`)
  progress(`Downloading Gradle ${version}`)
  await download(url, zip, sha, (d, t) => progress(`Downloading Gradle ${version}`, d, t))
  progress(`Extracting Gradle ${version}`)
  await unzip(zip, join(toolsDir, 'gradle'))
  await rm(zip, { force: true })
  await writeFile(marker, new Date().toISOString())
  return home
}

/**
 * Builds a direct `java … GradleMain` invocation from the distribution's own launcher script,
 * so no shell is involved.
 */
export async function gradleLaunch(home: string): Promise<string[]> {
  const libs = await readdir(join(home, 'lib'))
  const agents = await readdir(join(home, 'lib', 'agents')).catch(() => [] as string[])
  const args = ['-Xmx64m', '-Xms64m', '-Dorg.gradle.appname=gradle']
  const agent = agents.find((f) => /^gradle-instrumentation-agent-.*\.jar$/.test(f))
  if (agent) args.push(`-javaagent:${join(home, 'lib', 'agents', agent)}`)
  const cliMain = libs.find((f) => /^gradle-gradle-cli-main-.*\.jar$/.test(f))
  if (cliMain) return [...args, '-jar', join(home, 'lib', cliMain)]
  const launcher = libs.find((f) => /^gradle-launcher-.*\.jar$/.test(f))
  if (!launcher) throw new Error('Cannot find the Gradle launcher')
  return [...args, '-classpath', join(home, 'lib', launcher), 'org.gradle.launcher.GradleMain']
}
