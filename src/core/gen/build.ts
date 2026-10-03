import { NKW_ICON_PNG_BASE64 } from './icon'
import { scriptAppliesTo } from '../scriptApi'
import { LINK_RE, shippedCredits, type ProjectMeta } from '../project'
import { RES, json, type GenCtx, type ResolvedDeps } from './types'

const FORGE_LOADER_RANGE: Record<string, string> = {
  '1.16.5': '[36,)',
  '1.18.2': '[40,)',
  '1.19.2': '[43,)',
  '1.20.1': '[47,)',
  '1.20.4': '[49,)',
  '1.21.1': '[52,)',
  '1.21.4': '[54,)'
}

const MODRINTH_REPO = `    maven {
        name = 'Modrinth'
        url = 'https://api.modrinth.com/maven'
        content { includeGroup 'maven.modrinth' }
    }`

/** Slug of a maven.modrinth:<slug>:<version> coordinate. */
const mrSlug = (c: string) => /^maven\.modrinth:([a-z0-9_-]+):/.exec(c)?.[1]

/** Linked Modrinth mods for test runs that are not added already (Farmer's Delight, AppleSkin …). */
function linkedTestMods(deps: ResolvedDeps, present: (string | null | undefined)[]): string[] {
  const have = new Set(['fabric-api', 'qsl', ...present.map((c) => (c ? mrSlug(c) : undefined)).filter(Boolean)])
  return (deps.linkedMods ?? []).filter((c) => /^maven\.modrinth:[a-z0-9_-]+:[A-Za-z0-9]+$/.test(c) && !have.has(mrSlug(c)!))
}

/** A linked .jar file copied next to the build (nkw-mods/<id>-1.jar). */
const localJar = (id: string) => `nkw-mods/${id}-1.jar`

/** Flat folder repository for linked .jar files (ForgeGradle deobfuscates them like Maven mods). */
const LOCAL_REPO = `
    flatDir {
        dir 'nkw-mods'
        content { includeGroup 'nkwlocal' }
    }`

/**
 * Loom strips the mods/libraries a dependency bundles inside its jar (jar-in-jar). Farmer's Delight
 * ports (Fabric ASM, Porting Lib) and GeckoLib (MCLib) ship theirs that way, so for test runs they are
 * unpacked (recursively) and added next to it. Fabric API modules are already on the classpath.
 * The jars are fetched from Modrinth's Maven directly: Loom forbids resolving a configuration before
 * its own setup.
 */
function fabricBundledMods(deps: string[]): string {
  const sources = deps
    .map((d) => /^maven\.modrinth:([a-z0-9_-]+):([A-Za-z0-9._+-]+)$/.exec(d))
    .filter((m): m is RegExpExecArray => !!m)
    .map(([, slug, ver]) => `    '${slug}-${ver}.jar': 'https://api.modrinth.com/maven/maven/modrinth/${slug}/${ver}/${slug}-${ver}.jar'`)
  if (!sources.length) return ''
  return `
// ── mods bundled inside dependencies (Loom does not load jar-in-jar mods of dependencies) ──
def nkwNestedDir = layout.buildDirectory.dir('nkw-nested').get().asFile
def nkwUnpack
nkwUnpack = { File jar ->
    def zip = new java.util.zip.ZipFile(jar)
    try {
        zip.entries().toList().findAll { !it.directory && it.name.startsWith('META-INF/jars/') && it.name.endsWith('.jar') }.each { e ->
            def out = new File(nkwNestedDir, e.name.substring(e.name.lastIndexOf('/') + 1))
            if (!out.exists()) {
                out.parentFile.mkdirs()
                out.withOutputStream { os -> os << zip.getInputStream(e) }
            }
            nkwUnpack(out)
        }
    } finally {
        zip.close()
    }
}
[
${sources.join(',\n')}
].each { name, url ->
    def jar = layout.buildDirectory.file('nkw-bundled-source/' + name).get().asFile
    if (!jar.exists()) {
        jar.parentFile.mkdirs()
        def tmp = new File(jar.path + '.part')
        new URL(url).withInputStream { i -> tmp.withOutputStream { it << i } }
        tmp.renameTo(jar)
    }
    nkwUnpack(jar)
}
dependencies {
    (nkwNestedDir.listFiles() ?: []).findAll { it.name.endsWith('.jar') }.sort { it.name }.each { f ->
        def zip = new java.util.zip.ZipFile(f)
        def entry = zip.getEntry('fabric.mod.json')
        def id = entry ? new groovy.json.JsonSlurper().parse(zip.getInputStream(entry)).id : null
        zip.close()
        if (id == null) runtimeOnly files(f)
        else if (!id.startsWith('fabric-') && id != 'fabric' && id != 'fabricloader') modRuntimeOnly files(f)
    }
}
`
}

