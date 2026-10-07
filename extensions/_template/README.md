# My extension (template)

Copy this folder to start an extension for NKW Mod Studio.

1. Change `id`, `name`, `description` and `version` in `nkw-extension.json`.
2. Describe your nodes in `nodes/*.json` and list them in the manifest.
3. Write the code your nodes add to a mod as templates in `templates/` and list them under `generate`.
4. Check it: `npx tsx scripts/ext-validate.ts extensions/<your folder>`
5. Try it: in the app choose *Settings → Extensions → Install from a folder*.
6. Publish: push the folder to a GitHub repository (the folder is the repository root, or any folder of it:
   `owner/repo#main:path/to/folder`). Tag a release (`v1.0.0`) so users get a stable version.

An extension is data only: JSON, templates and picture files. It cannot contain scripts or `.jar` files.
See `docs/EXTENSIONS.md` for everything a manifest can do.
