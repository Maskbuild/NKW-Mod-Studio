# NKW Mod Studio — User Guide

**English** · [ภาษาไทย](GUIDE.th.md)

This guide walks you through NKW Mod Studio from installing it to playing your mod in Minecraft. You don't need to know how to code.

## Contents

1. [Install](#1-install)
2. [Create your first project](#2-create-your-first-project)
3. [The workspace](#3-the-workspace)
4. [Working with nodes and wires](#4-working-with-nodes-and-wires)
5. [Files (assets)](#5-files-assets)
6. [Game items (vanilla and Farmer's Delight)](#6-game-items-vanilla-and-farmers-delight)
7. [Items](#7-items)
8. [Blocks](#8-blocks)
9. [Armor](#9-armor)
10. [Status effects](#10-status-effects)
11. [Sounds and music discs](#11-sounds-and-music-discs)
12. [Recipes](#12-recipes)
13. [Farmer's Delight](#13-farmers-delight)
14. [Creative tabs](#14-creative-tabs)
15. [Java scripts (advanced)](#15-java-scripts-advanced)
16. [Test in game and export a .jar](#16-test-in-game-and-export-a-jar)
17. [Settings](#17-settings)
18. [Keyboard shortcuts](#18-keyboard-shortcuts)
19. [Troubleshooting](#19-troubleshooting)
20. [Walkthrough: a ruby sword from start to finish](#20-walkthrough-a-ruby-sword-from-start-to-finish)

---

## 1. Install

Download from the [Releases page](https://github.com/Maskbuild/NKW-Mod-Studio/releases). There are two options:

| File | Use it when |
|---|---|
| `NKW-Mod-Studio-Setup-x.y.z.exe` | You want a normal install with a Start menu shortcut |
| `NKW-Mod-Studio-x.y.z-win-x64.zip` | You want a portable copy: unzip anywhere and run `NKW Mod Studio.exe` |

Requirements: Windows 10/11 64-bit, an internet connection for the first test (Java, Gradle and Minecraft are downloaded), and a few GB of free disk space.

> If Windows SmartScreen says it protected your PC, click **More info → Run anyway**. The app is new, so Windows doesn't recognize it yet.

You don't need to install Java or Minecraft yourself. The app downloads what it needs and asks you first.

## 2. Create your first project

1. On the **Home** screen, click **New project**, or pick one of the templates under **Start from a template**:
   - **Empty**: a blank canvas.
   - **Starter kit**: an item, a block, a sword and recipes.
   - **Armor set**: an armor material with 4 pieces.
   - **Music disc**: a custom sound and a jukebox disc.
   - **Farmer's Delight**: food with cooking pot and cutting board recipes.
2. Fill in the form:
   - **Mod name**: the name players see, e.g. `Ruby Mod`.
   - **Mod ID**: the internal name. Use only lowercase letters, numbers and `_`, e.g. `ruby_mod`. Don't change it after you've released the mod, or worlds will lose the items.
   - **Authors**, **Description**, **Version**.
   - **Loaders & versions**: tick every Minecraft loader and version you want to build for. You can change this later.
3. Click **Create project** and choose a folder. The app creates a folder called `<name>.nkw`.

A project is just a folder: `project.json` holds the node graph and `assets/` holds your images, models and sounds. To open it again, use **Recent projects** on the Home screen or **Open project** (select `project.json`).

The project **saves automatically**. The dot next to the title shows unsaved changes. Ctrl+S saves immediately. The app also keeps 10 backups.

## 3. The workspace

```
┌──────────────── top bar: Home · Undo/Redo · Target · ▶ Test · ⬇ Export · folder · settings ───┐
│ Left panel     │                                                  │ Right panel          │
│  Nodes         │                 Canvas (node graph)              │  Properties          │
│  Assets        │                                                  │  of the selected     │
│  Game items    │                                                  │  node                │
├────────────────┴──────────────────────────────────────────────────┴──────────────────────┤
│ Bottom dock: Problems · Console                                                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar**
  - **Target** chooses the loader and version used for checking, testing and exporting.
  - **▶ Test in game** (Ctrl+Enter) and **⬇ Export .jar**.
  - The folder button opens the build folder.
  - The gear opens Settings.
- **Left panel**
  - **Nodes**: the node library, searchable. Drag nodes onto the canvas.
  - **Assets**: your project files.
  - **Game items**: every vanilla and Farmer's Delight item.
- **Right panel (Properties)**
  - Shows the selected node's settings.
  - With nothing selected, it shows the **project settings**: name, Mod ID, authors, version, description, **mod logo**, what to do with items that aren't in a creative tab, and the loaders and versions.
- **Problems**
  - Checks your graph live. Errors (red) must be fixed before testing; warnings (yellow) are advice.
  - Click a problem to jump to the node.
  - "No problems — ready to test!" means you're good to go.
- **Console**
  - Shows the Gradle and Minecraft log while building or testing.
  - **🧹 Clean build** deletes the generated build folder for the current target. Use it when a build is stuck or broken.

The bottom dock and the side panels can be resized by dragging their edges.

## 4. Working with nodes and wires

A mod is made of **nodes** connected by **wires**. Each node is one thing (a texture, an item, a recipe…). Wires pass things from an **output** pin (right side) to an **input** pin (left side).

### Adding nodes
- Drag from the **Nodes** library onto the canvas.
- **Right-click** or press **Space** on the canvas to open the quick-add menu. Type to search, then use the arrow keys and Enter.
- **Drag a wire from a pin into empty space** to add a node that's already connected.
- **Drop a file** (PNG, OGG, model…) onto the canvas to import it and create the matching node.

### Connecting
- Drag from a pin to another pin. **Pin colors show the type**, and only matching types connect. For example, a texture pin (orange) only accepts textures, and an item (blue) can also go into an ingredient pin (cyan).

  | Color | Type |
  |---|---|
  | 🔵 blue | Item |
  | 🩵 cyan | Ingredient (items or tags) |
  | 🟠 orange | Texture |
  | 🟣 purple | 3D model / block |
  | 🌸 magenta | 3D armor model |
  | 🟢 green | Sound file / sound event |
  | 🔴 red | Tool material |
  | 🟧 dark orange | Armor material |
  | 🩷 pink | Status effect |
  | 💜 violet | Animation |
  | ⚪ grey | Anything (Reroute) |

- Some nodes have pins that **grow**: when you connect the last free slot, a new one appears. Examples are recipe ingredients and creative tab items.

### Disconnecting
- Click a wire, then click its **×** button.
- **Right-click a wire → Disconnect this wire.**
- **Alt+click a pin** to remove its wires.
- **Right-click a node** to see all its wires (click one to disconnect it) or **Disconnect all wires**.

### Selecting and moving
- Left-drag on empty space draws a selection box. Ctrl+A selects everything.
- Right-drag, middle-drag, or **Space + drag** to pan. Use the mouse wheel to zoom.
- **F** fits the view to everything, or to the selected nodes.
- **Delete** / Backspace deletes. **Ctrl+C / Ctrl+V** copies and pastes (paste goes where the mouse is). **Ctrl+D** duplicates.
- **Ctrl+Z / Ctrl+Y** undo and redo.

### Turning nodes off
**Ctrl+E**, the node's right-click menu, or the switch at the top of Properties turns a node **off**. It stays on the canvas with an **OFF** badge but is left out of the mod. This is handy for trying things without deleting them.

### Tidying up
- **Reroute** is a small dot that bends a wire.
- **Comment** is a colored note on the canvas.

## 5. Files (assets)

The **Assets** tab is a file tree like VS Code:

- **Import…** or drop files onto the window. Images, models, sounds and animations go into the matching folder.
- Drag rows onto folders to move them. Use **New folder** to organize.
- **F2** renames and **Del** deletes. Deleted files go to the Recycle Bin, so you can get them back.
- Drag a file onto the canvas, or use **Add to canvas**, to create its node.

Supported files:

| Kind | Files | Notes |
|---|---|---|
| Texture | `.png` | 16×16 is typical. For animation, stack frames vertically (16×64 = 4 frames). |
| 3D model | `.json` (Java block/item model), `.bbmodel` (Blockbench) | |
| 3D armor model | `.bbmodel`, `.geo.json` (GeckoLib) | A `.json` model also works via the 3D Model node. |
| Animation | `.animation.json` (Blockbench / GeckoLib) | |
| Sound | `.ogg` | Other formats can be converted (below). |

### Converting audio to OGG
Minecraft only plays `.ogg`. Click **Convert** in the Assets tab, choose MP3/WAV/MP4/M4A/FLAC/AAC/WEBM/MOV… files, and they become `.ogg` in your project.
- **Mono** is recommended. Only mono sounds get quieter with distance in game.
- **Volume** adjusts loudness.

## 6. Game items (vanilla and Farmer's Delight)

The **Game items** tab lists every item of the selected Minecraft version, with icons and Thai/English names.

- The first time, click **Load Minecraft items**. It downloads about 25 MB from Mojang once. Farmer's Delight items can be loaded the same way.
- Search by Thai name, English name or ID. Filter by group, or switch to **Tags** (e.g. `minecraft:planks`, meaning any plank).
- **Drag** an item onto the canvas, or **double-click** it, to create an **Existing Item** or **Item Tag** node you can wire into recipes.

You can also add these nodes by hand from **Utility**: **Existing Item** (`minecraft:diamond`, or an item from another mod) and **Item Tag** (`minecraft:planks`).

> Steve/Alex skins for the armor preview also come from these downloaded game files. The app doesn't ship any Mojang files.

## 7. Items

Every item node has:
- **Display name (EN)** and **Display name (TH)**.
- **Registry ID**: lowercase, numbers and `_`. Click **Generate from name** to fill it in.

The Properties panel also shows the `/give` command for the item.

### Item
A simple item.
- **Inputs**
  - **Icon texture**.
  - **3D model** (optional): the item looks 3D in the hand. The icon texture, if any, stays as the inventory icon.
  - **Places block** (optional): using the item places a block, like seeds placing a crop.
- **Properties**
  - Max stack (1–64).
  - Rarity (name color).
  - Fire resistant.
  - Enchant glint.
  - Held like a tool.
  - **Can be worn on the head** (see below).

### Food
Like Item, plus:
- Hunger restored, saturation, edible when full, eat fast.
- Up to 3 **Effect when eaten** pins.

### Tool / Weapon
A sword, pickaxe, axe, shovel or hoe.
- **Inputs**
  - Texture.
  - **Material** (optional; iron if empty).
  - 3D model.
  - Up to 3 **Effect on hit target** pins.
- **Properties**: tool type, extra attack damage, attack speed, fire resistant, rarity, wear on head.

### Tool Material
Shared stats for a set of tools: durability, mining speed, attack damage bonus, mining level (wood → netherite), enchantability. It also has a **Repair with** ingredient pin (used in the anvil). Wire its output into the **Material** pin of each tool.

### Items worn on the head
Turn on **Can be worn on the head** for an Item, Food or Tool. Players can then:
- right-click to put it on (switch off **Right-click to put on** if you only want the next option), or
- drag or shift-click it into the helmet slot.

The tooltip shows a pink line saying it can be worn. If the item has a 3D model, it's displayed using the model's **Head** display settings from Blockbench (Display → Head).

## 8. Blocks

Both block nodes have two outputs:
- **Block item**: the item you hold (use it in recipes and tabs).
- **Block (to place)**: wire it into an item's **Places block** pin.

### Block
A full cube.
- **Texture layout**:
  - *Same on all sides*.
  - *Top / sides / bottom*: wire the **Top** and **Bottom** textures too.
  - *Pillar*: like a log, and it rotates.
- **Drops** pin: what it drops. Empty = itself.

### 3D Block
A block that uses a Blockbench model (wire a **3D Model** node into **Model**).
- The hitbox is calculated from the model.
- **Faces the player when placed**.
- **Has collision**.

### Shared block settings
- Has its own block item (turn off for crops placed by seeds).
- Hardness, blast resistance, sound type, light level (0–15).
- Mined with (pickaxe/axe/shovel/hoe/hand) and tool level.
- Requires tool to drop.
- Drop count min/max.

### 3D Model node
Load a `.json` or `.bbmodel` file. The **Texture #0–#3** pins match the model's texture slots in order. The same node is used for 3D items, 3D blocks and armor.

## 9. Armor

### Armor Piece
One wearable piece. It works on its own, with iron stats and an iron look.
- **Inputs**
  - **Armor material** (optional).
  - **Icon texture**.
  - **3D model**: `.bbmodel`, `.geo.json`, or a 3D Model node with a `.json` model.
  - Up to 3 **Effect while worn** pins.
- **Slot**: helmet, chestplate, leggings or boots.
- **Inventory icon**:
  - *Icon texture (2D)*, or
  - *The 3D model*: shown like a block in the inventory.
- **Fit on the player**
  - A 3D preview on Steve or Alex.
  - Adjust **position** (pixels; 16 = 1 block), **rotation** (degrees) and **size**. Tick **Same on all axes** to scale evenly.
  - Drag in the preview to look around. **Reset** restores the defaults.
  - You can pick any 64×64 skin PNG in your project as the preview skin.

### Armor Material
Shared stats for a set:
- Durability multiplier and protection for each slot.
- Enchantability, toughness, knockback resistance, equip sound, repair ingredient.
- **Worn texture layer 1** (helmet, chestplate, boots) and **layer 2** (leggings). These are 2D armor textures in the vanilla layout.

### 3D armor
- **3D Armor Model** node: a `.bbmodel` or `.geo.json`.
  - Armor templates use the bones `armorHead`, `armorBody`, `armorRightArm`/`LeftArm`, `armorRightLeg`/`LeftLeg` and `armorRightBoot`/`LeftBoot`.
  - Any other model is attached to the body part of the piece automatically.
- **GeckoLib Animation** node: an `.animation.json`. Pick the animation to loop while the armor is worn.
- 3D armor uses GeckoLib, which is added automatically. It works on 1.20.1 and 1.21.1; other versions fall back to 2D armor.

## 10. Status effects

The **Status Effect** node is one potion effect (30 to choose from). Wire it into:
- Food → when eaten.
- Tool / Weapon → on hit (applied to the target).
- Armor Piece → while worn (refreshed constantly).

Settings:
- Level (1–1000).
- **Infinite duration** or a duration in seconds.
- Chance (0–1).
- Show particles.
- Show status icon.

## 11. Sounds and music discs

1. **Sound File** node: one `.ogg` file.
2. **Sound Event** node: a sound the game can play.
   - Wire 1–4 sound files. With several, the game picks one at random.
   - Settings: Sound ID, subtitle (EN/TH), volume, pitch.
   - Turn on **Stream** for long music.
3. **Music Disc** node: wire the sound event into **Song**, plus a texture.
   - **Song title** (artist - title, EN/TH).
   - **Length from the audio file** (automatic), or set it in seconds.
   - **Copyright status** shown on the disc.
   - **Comparator output** (1–15).
   - **Hearing range** in blocks.
   - **When the song ends**:
     - *Pop the disc out*.
     - *Loop*.
     - *Stay in the jukebox* (vanilla behavior).
     - Pop out and loop only work when a player inserts the disc by hand, not through hoppers.

## 12. Recipes

Recipe nodes take **Ingredient** pins on the left and a **Result** pin on the right.

| Node | How it works |
|---|---|
| **Shaped Crafting** | Wire up to 9 ingredients, then in Properties **drag them onto the 3×3 grid** (or click an ingredient, then a cell). On the grid: click a cell to clear it, drag to move, drag out to remove. Empty cells stay empty in the recipe. Set the result count. |
| **Shapeless Crafting** | Up to 9 ingredients in any position. |
| **Furnace / Smelting** | Choose furnace, blast furnace, smoker, or campfire (also the Farmer's Delight skillet). Set XP and cook time (ticks; 20 = 1 second). |
| **Stonecutter** | One input → result × count. |
| **Smithing Table** | Template (1.20+), base and addition → result. |

Ingredients can be your own items, **Existing Item** nodes, or **Item Tag** nodes.

## 13. Farmer's Delight

| Node | Settings |
|---|---|
| **Cutting Board** | One input. Tool: knife, axe, pickaxe, shovel or shears. Up to 4 results, each with a count and a chance. |
| **Cooking Pot** | Up to 6 ingredients, an optional container (e.g. a bowl), the result and count, XP, cook time, and recipe book tab (meals/drinks/misc). |

Farmer's Delight is **added automatically** when you test. It's available on Forge 1.18.2–1.20.1, NeoForge 1.21.1, and Fabric/Quilt 1.20.1 and 1.21.1. On other targets these recipes are skipped, and you'll see a warning in Problems.

## 14. Creative tabs

The **Creative Tab** node makes a tab in the creative inventory.
- **Icon**: wire a **Logo texture**, or an **Icon item** instead.
- Wire items into the **Item** pins. A new pin appears each time.
- **Item order** in Properties lists the tab contents. **Drag rows** to reorder, or use **A→Z / Z→A** to sort by name.
- Settings: Tab ID, title (EN/TH).

Items not wired into any tab are handled by the project setting **Items not connected to a Creative Tab**:
- *Hidden*: only obtainable with `/give`.
- *Put them in a main tab automatically*.

## 15. Java scripts (advanced)

The **Java Class (Script)** node lets you add a real Java source file to your mod, written the same way as in any Minecraft mod. Use it for behavior the nodes don't cover. You need to know Java and the loader's API.

- **Use for**: pick the loaders and versions the file is written for. None = all. Java APIs differ between loaders and versions, and the file is left out of builds for other targets.
- **Your mod's own classes are available**: `NkwMod` (with `MOD_ID`), `ModItems`, `ModBlocks`, `ModSounds`.
- **Forge / NeoForge**: put `@EventBusSubscriber` on the class and `@SubscribeEvent` on event methods.
- **Fabric / Quilt**: `implements ModInitializer` (or `ClientModInitializer`). The app registers the class as an entrypoint for you.
- **The editor works like an IDE**:
  - Highlighting and live checks.
  - Completion while typing. Classes are **imported automatically**. Ctrl+Space shows suggestions.
  - Hover a class to see its package.
  - Ctrl+F searches.
  - The expand button opens a large editor.
- **Insert an example…**: replaces the code with a ready-made class written for the selected loader and version.
- **Check code**: compiles the mod with Gradle for the selected target. Java errors are underlined on their lines.
- On the canvas, the node shows the class name, its targets and a preview of the first lines.
- The class name must not clash with the classes the app generates. Problems will tell you if it does.

## 16. Test in game and export a .jar

### ▶ Test in game
1. Pick the **Target** (loader + version) in the top bar.
2. Make sure **Problems** has no errors.
3. Click **▶ Test in game**, or press Ctrl+Enter. The app:
   - generates a Gradle project for that target;
   - downloads the right Java (it **asks first**; downloads are checksum-verified) and Gradle;
   - launches Minecraft with your mod. Fabric/Quilt also get Fabric API and Mod Menu.
4. Watch progress in **Console**. Click **Stop** to close the game.

> **The first test of each target takes a while** (several minutes, and several GB of downloads for Minecraft and libraries). Later tests are much faster.

In game, find your items in your creative tab, or use the `/give` command shown in Properties.

### ⬇ Export .jar
Click **⬇ Export .jar**. When the build finishes, choose where to save the `.jar`. Put it in a Minecraft `mods` folder with the matching loader (plus Fabric API on Fabric/Quilt, and Farmer's Delight or GeckoLib if your mod uses them).

To release for several versions, switch **Target** and export once per target.

## 17. Settings

Open with the gear button.

- **Theme**: System / Light / Dark.
- **Language**: ไทย / English.
- **Game memory (RAM)** for testing: 1–16 GB.
- **Download Java/Gradle automatically when needed**.
- **Java installations** found on your PC.

## 18. Keyboard shortcuts

| Keys | Action |
|---|---|
| Space / right-click | Add node (quick-add menu) |
| Ctrl+S | Save now |
| Ctrl+Enter | Test in game |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / Redo |
| Ctrl+C / Ctrl+V | Copy / Paste at the mouse |
| Ctrl+D | Duplicate |
| Ctrl+E | Turn selected nodes off/on |
| Ctrl+A | Select all |
| Delete / Backspace | Delete selected |
| F | Fit view (selection or everything) |
| Alt+click pin | Disconnect that pin's wires |
| Space + drag, right/middle drag | Pan |
| F2 / Del (Assets) | Rename / Delete file |
| Ctrl+Space / Ctrl+F (script editor) | Suggestions / Search |

## 19. Troubleshooting

| Problem | What to do |
|---|---|
| ▶ says "Fix the errors in Problems first" | Open **Problems** and fix the red items (missing texture, duplicate ID, empty required pin…). |
| Build fails | Read the red lines in **Console**. Try **🧹 Clean build**, then test again. |
| The first test is very slow | That's normal: Minecraft and Gradle are being downloaded. Keep the internet on. |
| The game runs out of memory or is laggy | Increase **Game memory** in Settings. |
| Item shows as a purple-black cube | Its texture or model isn't connected, or the model refers to a texture slot that isn't wired. |
| A 3D armor shows as 2D | 3D armor only works on 1.20.1 and 1.21.1. |
| Farmer's Delight recipes are missing | The selected target has no Farmer's Delight version (see section 13). |
| Sound doesn't fade with distance | Convert it again with **Mono** on. |
| Script error in Check code | The underlined line shows the javac error. Make sure the code fits the selected loader and version. |
| Windows SmartScreen warning | **More info → Run anyway**. |

To report a bug, open an issue on [GitHub](https://github.com/Maskbuild/NKW-Mod-Studio/issues) with the Console log.

## 20. Walkthrough: a ruby sword from start to finish

1. **New project** → template **Empty** → name `Ruby Mod`, ID `ruby_mod`, target **Fabric 1.21.1** → Create.
2. Drop `ruby.png` and `ruby_sword.png` onto the canvas. Two **Texture** nodes appear.
3. Add an **Item** node: name `Ruby`, click **Generate from name** → `ruby`. Wire `ruby.png` into **Icon texture**.
4. Add a **Tool Material** node: durability 1200, damage 3, level diamond. Wire the Ruby item into **Repair with**.
5. Add a **Tool / Weapon** node: type Sword, name `Ruby Sword`. Wire `ruby_sword.png` into **Texture** and the material into **Material**.
6. Optional: add a **Status Effect** node (Slowness, 3 seconds) and wire it into **Effect on hit target 1**.
7. Recipe:
   - Add a **Shaped Crafting** node.
   - Wire **Ruby** into Ingredient 1.
   - From **Game items**, drag `Stick` onto the canvas and wire it into Ingredient 2.
   - In Properties, place ruby, ruby, stick down the middle column.
   - Wire the sword into **Result**.
8. Add a **Creative Tab** node: title `Ruby Mod`. Wire `ruby.png` into **Logo texture**, then the Ruby and the sword into the item pins.
9. Check **Problems** → "No problems". Click **▶ Test in game**.
10. In game, open the creative inventory → **Ruby Mod** tab. Craft the sword, hit a mob, and it gets slowed.
11. Happy with it? Click **⬇ Export .jar** and share your mod.

Have fun making mods! — **Nam Kueap Wan (NKW)**
