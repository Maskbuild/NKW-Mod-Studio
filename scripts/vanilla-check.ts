/** npx tsx scripts/vanilla-check.ts 1.21.1 — downloads + extracts vanilla and Farmer's Delight item data and prints stats */
import { ensureFarmersDelight, ensureVanilla } from '../src/main/services/vanilla'

async function main() {
  const tools = process.env.NKW_TOOLS_DIR ?? '.verify/tools'
  const p = (m: string, a?: number, b?: number) => process.stdout.write(`\r${m} ${a ?? ''}/${b ?? ''}      `)
  for (const mc of process.argv.slice(2)) {
    const d = await ensureVanilla(tools, mc, p)
    console.log(`\n${mc}: ${d.items.length} items, ${d.items.filter((i) => i.icon).length} icons, ${d.tags.length} tags`)
    const fd = await ensureFarmersDelight(tools, mc, p)
    if (!fd) console.log(`  Farmer's Delight: not available for ${mc}`)
    else
      console.log(
        `  Farmer's Delight: ${fd.items.length} items, ${fd.items.filter((i) => i.icon).length} icons, ${fd.tags.length} tags, e.g. ${fd.items
          .slice(0, 6)
          .map((i) => i.en)
          .join(', ')}`
      )
  }
}
void main()