/** Gradle build + mod metadata files. */
export function genBuild(ctx: GenCtx): void {
  const { ir, loader, p, deps, files, ns, pkg } = ctx
  const meta = ir.meta
  const archive = `${ns}-${loader}-${p.mc}`
  const q = (s: string) => JSON.stringify(s)
  const extraDeps: string[] = []
  // mod logo: the project's uploaded texture, else the default NKW logo
  const license = licenseId(meta)
  const credits = shippedCredits(meta)
  const links = modLinks(meta)
  for (const f of creditFiles(meta)) files.push({ path: `${RES}/${f.name}`, text: f.text })
  const logo = (path: string) => files.push(meta.icon ? { path, copy: meta.icon } : { path, base64: NKW_ICON_PNG_BASE64 })
  logo(`${RES}/assets/${ns}/icon.png`)
  if (loader === 'forge' || loader === 'neoforge') logo(`${RES}/nkw_logo.png`)
  // 1.20+: jump straight into the test world once the user has created it
  const quickPlay = (call: string) =>
    p.smithingTransform
      ? `            if (file('run/saves/NKW Test').exists()) ${call} '--quickPlaySingleplayer', 'NKW Test'
`
      : ''

  const pluginRepos: Record<string, string> = {
    fabric: "        maven { url = 'https://maven.fabricmc.net/' }",
    quilt: "        maven { url = 'https://maven.quiltmc.org/repository/release/' }\n        maven { url = 'https://maven.fabricmc.net/' }",
    forge: "        maven { url = 'https://maven.minecraftforge.net/' }",
    neoforge: "        maven { url = 'https://maven.neoforged.net/releases/' }"
  }
  files.push({
    path: 'settings.gradle',
    text: `pluginManagement {
    repositories {
${pluginRepos[loader]}
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = '${ns}'
`
  })
  files.push({
    path: 'gradle.properties',
    text: `org.gradle.jvmargs=-Xmx3G -Dfile.encoding=UTF-8
org.gradle.daemon=true
${loader === 'forge' ? 'org.gradle.parallel=false' : 'org.gradle.parallel=true'}
org.gradle.caching=true
org.gradle.configuration-cache=false
org.gradle.java.installations.auto-download=false
`
  })
  files.push({ path: '.gitignore', text: 'build/\n.gradle/\nrun/\nout/\n*.iml\n.idea/\n' })

  const toolchain = `java {
    toolchain.languageVersion = JavaLanguageVersion.of(${p.java})
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
${
  p.java > 8
    ? `    options.release = ${p.java}
`
    : ''
}}`

  const quiltRepo =
    loader === 'quilt'
      ? `
    maven {
        name = 'Quilt'
        url = 'https://maven.quiltmc.org/repository/release/'
        content { includeGroupAndSubgroups 'org.quiltmc' }
    }`
      : ''
  /** Script classes that implement ModInitializer / ClientModInitializer (Fabric/Quilt entrypoints). */
  const entry = (kind: 'main' | 'client') =>
    ctx.ir.scripts.filter((s) => s.entry[kind] && scriptAppliesTo(s.targets, ctx.target)).map((s) => `${pkg}.${s.className}`)
  const fdDep = ctx.fd && deps.farmersDelight ? deps.farmersDelight : null
  const geckoDep = ctx.gecko && deps.geckolib ? deps.geckolib : null

  if (loader === 'fabric' || loader === 'quilt') {
    // Quilt Loom lags behind the Loom versions current mods are built with, so Fabric Loom (which also
    // understands quilt_installer.json) is used for Quilt too.
    const plugin = `id 'net.fabricmc.fabric-loom-remap' version '${deps.loom}'`
    const loaderDep =
      loader === 'fabric'
        ? `modImplementation 'net.fabricmc:fabric-loader:${deps.fabricLoader}'`
        : `modImplementation 'org.quiltmc:quilt-loader:${deps.quiltLoader}'`
    if (loader === 'quilt') for (const lib of deps.quiltLibraries ?? []) extraDeps.push(`    runtimeOnly '${lib}'`)
    // Mod Menu is added to test runs so the mod list / config screen is available in game
    if (deps.modMenu) extraDeps.push(`    modRuntimeOnly '${deps.modMenu}'`)
    if (deps.appleSkin) extraDeps.push(`    modRuntimeOnly '${deps.appleSkin}'`)
    if (deps.appleSkin && deps.clothConfig) extraDeps.push(`    modRuntimeOnly '${deps.clothConfig}'`)
    if (fdDep) extraDeps.push(`    modRuntimeOnly '${fdDep}'`)
    if (geckoDep) extraDeps.push(`    modImplementation '${geckoDep}'`)
    // linked mods (test runs): from Modrinth, and .jar files picked on disk
    const linked = linkedTestMods(deps, [fdDep, geckoDep, deps.modMenu, deps.appleSkin, deps.clothConfig])
    for (const c of linked) extraDeps.push(`    modRuntimeOnly '${c}'`)
    for (const id of deps.localMods ?? []) extraDeps.push(`    modRuntimeOnly files('${localJar(id)}')`)
    files.push({
      path: 'build.gradle',
      text: `plugins {
    ${plugin}
}

version = ${q(meta.version)}
group = '${pkg}'

base {
    archivesName = '${archive}'
}

repositories {
${MODRINTH_REPO}${quiltRepo}
}

dependencies {
    minecraft 'com.mojang:minecraft:${p.mc}'
    mappings loom.officialMojangMappings()
    ${loaderDep}
    modImplementation 'net.fabricmc.fabric-api:fabric-api:${deps.fabricApi}'
${extraDeps.join('\n')}
}
${fabricBundledMods([fdDep, geckoDep, ...linked].filter((d): d is string => !!d))}
loom {
    runs {${
      loader === 'quilt'
        ? `
        configureEach {
            // Fabric Loom sets fabric.* properties; Quilt Loader reads loader.*
            property 'loader.development', 'true'
            property 'loader.remapClasspathFile', file('.gradle/loom-cache/remapClasspath.txt').absolutePath
            property 'loader.classPathGroups', [file('build/classes/java/main'), file('build/resources/main')].join(File.pathSeparator)
        }`
        : ''
    }
        client {
            vmArg "-Xmx\${project.findProperty('nkwMem') ?: '4096'}M"
            programArgs '--username', 'NKW_Tester'
${quickPlay('programArgs')}        }
    }
}

${toolchain}
`
    })
    const apiId = ['1.16.5', '1.18.2'].includes(p.mc) ? 'fabric' : 'fabric-api'
    const mcRange = `~${p.mc}`
    if (loader === 'fabric')
      files.push({
        path: `${RES}/fabric.mod.json`,
        text: json({
          schemaVersion: 1,
          id: ns,
          version: meta.version,
          name: meta.name,
          description: meta.description,
          authors: meta.authors
            ? meta.authors
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : ['Nam Kueap Wan (NKW)'],
          ...(credits.length ? { contributors: credits.map((c) => (c.link ? { name: creditTitle(c), contact: { homepage: c.link } } : creditTitle(c))) } : {}),
          ...(links.homepage || links.issues ? { contact: links } : {}),
          license,
          environment: '*',
          icon: `assets/${ns}/icon.png`,
          entrypoints: { main: [`${pkg}.NkwMod`, ...entry('main')], client: [`${pkg}.NkwClient`, ...entry('client')] },
          depends: {
            fabricloader: '>=0.14.0',
            minecraft: mcRange,
            java: `>=${p.java}`,
            [apiId]: '*',
            ...(geckoDep ? { geckolib: '*' } : {}),
            ...Object.fromEntries(ctx.ir.dependsOn.filter((d) => d.required).map((d) => [d.modId, '*']))
          },
          ...(ctx.ir.dependsOn.some((d) => !d.required)
            ? { suggests: Object.fromEntries(ctx.ir.dependsOn.filter((d) => !d.required).map((d) => [d.modId, '*'])) }
            : {})
        })
      })
    else
      files.push({
        path: `${RES}/quilt.mod.json`,
        text: json({
          schema_version: 1,
          quilt_loader: {
            group: pkg,
            id: ns,
            version: meta.version,
            metadata: {
              icon: `assets/${ns}/icon.png`,
              name: meta.name,
              description: meta.description,
              contributors: Object.fromEntries(
                (meta.authors || 'Nam Kueap Wan (NKW)')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((a) => [a, 'Owner'])
                  .concat(credits.map((c) => [c.name, creditTitle({ ...c, name: '' }) || 'Contributor']))
              ),
              ...(links.homepage || links.issues ? { contact: links } : {}),
              license
            },
            intermediate_mappings: 'net.fabricmc:intermediary',
            entrypoints: { main: [`${pkg}.NkwMod`, ...entry('main')], client: [`${pkg}.NkwClient`, ...entry('client')] },
            depends: [
              { id: 'quilt_loader', versions: '>=0.17.0' },
              { id: 'minecraft', versions: mcRange },
              apiId,
              ...(geckoDep ? ['geckolib'] : []),
              ...ctx.ir.dependsOn.map((d) => (d.required ? d.modId : { id: d.modId, optional: true }))
            ]
          }
        })
      })
    return
  }

  // ── Forge / NeoForge metadata ──
  const toml = `modLoader="javafml"
loaderVersion=${q(loader === 'forge' ? FORGE_LOADER_RANGE[p.mc] : '[1,)')}
license=${q(license === 'All-Rights-Reserved' ? 'All Rights Reserved' : license)}
${links.issues ? `issueTrackerURL=${q(links.issues)}\n` : ''}
[[mods]]
modId=${q(ns)}
version=${q(meta.version)}
displayName=${q(meta.name)}
authors=${q(meta.authors || 'Nam Kueap Wan (NKW)')}
description=${q(meta.description || meta.name)}
logoFile="nkw_logo.png"
${links.homepage ? `displayURL=${q(links.homepage)}\n` : ''}${credits.length ? `credits=${q('\n' + credits.map(creditLine).join('\n'))}\n` : ''}${ctx.ir.dependsOn
    .map(
      (d) => `
[[dependencies.${ns}]]
modId=${q(d.modId)}
${loader === 'neoforge' ? `type=${q(d.required ? 'required' : 'optional')}` : `mandatory=${d.required}`}
versionRange="*"
ordering="NONE"
side="BOTH"
`
    )
    .join('')}`
  const tomlName = loader === 'neoforge' && p.mc !== '1.20.4' ? 'neoforge.mods.toml' : 'mods.toml'
  files.push({ path: `${RES}/META-INF/${tomlName}`, text: toml })
  const pack: Record<string, unknown> = { description: `${meta.name} resources`, pack_format: p.dataPack }
  if (loader === 'forge' && ['1.18.2', '1.19.2', '1.20.1'].includes(p.mc)) {
    pack['forge:resource_pack_format'] = p.resourcePack
    pack['forge:data_pack_format'] = p.dataPack
  }
  files.push({ path: `${RES}/pack.mcmeta`, text: json({ pack }) })

  if (loader === 'forge') {
    const deobf = (c: string) => (p.forgeNoReobf ? `'${c}'` : `fg.deobf('${c}')`)
    if (fdDep) extraDeps.push(`    runtimeOnly ${deobf(fdDep)}`)
    if (deps.appleSkin) extraDeps.push(`    runtimeOnly ${deobf(deps.appleSkin)}`)
    if (geckoDep) extraDeps.push(`    implementation ${deobf(geckoDep)}`)
    for (const c of linkedTestMods(deps, [fdDep, geckoDep, deps.appleSkin])) extraDeps.push(`    runtimeOnly ${deobf(c)}`)
    for (const id of deps.localMods ?? []) extraDeps.push(`    runtimeOnly ${deobf(`nkwlocal:${id}:1`)}`)
    files.push({
      path: 'build.gradle',
      text: `plugins {
    id 'net.minecraftforge.gradle' version '${deps.forgeGradle}'
}

version = ${q(meta.version)}
group = '${pkg}'

base {
    archivesName = '${archive}'
}

${toolchain}

minecraft {
    mappings channel: 'official', version: '${p.mc}'
${p.forgeNoReobf ? '    reobf = false\n' : ''}    copyIdeResources = true

    runs {
        configureEach {
            workingDirectory project.file('run')
            property 'forge.logging.console.level', 'info'${
              p.forgeNoReobf
                ? ''
                : `
            // lets dependency mods with mixins (e.g. Farmer's Delight) run in the dev environment
            property 'mixin.env.remapRefMap', 'true'
            property 'mixin.env.refMapRemappingFile', "\${projectDir}/build/createSrgToMcp/output.srg"`
            }
            mods {
                '${ns}' {
                    source sourceSets.main
                }
            }
        }
        client {
            jvmArg "-Xmx\${project.findProperty('nkwMem') ?: '4096'}M"
            args '--username', 'NKW_Tester'
${quickPlay('args')}        }
        server {
            args '--nogui'
        }
    }
}

repositories {
${MODRINTH_REPO}${deps.localMods?.length ? LOCAL_REPO : ''}
}

dependencies {
    minecraft 'net.minecraftforge:forge:${deps.forge}'
${extraDeps.join('\n')}
}
${
  p.forgeNoReobf
    ? `
sourceSets.each {
    def dir = layout.buildDirectory.dir("sourcesSets/$it.name")
    it.output.resourcesDir = dir
    it.java.destinationDirectory = dir
}
`
    : `
tasks.named('jar', Jar).configure {
    finalizedBy 'reobfJar'
}
`
}`
    })
    return
  }

  // NeoForge (ModDevGradle)
  if (fdDep) extraDeps.push(`    runtimeOnly '${fdDep}'`)
  if (deps.appleSkin) extraDeps.push(`    runtimeOnly '${deps.appleSkin}'`)
  if (geckoDep) extraDeps.push(`    implementation '${geckoDep}'`)
  for (const c of linkedTestMods(deps, [fdDep, geckoDep, deps.appleSkin])) extraDeps.push(`    runtimeOnly '${c}'`)
  for (const id of deps.localMods ?? []) extraDeps.push(`    runtimeOnly files('${localJar(id)}')`)
  files.push({
    path: 'build.gradle',
    text: `plugins {
    id 'java-library'
    id 'net.neoforged.moddev' version '${deps.mdg}'
}

version = ${q(meta.version)}
group = '${pkg}'

base {
    archivesName = '${archive}'
}

${toolchain}

neoForge {
    version = '${deps.neoforge}'

    runs {
        client {
            client()
            jvmArgument "-Xmx\${project.findProperty('nkwMem') ?: '4096'}M"
            programArguments.addAll '--username', 'NKW_Tester'
${quickPlay('programArguments.addAll')}        }
        server {
            server()
            programArgument '--nogui'
        }
        configureEach {
            logLevel = org.slf4j.event.Level.INFO
        }
    }

    mods {
        '${ns}' {
            sourceSet(sourceSets.main)
        }
    }
}

repositories {
${MODRINTH_REPO}
}

dependencies {
${extraDeps.join('\n')}
}
`
  })
}

