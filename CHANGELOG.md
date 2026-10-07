# Changelog

## Unreleased

### Added

- **Extensions.** Features can now be installed from GitHub (Settings → Extensions): download once, use offline, update, roll back, turn off, remove. Projects remember which extensions they use and name the missing ones. Extensions are data only (JSON, templates, pictures) and cannot run code in the app. Guide: `docs/EXTENSIONS.md`.
- **Roleplay extension**: Break Rule, Regenerating Blocks, Harvest a game crop, the hand-harvest settings of the Crop node, the Timer window and the config file moved out of the app into one extension.
- **Farmer's Delight** and **Thirst** are extensions too.
- **Timer window v2**: a box of elements (rectangle, bar, circle, text, image) with colours, gradients, outlines, animations (opacity, move, size, colour; over time, with the progress, in the last seconds), presets and a live preview. Old timer windows look the same until they are edited. Images show on Minecraft 1.20.1 – 1.21.1.
- **Skins extension**: player skins from 64 to 2048 pixels, a wardrobe window opened by a key or a block, skins everyone on the server sees, a mouth-open picture, a wardrobe editor with a sample model, and Figura avatar export. Fabric / Quilt / NeoForge, Minecraft 1.20.1 – 1.21.1. Plasmo Voice is not connected yet.

### Changed

- The Script node (writing Java inside the app) was removed. Old projects keep the node as a gray card with its data.
- The released app ships without extensions; the official ones are installed from Settings → Extensions.

### Tests

- A snapshot of every generated file for every loader × version, a JDK syntax check of all generated Java, and a compile-and-compare test of the timer layout (TypeScript against Java).
