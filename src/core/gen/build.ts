import { NKW_ICON_PNG_BASE64 } from './icon'
import { RES, json, type GenCtx } from './types'

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

/** Gradle build + mod metadata files. */
export function genBuild(ctx: GenCtx): void {
  const { ir, loader, p, deps, files, ns, pkg } = ctx
  const meta = ir.meta
  const archive = `${ns}-${loader}-${p.mc}`
  const q = (s: string) => JSON.stringify(s)
  const extraDeps: string[] = []
  // mod logo: the project's uploaded texture, else the default NKW logo
  const logo = (path: string) => files.push(meta.icon ? { path, copy: meta.icon } : { path, base64: NKW_ICON_PNG_BASE64 })
  logo(`${RES}/assets/${ns}/icon.png`)
  if (loader === 'forge' || loader === 'neoforge') logo(`${RES}/nkw_logo.png`)
  // 1.20+: jump straight into the test world once the user has created it
  const quickPlay = (call: string) =>
    p.smithingTransform ? `            if (file('run/saves/NKW Test').exists()) ${call} '--quickPlaySingleplayer', 'NKW Test'
` : ''

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
${p.java > 8 ? `    options.release = ${p.java}
` : ''}}`

  const quiltRepo =
    loader === 'quilt'
      ? `
    maven {
        name = 'Quilt'
        url = 'https://maven.quiltmc.org/repository/release/'
        content { includeGroupAndSubgroups 'org.quiltmc' }
    }`
      : ''
  const fdDep = ctx.fd && deps.farmersDelight ? deps.farmersDelight : null
  const geckoDep = ctx.gecko && deps.geckolib ? deps.geckolib : null

  if (loader === 'fabric' || loader === 'quilt') {
    // Quilt Loom lags behind the Loom versions current mods are built with, so Fabric Loom (which also
    // understands quilt_installer.json) is used for Quilt too.
    const plugin = `id 'net.fabricmc.fabric-loom-remap' version '${deps.loom}'`
    const loaderDep =
      loader === 'fabric' ? `modImplementation 'net.fabricmc:fabric-loader:${deps.fabricLoader}'` : `modImplementation 'org.quiltmc:quilt-loader:${deps.quiltLoader}'`
    if (loader === 'quilt') for (const lib of deps.quiltLibraries ?? []) extraDeps.push(`    runtimeOnly '${lib}'`)
    // Mod Menu is added to test runs so the mod list / config screen is available in game
    if (deps.modMenu) extraDeps.push(`    modRuntimeOnly '${deps.modMenu}'`)
    if (fdDep) extraDeps.push(`    modRuntimeOnly '${fdDep}'`)
    if (geckoDep) extraDeps.push(`    modImplementation '${geckoDep}'`)
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
          authors: meta.authors ? meta.authors.split(',').map((s) => s.trim()).filter(Boolean) : ['Nam Kueap Wan (NKW)'],
          license: 'All-Rights-Reserved',
          environment: '*',
          icon: `assets/${ns}/icon.png`,
          entrypoints: { main: [`${pkg}.NkwMod`], client: [`${pkg}.NkwClient`] },
          depends: {
            fabricloader: '>=0.14.0',
            minecraft: mcRange,
            java: `>=${p.java}`,
            [apiId]: '*',
            ...(geckoDep ? { geckolib: '*' } : {})
          }
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
              )
            },
            intermediate_mappings: 'net.fabricmc:intermediary',
            entrypoints: { main: `${pkg}.NkwMod`, client: `${pkg}.NkwClient` },
            depends: [
              { id: 'quilt_loader', versions: '>=0.17.0' },
              { id: 'minecraft', versions: mcRange },
              apiId,
              ...(geckoDep ? ['geckolib'] : [])
            ]
          }
        })
      })
    return
  }

  // ── Forge / NeoForge metadata ──
  const toml = `modLoader="javafml"
loaderVersion=${q(loader === 'forge' ? FORGE_LOADER_RANGE[p.mc] : '[1,)')}
license="All Rights Reserved"

[[mods]]
modId=${q(ns)}
version=${q(meta.version)}
displayName=${q(meta.name)}
authors=${q(meta.authors || 'Nam Kueap Wan (NKW)')}
description=${q(meta.description || meta.name)}
logoFile="nkw_logo.png"
`
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
    if (geckoDep) extraDeps.push(`    implementation ${deobf(geckoDep)}`)
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
${MODRINTH_REPO}
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
  if (geckoDep) extraDeps.push(`    implementation '${geckoDep}'`)
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
