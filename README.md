<div align="center">

<img src="build/icon.png" width="96" alt="NKW Mod Studio logo">

# NKW Mod Studio

**Make Minecraft mods by connecting nodes (Unreal Blueprint style) — no code required.**

by **Nam Kueap Wan (NKW)**

[License: zlib](LICENSE)

📖 **User guide:** [English](docs/GUIDE.md) · [Thai](docs/GUIDE.th.md) · 🧩 **Extension authors:** [docs/EXTENSIONS.md](docs/EXTENSIONS.md)

</div>

> [!WARNING]
> **This project is 100% AI-generated.**
> All source code, documentation, tests and assets in this repository were written by an AI (Anthropic's Claude) from the NKW team's instructions. It has been tested (see [Verification](#verification)), but it has **not** been reviewed line-by-line by a human developer. It may contain bugs or unexpected behavior — use it at your own risk and back up your projects and worlds.

---

## Install

Download the installer from the **Releases** page and run it. The app starts small: features such as hand-harvest crops, break rules, Farmer's Delight, thirst values and player skins are **extensions** — open **Settings → Extensions** (or the banner on the home page) and install the official ones, or any extension from a GitHub address. They are downloaded once and work offline afterwards.

## Extensions

| Extension            | Adds                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Roleplay**         | Break Rule (tool & level, tool wear), Regenerating Blocks, Harvest a game crop, the hand-harvest settings of the Crop node, the **Timer window** (elements, gradients, images, animations) and the config file |
| **Farmer's Delight** | Cutting board and cooking pot recipes, Farmer's Delight added to test runs                                                                                                                                     |
| **Thirst**           | Water values for food and drinks in thirst mods                                                                                                                                                                |
| **Skins**            | Player skins from 64 to 2048 pixels, a wardrobe window opened by a key or a block, skins everyone on the server sees, a mouth-open picture, Figura avatar export                                               |

An extension is data only (JSON, templates, pictures): it cannot run code in the app. Writing one: see [docs/EXTENSIONS.md](docs/EXTENSIONS.md) and the template in `extensions/_template`.

## Features

| Area                  | What you can make                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 💎 Items              | Items, food, drinks (potion-style animation and sound), tools & weapons (sword, pickaxe, axe, shovel, hoe), tool materials (optional: tools default to iron), 3D items (3D in hand with an optional 2D inventory icon), items that can be **worn on the head** (right-click — can be turned off — or drag into the helmet slot, pink tooltip line, shown with the model's Blockbench "Head" display), items that place blocks (e.g. seeds → crop)                                                                                                                      |
| 🧱 Blocks             | Cube blocks (all sides / top-side-bottom / pillar), **3D blocks** from Blockbench (hitbox computed from the model, faces the player), custom drops                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🌱 Crops              | Plants with up to 8 growth stages planted by seeds, a set growing time; harvest by breaking (replant like wheat) or pick and let them **grow back after a cooldown**; harvest with a click, by **holding right-click** or by **clicking once and standing still** (moving cancels); the same hand harvest for **Minecraft and Farmer's Delight crops** (or any mod's crop) — normal, self-replanting or back to a stage; a separate **timer window** node built from rectangles, bars, circles, text and images with gradients and animations (the Roleplay extension) |
| 🧟 Mobs & monsters    | Creatures with a spawn egg: a game body (zombie, skeleton, spider, cow, pig) with your skin on every version, or a **3D Blockbench model with idle / walk / attack animations** (GeckoLib, 1.20.1 / 1.21.1); hostile / neutral / friendly, health, attack, speed, armor, drops, natural spawning in the Overworld / Nether / End (1.19.2+)                                                                                                                                                                                                                             |
| 🛡 Armor               | Armor materials (optional: pieces default to iron) + **individual armor pieces** (helmet / chestplate / leggings / boots), 2D or **3D from Blockbench** (`.bbmodel`, GeckoLib `.geo.json` or a Java block/item `.json` — any model can be worn) with animations; adjust **position, rotation and size** on a Steve / Alex preview; the inventory icon can be the 3D model itself                                                                                                                                                                                       |
| ✨ Effects            | 30 status effects, level 1–1000, infinite duration, toggle particles and status icon — on food (when eaten), weapons (on hit) and armor (while worn)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ⚡ Abilities & stats  | Weapons that set targets on fire, call lightning, freeze them, teleport them or clear their effects; food that does the same to whoever eats it; stat bonuses while an item is held, worn or carried (max health, armor, speed, jump, reach, size, gravity … like vanilla attribute modifiers); weapons with their own durability or unbreakable                                                                                                                                                                                                                       |
| 🎞 Animation           | Animated textures, looping GeckoLib animations on 3D armor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 🎵 Sound              | Sound files, sound events, **music discs** (length taken from the audio file, copyright label, hearing range, pop out / loop / stay when the song ends), built-in **MP3 / WAV / MP4 / … → OGG converter**                                                                                                                                                                                                                                                                                                                                                              |
| 🍳 Recipes            | Shaped crafting with a drag & drop 3×3 grid, shapeless crafting, furnace / blast furnace / smoker / campfire, stonecutter, smithing table                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🍲 Farmer's Delight   | _(extension)_ Cutting board and cooking pot recipes (the skillet uses campfire recipes); Farmer's Delight is added automatically when testing                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🗂 Creative tabs       | Multiple tabs with a logo icon; wire any items into a tab, drag to reorder or sort A→Z / Z→A (items not in a tab can be obtained with `/give`)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 💧 Thirst add-on      | _(extension)_ Water values for food and drinks in thirst mods — Tough As Nails, Thirst Was Taken, Thirst Was Taken 2, Legendary Survival Overhaul, Thirsty — without depending on any of them                                                                                                                                                                                                                                                                                                                                                                          |
| 🧍 Skins              | _(extension)_ Player skins of any size from 64 to 2048 pixels on Fabric / Quilt / NeoForge 1.20.1 – 1.21.1: a wardrobe window (key or block), skins every player on the server sees, a mouth-open picture, a sample model and Figura avatar export                                                                                                                                                                                                                                                                                                                     |
| 📜 License & credits  | Pick a license (MIT, Apache, GPL, CC…, or your own text) and credit the people who made your assets (files or whole folders), with links; website / issue links; shown in Mod Menu / the mod list and shipped as `LICENSE.txt` / `CREDITS.txt`                                                                                                                                                                                                                                                                                                                         |
| 🧊 Model editor       | A simple Blockbench built in: cubes moved / scaled / rotated with handles or exact numbers, Blockbench / Maya / Blender control presets or your own mouse and key layout (also editable as JSON in an IDE tab), per-face textures, a UV view with drag-to-arrange and box unwrap, and pixel painting on the model or the texture; saves Java .json models                                                                                                                                                                                                              |
| 🖥 IDE layout          | VS Code-style activity bar, editor tabs, status bar, command palette (Ctrl+Shift+P) and the generated Java / JSON for the selected target, which you can edit (edits are kept in the project and used when building)                                                                                                                                                                                                                                                                                                                                                   |
| 🎮 Test game settings | Window size, fullscreen, FPS, VSync, GUI scale, render distance, volume, brightness, mouse sensitivity, language and key bindings for test runs; AppleSkin added to test runs                                                                                                                                                                                                                                                                                                                                                                                          |
| 📦 Game items         | Every Minecraft and Farmer's Delight item of each version with icons (blocks drawn in 3D) and tags, grouped by what they are used for — drag them in as ingredients                                                                                                                                                                                                                                                                                                                                                                                                    |

**Easy to use:** drag & drop files anywhere · disable nodes without deleting them (Ctrl+E) · remove single wires (click a wire → ×, right-click a wire, or Alt+click a pin) · VS Code–style asset tree (folders, file extensions, rename, move, delete to Recycle Bin) · box selection · undo/redo · autosave · live problem checking · light/dark theme following the system · Thai and English UI · custom mod logo

**Test in game with one click:** press ▶ and the app generates a Gradle project, downloads the Java/Gradle it needs (asks first, checksum-verified) and launches Minecraft with your mod (Fabric/Quilt also get Fabric API + Mod Menu). Or press ⬇ to export a `.jar`.

## Supported loaders and versions

| Minecraft | Fabric | Quilt | Forge | NeoForge |
| --------- | :----: | :---: | :---: | :------: |
| 1.21.4    |   ✓    |   ✓   |   ✓   |    ✓     |
| 1.21.1    |   ✓    |   ✓   |   ✓   |    ✓     |
| 1.20.4    |   ✓    |   ✓   |   ✓   |    ✓     |
| 1.20.1    |   ✓    |   ✓   |   ✓   |    –     |
| 1.19.2    |   ✓    |   ✓   |   ✓   |    –     |
| 1.18.2    |   ✓    |   ✓   |   ✓   |    –     |
| 1.16.5    |   ✓    |   –   |   ✓   |    –     |

- Farmer's Delight: Forge 1.18.2–1.20.1, NeoForge 1.21.1, Fabric/Quilt 1.20.1 and 1.21.1
- Skins: Fabric / Quilt 1.20.1 – 1.21.1 and NeoForge 1.20.4 – 1.21.1
- Timer window images: 1.20.1 – 1.21.1
- 3D armor (GeckoLib): 1.20.1 and 1.21.1 (other versions fall back to 2D armor automatically)
- Minecraft 26.x is not supported yet
- New versions can be added in `src/core/gen/profiles.ts`

## Build from source

Requires [Node.js](https://nodejs.org/) 20.19+ (22 LTS or newer recommended) and Git. Windows 10/11 64-bit is the tested platform.

```bash
git clone https://github.com/Maskbuild/NKW-Mod-Studio.git
cd NKW-Mod-Studio
npm install
npm run dev
```

| Command                                                    | What it does                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                                              | Run the app in development mode (hot reload)                                         |
| `npm run build`                                            | Build the app                                                                        |
| `npm run dist`                                             | Create the Windows installer in `dist/`                                              |
| `npm test`                                                 | Unit tests                                                                           |
| `npm run format`                                           | Format the code with Prettier (`format:check` only checks)                           |
| `npm run typecheck`                                        | TypeScript check                                                                     |
| `npx tsx scripts/verify-matrix.ts build [fabric-1.21.1 …]` | Build a sample mod that uses every node with real Gradle, for every loader × version |
| `npx tsx scripts/smoke-client.ts fabric-1.21.1`            | Launch real Minecraft to check that the sample mod loads                             |

> npm 11 may ask you to allow the install scripts of `electron`, `esbuild` and `ffmpeg-static`: `npm approve-scripts electron esbuild ffmpeg-static`

## Project structure

```
src/core      node graph → IR → validation → Java/JSON generators (shared by main + web worker)
  ext/        the extension system: manifest, template and expression languages, mappings, registry
  gen/profiles.ts   API differences per Minecraft version (add new versions here)
src/main      Electron main process: IPC, projects, extension install, asset import/conversion, Java/Gradle, game launch
src/preload   allowlisted IPC bridge
src/renderer  React UI (home, node canvas, properties panel, 3D preview, editors)
extensions    the official extensions (roleplay, farmers-delight, thirst, skins) and a template
scripts       test fixture, extension validator, release export, real build / in-game test scripts
tests         unit tests (vitest)
docs          user guide (English, Thai) and the extension author guide
```

## Verification

What the code is checked with (run `npm test`):

- Unit tests (compiler, generators for every loader × version, the extension system and install pipeline, Blockbench conversion, path-traversal protection, audio import) and a **snapshot of every file generated for every loader × Minecraft version**, so refactors cannot change a mod unnoticed.
- **Every generated Java file of every target is parsed with the JDK** (syntax check).
- The timer window layout is written twice (TypeScript for the editor preview, Java for the game): the tests **compile the Java with `javac` and compare both drawings** on presets and random documents.

Not checked automatically (needs Gradle and Minecraft): that the generated Java compiles against the game and behaves in a world — in particular the newest features (the Skins extension: mixins, entity data, wardrobe window; images in the timer window) have **not** been run in a game yet. `npm run verify:matrix` builds a sample mod with real Gradle for every target, and `scripts/smoke-client.ts` launches Minecraft with it. Please test and report problems.

## Security

- Electron with `contextIsolation` + `sandbox`, no `nodeIntegration`, strict CSP, Electron Fuses
- Allowlisted IPC channels, every payload validated with zod
- All file access confined to the project folder, atomic saves + 10 backups, deleting moves files to the Recycle Bin
- Downloads only from official sources (Mojang, Adoptium, Gradle, Fabric/Quilt/Forge/NeoForge, Modrinth, GitHub for extensions) over HTTPS; build tools are checksum-verified, extensions are pinned to one commit
- Extensions are data (no scripts or programs are accepted), size-limited, unpacked with zip-bomb and path-traversal protection, and shown to you before they are installed

## License

**[zlib License](LICENSE)** — Copyright © 2026 Nam Kueap Wan (NKW)

In short (the [LICENSE](LICENSE) file is the legally binding text):

- ✅ Free to use, including commercially
- ✅ Modify, customize, build on it and redistribute it
- ✅ **No credit required** (appreciated, though)
- ❌ **Do not claim that you wrote the original software**
- ❌ Modified versions you distribute must be clearly marked as modified and must not be presented as the original
- ❌ Do not remove the license notice from distributed source code

Mods you make with this app are yours — license them however you like.

> Minecraft is a trademark of Mojang Studios / Microsoft. NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
