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
10. [Mobs and monsters](#10-mobs-and-monsters)
11. [Status effects](#11-status-effects)
12. [Sounds and music discs](#12-sounds-and-music-discs)
13. [Recipes](#13-recipes)
14. [Farmer's Delight](#14-farmers-delight)
15. [Creative tabs](#15-creative-tabs)
16. [Java scripts (advanced)](#16-java-scripts-advanced)
17. [Test in game and export a .jar](#17-test-in-game-and-export-a-jar)
18. [Settings](#18-settings)
19. [Keyboard shortcuts](#19-keyboard-shortcuts)
20. [Troubleshooting](#20-troubleshooting)
21. [Walkthrough: a ruby sword from start to finish](#21-walkthrough-a-ruby-sword-from-start-to-finish)

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

### License and credits

Click an empty spot on the canvas so nothing is selected. The right panel then shows the project settings, including:

- **License**: what others may do with your mod.
  - Pick a common one (All rights reserved, MIT, Apache 2.0, GPL 3.0, LGPL 3.0, MPL 2.0, zlib, CC0, CC BY / BY-SA / BY-NC / BY-NC-SA), or choose **Other** and type a name.
  - **Add the full license text** if you want it shipped as `LICENSE.txt` inside the jar. Otherwise a short notice with a link to the license is included (nothing for "All rights reserved").
- **Credits**: the people who made textures, models, sounds and so on. Click **Add a credit** and fill in:
  - **Name** (required).
  - **What they made**, e.g. "Ruby texture".
  - **Link** to their page. It must start with `https://` or `http://`, or it is left out.
  - **Link a project file**: the files they made (optional). You can also pick a **folder**: every file in it counts, including files you add later.

Both appear in Mod Menu and the mod list (`fabric.mod.json`, `quilt.mod.json`, `mods.toml`) in separate sections: **License**, then **Credits** with the authors and one line per contributor, e.g. "Reff Pixels - app icons (reffpixels.itch.io)". The credits are also saved as `CREDITS.txt` inside the jar.

You can also fill in a **Website link** and an **Issue tracker link**. They become the Website / Issues buttons in Mod Menu and the mod list.

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

### IDE layout (like VS Code)

The layout button in the top bar (or the status bar) switches between the **IDE layout** and the classic layout.

- **Activity bar** on the far left: Nodes, Game items, Files and **Code**. Click an icon to show it in the side bar; click it again to hide the side bar.
- **Editor tabs**: the node graph is always the first tab. Generated code files and 3D models open in their own tabs. Middle-click or × closes a tab; a ● means unsaved changes.
- **Code** view: the Gradle project "Test in game" builds for the selected target (Java, JSON, lang files…), made from your nodes. It updates by itself while you edit the graph.
  - **You can edit these files.** An edited file is marked ✎, kept in the project (for that loader and version) and used instead of the generated one when you test or export. Changes to the nodes no longer update that file; **Revert to generated** drops your edit. For your own new classes, use a Java Class node.
- **Status bar** at the bottom: problems (click for the list), target, build progress, cursor position in a code file, saved state.
- **Command palette**: Ctrl+Shift+P runs any command (test, export, new 3D model, switch target, show/hide panels …). Ctrl+P opens a generated file by name.

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
| 3D model | `.json` (Java block/item model), `.bbmodel` (Blockbench) |  |
| 3D armor model | `.bbmodel`, `.geo.json` (GeckoLib) | A `.json` model also works via the 3D Model node. |
| Animation | `.animation.json` (Blockbench / GeckoLib) |  |
| Sound | `.ogg` | Other formats can be converted (below). |

### Model editor (3D models)

A simple Blockbench built in. Create a model with **🧊 Model** in the Files toolbar (or "New 3D model" in the command palette), or open one: right-click a `models/….json` file → **Edit in the model editor**, or the **Edit in the model editor** button of a 3D Model node (it uses the textures wired into the node).

- **Cubes** (left): add, copy, delete and rename cubes. Click a cube in the 3D view to select it.
- **Tools**: Select, Move, Scale, Rotate and Paint. Drag the arrows / handles / rings; **Snap** sets the step (1 px by default). Or type exact numbers on the right: **From** / **To** in pixels (16 = 1 block, the purple box is one block).
- **Rotation**: one axis, −45° to 45° in 22.5° steps (what Minecraft allows), with the Rotate tool or on the right.
- **Controls**: the mouse and keys follow the layout chosen in **Settings → Model editor** (the 🎮 button in the editor's top bar opens it). Presets:

  |  | Blockbench (default) | Maya | Blender |
  |---|---|---|---|
  | Turn the view | left-drag (in Paint: right-drag) | Alt + left-drag | middle-drag |
  | Pan | right-drag | Alt + middle-drag | Shift + middle-drag |
  | Zoom | wheel | wheel or Alt + right-drag | wheel or Ctrl + middle-drag |
  | Select / Move / Scale / Rotate / Paint | V / G / S / R / B | Q / W / R / E / B | W / G / S / R / B |
  | Frame selected / everything | F / A | F / A | . / Home |

  Change any of it after picking a preset (it becomes **Custom**): which button and key turn, pan and zoom, turning the other way (left/right, up/down) and zooming the other way, the speeds, and every tool key (click the key box, then press a key). The **As code** box shows the same settings as JSON, and the `{ }` button opens them as `model-controls.json` in an IDE tab, where you can edit them like code (valid changes apply at once).

- **Faces**: pick a face, turn it on or off, choose its texture slot, turn its texture, and use automatic UV (from the cube size) or type the UV.
- **Textures**: slots #0–#3 point at project textures; **New texture** makes an empty 16×16, 32×32 or 64×64 PNG.
- **Paint**: pencil, eraser, fill, colour picker and recent colours. Paint straight on the model or on the texture.
- **UV view** (switch **3D / UV / 3D + UV**): the texture of the selected slot with every face that uses it outlined (N S E W U D, the selected face in orange). Click a face to select it, drag it to move its UV, drag its corner to resize, all snapped to texture pixels. **Unwrap cube** / **Unwrap all** lay the faces out as unfolded boxes (top and bottom over the four sides) so you can paint them; **Automatic UV** goes back to Minecraft's automatic UV.
- **Save** (Ctrl+S) writes the `.json` model and the painted PNGs. Ctrl+Z / Ctrl+Y undo and redo. To use the model, add a 3D Model node with it and wire its textures in order (#0, #1 …).

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
- **Eating sound**:
  - _Eat_: munching.
  - _Drink_: gulping, and the item is held up like a potion.
- Up to 3 **Effect when eaten** pins.
- Up to 3 **Ability when eaten** pins: freeze like powder snow, set on fire, lightning, random teleport, clear all effects (see section 11).
- A **Thirst (add-on)** pin (see below).

### Thirst (add-on)

Found under **Add-ons (other mods)** in the node library. Wire it into a Food node to give that food or drink a water value in thirst mods:

| Setting | Meaning |
|---|---|
| **Thirst restored** | 1–20 points on the thirst bar, like hunger (a water bottle is about 6) |
| **Hydration** | 0–20. Like food saturation: hidden water used up before the bar drops ("quenched" in Thirst Was Taken) |

Your mod **does not need** any of these mods. When a player has one installed, eating or drinking the food also restores thirst:

| Mod | Versions | How it works |
|---|---|---|
| Tough As Nails | 1.18.2 and newer | item tags (hydration rounded to 10 % steps) |
| Thirst Was Taken | Forge 1.18.2–1.20.1, NeoForge 1.21.1 | its registration event (food vs drink follows the Eating sound) |
| Thirst Was Taken 2 | 1.20.1 and 1.21.1 | a data file |
| Legendary Survival Overhaul | Forge 1.20.1, NeoForge 1.21.1 | a data file |
| Thirsty – Thirst System | Fabric/Quilt 1.20.1 | added to its item list when a world starts |

### Tool / Weapon

A sword, pickaxe, axe, shovel or hoe.

- **Inputs**
  - Texture.
  - **Material** (optional; iron if empty).
  - 3D model.
  - Up to 3 **Effect on hit target** pins.
  - Up to 3 **Hit ability** pins (fire, lightning, freeze; see section 11).
  - **Stat bonus** pins (see section 11).
- **Properties**: tool type, extra attack damage, attack speed, fire resistant, rarity, wear on head.
- **Durability**: how many uses before it breaks (0 = the material's). Turn on **Unbreakable** and it never loses durability (the tooltip says "Unbreakable").

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
  - _Same on all sides_.
  - _Top / sides / bottom_: wire the **Top** and **Bottom** textures too.
  - _Pillar_: like a log, and it rotates.
- **Drops** pin: what it drops. Empty = itself.

### 3D Block

A block that uses a Blockbench model (wire a **3D Model** node into **Model**).

- The hitbox is calculated from the model.
- **Faces the player when placed**.
- **Has collision**.

### Crop (plant)

Category **Farming**. A plant that grows in up to 8 stages.

- **Growth stage 1–8** pins: one texture per stage (the last one wired is fully grown). **Harvest** pin: the item you get.
- Wire its **Block (for the seeds)** output into a seeds Item's **Places block** pin; the seeds plant the crop.
- **Look**: `#` like wheat, or `X` like a flower / berry bush. **Grows on**: farmland, or farmland, dirt and grass.
- **Time to grow**: seconds until fully grown (0 = random like wheat).
- **After harvest**:
  - _Gone: plant the seeds again_ (like wheat). Breaking it gives the harvest and some seeds back (**Seeds back min / max**).
  - _Stays and grows back_: picking it gives the harvest, then it goes back to the stage you choose and grows again after the **cooldown**.
- **How to harvest**: break it, right-click, **hold right-click** for the harvest time, or **right-click once and stand still** for the harvest time (moving cancels and you must click again). While harvesting, a timer shows on screen; wire a **Harvest timer look** node into **Harvest timer look** to choose how it looks (without one: text above the hotbar).
- **Harvest count min / max**.
- **When a player breaks it**: _drops like normal_, _drops only when fully grown_ (breaking a young plant gives nothing, not even the seed), or _gives nothing_ (only picking by hand gives the harvest — pair it with a right-click harvest). Picking by hand is never affected, and neither is creative mode.

### Harvest a game crop

Gives a crop of Minecraft, Farmer's Delight or another mod the same hand harvest. It still grows like in the game, and breaking it still works as usual.

- **Crop**: wheat, carrots, potatoes, beetroots, nether wart, sweet berry bush, cocoa, or Farmer's Delight cabbages, onions, tomatoes and rice. **Another block** takes any block ID with an `age` property (a crop of another mod).
- **How to harvest**: right-click, hold right-click, or right-click once and stand still, with the **harvest time**.
- **After harvest**:
  - _Like the game / the mod_: berries and tomatoes are picked and stay; everything else breaks like when you break it (the normal drops).
  - _Replants itself_: the normal drops minus one seed, and the crop starts again from the beginning.
  - _Stays and goes back to a stage_: the normal drops, then it goes back to the stage you choose and grows again like in the game.
- **Harvest goes into the inventory**: off = drops on the ground like normal; on = straight into the inventory (what does not fit drops at your feet). The Crop node has the same option for hand harvests.
- **When a player breaks it**: the same three choices as the Crop node, e.g. _gives nothing_ so players must pick it by hand.
- One node per crop. Farmer's Delight crops only exist on targets that have Farmer's Delight (the Problems panel tells you), and Farmer's Delight is added to "Test in game" for you.

### Harvest timer look

How the harvest timer looks on screen. Wire its output into the **Harvest timer look** pin of Crop or Harvest a game crop nodes; one look can be used by many crops. The right panel shows a live preview on a pretend game screen.

- **Template**:
  - _Text_: `Harvesting ■■■□□□□□□□ 1.2 s` (the look from before).
  - _Bar that fills up_.
  - _Circle that fills around the crosshair_ (clockwise from the top).
- **Colour**, and for the bar and circle a **background colour** and **background opacity**.
- Text and bar: **position** (under the crosshair, above the hotbar, top of the screen) and **move down** (negative = up).
- Bar: **width** and **height**. Circle: **size** (radius) and **line thickness**; as thick as the size gives a filled circle.
- **Show the seconds left**.

### Break Rule (tool & level)

Category **Blocks**. Makes blocks need a certain tool and mining (ore) level — for blocks of Minecraft, of other mods and of your own mod.

- **Blocks (pick any number)**: tick blocks in the list (type to search; **Tick all … found** ticks every result, e.g. search `ore`), add ids of other mods such as `othermod:ruby_ore` (several at once, separated by spaces or commas), add tags such as `#minecraft:logs`, or drag blocks here from the **Game items** tab. Your own blocks: tick them in the list or wire their **Block** pin into the **Mod block** pins.
- **Required tool**: pickaxe, axe, shovel, hoe, sword, shears, or _any tool_ (only the level counts).
- **Minimum level (ore level)**: wood/gold, stone, iron, diamond or netherite and better. Tools of your mod count with their Tool Material's mining level.
- **With the wrong tool**: _it breaks but drops nothing_ (like stone mined by hand), or _it cannot be broken_.
- **Tell the player which tool is needed**: a red message above the hotbar, written for you (e.g. "Needs an iron pickaxe or better to drop anything"), or your own text in English and Thai.
- Creative mode is never stopped. A block in two rules follows the first one. Block tags need Minecraft 1.18.2 or newer; on 1.21.2+ swords have no mining level, so any sword counts.

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
  - _Icon texture (2D)_, or
  - _The 3D model_: shown like a block in the inventory.
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

## 10. Mobs and monsters

The **Mob / Monster** node (category _Mobs & monsters_) adds a creature with its own spawn egg (its output: use it in tabs and recipes).

- **Body**:
  - A game body with your **Skin** texture (all versions): _Zombie_, _Skeleton_, _Spider_ (hostile), _Cow_, _Pig_ (friendly). Paint the skin over the game's own skin layout (from your downloaded game files) so it fits.
  - _3D model_: a Blockbench model through GeckoLib (1.20.1 and 1.21.1). Wire a **3D Armor Model (Blockbench)** node with the model, texture and animation file into **3D model**. Set the **hitbox width / height** and the names of the **idle**, **walk** and **attack** animations (as written in the animation file; empty = none). On other versions the mob uses the zombie body (or the pig body when friendly) with the **Skin**, and the Problems panel says so.
- **Behavior** (3D model): _Hostile_ attacks players, _Neutral_ fights back when hit, _Friendly_ wanders and runs away when hit. Game bodies keep their own behavior.
- **Health** (2 = 1 heart), **attack damage**, **speed**, **armor**.
- **Spawns naturally in** the Overworld, the Nether or the End (1.19.2 and newer), with the spawn **weight** (a zombie is 100) and the **group size**. Older versions: spawn egg only.
- **Drops**: up to 3 items, each with a count min / max.
- **Spawn egg colours**: base and spots.

## 11. Status effects

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

### Ability (on hit / when eaten)

Wire it into a Tool / Weapon's **Hit ability** pins (it happens to the target that is hit) or a Food's **Ability when eaten** pins (it happens to whoever eats it).

| Ability | What it does |
|---|---|
| Set on fire | The target burns for the duration |
| Summon lightning | A lightning bolt strikes the target |
| Freeze | The target freezes like in powder snow and is slowed (1.16.5: slowness only) |
| Random teleport | Teleports up to 8 blocks away, like a chorus fruit |
| Clear all effects | Removes every status effect, like milk |

Settings: duration in seconds (fire and freeze) and chance (0–1; e.g. 0.25 = one hit in four).

### Stat Bonus (attribute)

Changes a stat of the player while the item is held, worn or carried, like the attribute modifiers of vanilla items. Wire it into the **Stat bonus** pins of an Item, Food, Tool / Weapon or Armor Piece (a new pin appears each time, up to 8).

- **Stat**:
  - Every version: max health, armor, armor toughness, attack damage, attack speed, attack knockback, knockback resistance, movement speed, luck.
  - 1.20.4 and newer: max absorption.
  - 1.21.1 and newer: jump strength, block reach (mine / place far), attack reach, block break speed, size (scale), step height, gravity, safe fall distance, fall damage multiplier, burning time, explosion knockback resistance, mining efficiency, movement efficiency, oxygen bonus, sneaking speed, underwater mining speed, sweeping damage, water movement.
  - On older targets a stat that does not exist yet is left out, with a warning in Problems.
- **Amount**: negative lowers the stat. Max health: 2 = one heart.
- **How it adds up**: add the amount, or a percent of the base value / of the total (0.5 = +50 %).
- **Active when**:
  - _Auto_: armor while worn in its slot, other items in the main hand.
  - Or main hand, off hand, either hand, a worn slot (head / body / legs / feet), or anywhere in the inventory.
- **Show in the item tooltip**: adds lines like "When in Main Hand: +4 Max Health".

## 12. Sounds and music discs

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
     - _Pop the disc out_.
     - _Loop_.
     - _Stay in the jukebox_ (vanilla behavior).
     - Pop out and loop only work when a player inserts the disc by hand, not through hoppers.

## 13. Recipes

Recipe nodes take **Ingredient** pins on the left and a **Result** pin on the right.

| Node | How it works |
|---|---|
| **Shaped Crafting** | Wire up to 9 ingredients, then in Properties **drag them onto the 3×3 grid** (or click an ingredient, then a cell). On the grid: click a cell to clear it, drag to move, drag out to remove. Empty cells stay empty in the recipe. Set the result count. |
| **Shapeless Crafting** | Up to 9 ingredients in any position. |
| **Furnace / Smelting** | Choose furnace, blast furnace, smoker, or campfire (also the Farmer's Delight skillet). Set XP and cook time (ticks; 20 = 1 second). |
| **Stonecutter** | One input → result × count. |
| **Smithing Table** | Template (1.20+), base and addition → result. |

Ingredients can be your own items, **Existing Item** nodes, or **Item Tag** nodes.

## 14. Farmer's Delight

| Node | Settings |
|---|---|
| **Cutting Board** | One input. Tool: knife, axe, pickaxe, shovel or shears. Up to 4 results, each with a count and a chance. |
| **Cooking Pot** | Up to 6 ingredients, an optional container (e.g. a bowl), the result and count, XP, cook time, and recipe book tab (meals/drinks/misc). |

Farmer's Delight is **added automatically** when you test. It's available on Forge 1.18.2–1.20.1, NeoForge 1.21.1, and Fabric/Quilt 1.20.1 and 1.21.1. On other targets these recipes are skipped, and you'll see a warning in Problems.

## 15. Creative tabs

The **Creative Tab** node makes a tab in the creative inventory.

- **Icon**: wire a **Logo texture**, or an **Icon item** instead.
- Wire items into the **Item** pins. A new pin appears each time.
- **Item order** in Properties lists the tab contents. **Drag rows** to reorder, or use **A→Z / Z→A** to sort by name.
- Settings: Tab ID, title (EN/TH).

Items not wired into any tab are handled by the project setting **Items not connected to a Creative Tab**:

- _Hidden_: only obtainable with `/give`.
- _Put them in a main tab automatically_.

## 16. Java scripts (advanced)

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

## 17. Test in game and export a .jar

### ▶ Test in game

1. Pick the **Target** (loader + version) in the top bar.
2. Make sure **Problems** has no errors.
3. Click **▶ Test in game**, or press Ctrl+Enter. The app:
   - generates a Gradle project for that target;
   - downloads the right Java (it **asks first**; downloads are checksum-verified) and Gradle;
   - launches Minecraft with your mod. Fabric/Quilt also get Fabric API and Mod Menu, and every loader gets **AppleSkin** (shows hunger and saturation of food) where it exists for the version. These are only for testing and are not part of your mod.
4. Watch progress in **Console**. Click **Stop** to close the game.

> **The first test of each target takes a while** (several minutes, and several GB of downloads for Minecraft and libraries). Later tests are much faster.

In game, find your items in your creative tab, or use the `/give` command shown in Properties.

### ⬇ Export .jar

Click **⬇ Export .jar**. When the build finishes, choose where to save the `.jar`. Put it in a Minecraft `mods` folder with the matching loader (plus Fabric API on Fabric/Quilt, and Farmer's Delight or GeckoLib if your mod uses them).

To release for several versions, switch **Target** and export once per target.

## 18. Settings

Open with the gear button.

- **Theme**: System / Light / Dark.
- **Language**: ไทย / English.
- **Game memory (RAM)** for testing: 1–16 GB.
- **Download Java/Gradle automatically when needed**.
- **Java installations** found on your PC.

The **Test game** tab sets up Minecraft for "Test in game" (written to the test game's options before it starts; other settings stay as you left them in the game):

- Fullscreen, window size (with presets), max FPS (up to unlimited), VSync, GUI scale, render distance.
- Master volume, brightness, mouse sensitivity, game language (same as the app, English or ไทย).
- Pause or keep running when the game window loses focus.
- **Controls**: click a key, then press the new key or mouse button (Esc cancels). **Reset all** brings back Minecraft's keys.

The **Model editor** tab sets the model editor's mouse and keys: a Blockbench, Maya or Blender preset, or your own (see [Model editor](#model-editor-3d-models)).

## 19. Keyboard shortcuts

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
| Ctrl+Shift+P / Ctrl+P | Command palette / Open a generated file |
| Ctrl+B / Ctrl+J / Ctrl+Alt+B | Side bar / Problems & Console / Properties |
| Ctrl+Tab / Ctrl+W | Next tab / Close tab |
| G S R B V, or Maya Q W E R (model editor) | Move, Scale, Rotate, Paint, Select |
| F / A (model editor) | Frame selected / everything |

## 20. Troubleshooting

| Problem | What to do |
|---|---|
| ▶ says "Fix the errors in Problems first" | Open **Problems** and fix the red items (missing texture, duplicate ID, empty required pin…). |
| Build fails | Read the red lines in **Console**. Try **🧹 Clean build**, then test again. |
| The first test is very slow | That's normal: Minecraft and Gradle are being downloaded. Keep the internet on. |
| The game runs out of memory or is laggy | Increase **Game memory** in Settings. |
| Item shows as a purple-black cube | Its texture or model isn't connected, or the model refers to a texture slot that isn't wired. |
| A 3D armor shows as 2D | 3D armor only works on 1.20.1 and 1.21.1. |
| Farmer's Delight recipes are missing | The selected target has no Farmer's Delight version (see section 14). |
| Sound doesn't fade with distance | Convert it again with **Mono** on. |
| Script error in Check code | The underlined line shows the javac error. Make sure the code fits the selected loader and version. |
| Windows SmartScreen warning | **More info → Run anyway**. |

To report a bug, open an issue on [GitHub](https://github.com/Maskbuild/NKW-Mod-Studio/issues) with the Console log.

## 21. Walkthrough: a ruby sword from start to finish

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