/** The mod's license for the metadata files: an SPDX id, a custom name, or All-Rights-Reserved. */
function licenseId(meta: ProjectMeta): string {
  return meta.license?.trim() || 'All-Rights-Reserved'
}

/** Website / Issues links of the mod (web addresses only). */
function modLinks(meta: ProjectMeta): { homepage?: string; issues?: string } {
  const ok = (s?: string) => (s && LINK_RE.test(s.trim()) ? s.trim() : undefined)
  const out: { homepage?: string; issues?: string } = {}
  if (ok(meta.homepage)) out.homepage = ok(meta.homepage)
  if (ok(meta.issues)) out.issues = ok(meta.issues)
  return out
}

/** "Name - what they made (site.com/page)", like Mod Menu's contributor lines. */
function creditTitle(c: { name: string; work: string; link: string }): string {
  const site = c.link.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return [c.name, c.work].filter(Boolean).join(' - ') + (site ? ` (${site})` : '')
}

/** "Name - what they made (https://…)" for the Forge mod list, where links are clickable. */
function creditLine(c: { name: string; work: string; link: string }): string {
  return [c.name, c.work].filter(Boolean).join(' - ') + (c.link ? ` (${c.link})` : '')
}

/** LICENSE.txt (the license text, or a short notice) and CREDITS.txt, placed at the root of the jar. */
function creditFiles(meta: ProjectMeta): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  const license = licenseId(meta)
  const text = meta.licenseText?.trim()
  if (text) out.push({ name: 'LICENSE.txt', text: text + '\n' })
  else if (license !== 'All-Rights-Reserved') {
    const spdx = /^[A-Za-z0-9.+-]+$/.test(license) ? `\nhttps://spdx.org/licenses/${license}.html` : ''
    out.push({ name: 'LICENSE.txt', text: `${meta.name} is licensed under ${license}.${spdx}\n` })
  }
  const credits = shippedCredits(meta)
  if (credits.length) {
    const lines = [`${meta.name} — credits`, '']
    for (const c of credits) {
      lines.push(c.work ? `${c.name}: ${c.work}` : c.name)
      if (c.folders?.length) lines.push(`  folders: ${c.folders.map((d) => d + '/').join(', ')}`)
      if (c.assets?.length) lines.push(`  files: ${c.assets.join(', ')}`)
      if (c.link) lines.push(`  ${c.link}`)
    }
    out.push({ name: 'CREDITS.txt', text: lines.join('\n') + '\n' })
  }
  return out
}
