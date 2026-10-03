import type { ModIR } from '../ir'
import { usesBreakRules } from './breakRules'
import { usesHarvest } from './harvest'
import { JavaFile, MC, registry } from './java'
import { usesRegen } from './regen'
import { RES, json, type GenCtx } from './types'

/**
 * The mod's config file (config/<modid>-harvest.json), for server owners: harvest times, grow-back times of
 * Regenerating Blocks, crops of the game / other mods picked by hand, and blocks added to the break rules.
 * Only blocks that are in the game (vanilla or another mod) count: anything else is reported in the log and
 * never matches. The file is written with the mod's own settings the first time the game starts.
 */

/** Whether the mod has anything the config file can change. */
export const usesConfig = (ir: ModIR) => usesHarvest(ir) || usesBreakRules(ir) || usesRegen(ir)

/** Name of the config file in the game's config folder. */
export const configFileName = (ns: string) => `${ns}-harvest.json`

/** Path of the default config inside the jar. */
const defaultsPath = (ns: string) => `nkw/${ns}-harvest.json`

const secs = (ticks: number) => Math.round((ticks / 20) * 100) / 100
const AFTER_NAME = { break: 'normal', replant: 'replant', regrow: 'regrow' } as const

/** The default config: everything the mod's nodes set, so it is easy to see what to change. */
export function defaultConfig(ir: ModIR, tagged = true): Record<string, unknown> {
  const ns = ir.meta.modId
  const out: Record<string, unknown> = {
    _readme: [
      'Harvest and breaking settings. Delete this file to get the defaults back. Changes apply after a restart.',
      'การตั้งค่าการเก็บเกี่ยวและการทุบบล็อก ลบไฟล์นี้เพื่อกลับไปค่าเริ่มต้น แก้แล้วต้องเปิดเกมใหม่',
      'Only blocks of the game or of other mods can be added (e.g. minecraft:carrots, othermod:rice); unknown ids are ignored and reported in the log.',
      'เพิ่มได้เฉพาะบล็อกที่มีในเกมหรือม็อดอื่น (เช่น minecraft:carrots, othermod:rice) ID ที่ไม่มีจะถูกข้ามและแจ้งใน log'
    ]
  }
  if (usesHarvest(ir)) {
    const harvest: Record<string, unknown> = {}
    for (const g of ir.gameCrops)
      harvest[g.block] = {
        input: g.input,
        seconds: secs(g.harvestTicks),
        after: AFTER_NAME[g.after],
        regrowStage: g.back,
        give: g.give,
        adventure: g.adventure,
        sneak: g.sneak
      }
    for (const b of ir.blocks) {
      if (b.crop && b.crop.input !== 'break' && b.crop.input !== 'click') harvest[`${ns}:${b.id}`] = { seconds: secs(b.crop.harvestTicks) }
      if (b.regen && b.regen.input !== 'break') harvest[`${ns}:${b.id}`] = { seconds: secs(b.regen.harvestTicks) }
    }
    out._harvest_help = [
      'seconds: harvest time. Crops of the game / other mods also take: input (click, hold, stand, break = off), after (normal, replant, regrow), regrowStage, give, adventure, sneak.',
      'seconds: เวลาเก็บ · พืชของเกม/ม็อดอื่นตั้งเพิ่มได้: input (click, hold, stand, break = ปิด), after (normal, replant, regrow), regrowStage, give, adventure, sneak',
      "This mod's own crops and Regenerating Blocks only take seconds. A new crop needs a growth stage (age) to be picked.",
      'พืชและบล็อกเกิดใหม่ของม็อดนี้ตั้งได้แค่ seconds · พืชที่เพิ่มใหม่ต้องมีระยะการโต (age) ถึงจะเก็บได้'
    ]
    out.harvest = harvest
  }
  if (usesRegen(ir)) {
    const regrow: Record<string, number> = {}
    for (const b of ir.blocks) if (b.depleted) regrow[`${ns}:${b.depleted.restore}`] = secs(b.depleted.ticks)
    out._regrowSeconds_help = ['Seconds before a harvested Regenerating Block grows back.', 'กี่วินาทีก่อนบล็อกเกิดใหม่ที่ถูกเก็บจะกลับมา']
    out.regrowSeconds = regrow
  }
  if (usesBreakRules(ir)) {
    const rules: Record<string, unknown> = {}
    for (const r of ir.breakRules)
      for (const id of [...r.blocks, ...(tagged ? r.tags.map((x) => `#${x}`) : [])])
        if (!(id in rules)) rules[id] = { tool: r.tool, level: r.level, cantBreak: r.onFail === 'cantBreak' }
    out._breakRules_help = [
      `Block id${tagged ? ' or #tag' : ''}: tool (pickaxe, axe, shovel, hoe, sword, shears, any), level (wood, stone, iron, diamond, netherite), cantBreak (true: cannot be broken, false: breaks without drops).`,
      `ID บล็อก${tagged ? 'หรือ #แท็ก' : ''}: tool (pickaxe, axe, shovel, hoe, sword, shears, any), level (wood, stone, iron, diamond, netherite), cantBreak (true: ทุบไม่ได้, false: ทุบได้แต่ไม่ได้ของ)`
    ]
    out.breakRules = rules
  }
  return out
}

/** The default config file inside the jar, copied to the config folder on first start. */
export function configResource(ir: ModIR, mc: string): { path: string; text: string } {
  // 1.16.5 has no block tag keys
  return { path: `${RES}/${defaultsPath(ir.meta.modId)}`, text: json(defaultConfig(ir, mc !== '1.16.5')) }
}

/** NkwConfig: reads the config file (both sides) and checks its block ids once the game is loaded. */
export function genConfig(ctx: GenCtx, out: (cls: string, text: string) => void): void {
  const { pkg, p, ns, loader } = ctx
  const j = new JavaFile(pkg, 'NkwConfig').use(
    'com.google.gson.JsonElement',
    'com.google.gson.JsonObject',
    'com.google.gson.JsonParser',
    'java.io.InputStream',
    'java.nio.charset.StandardCharsets',
    'java.nio.file.Files',
    'java.nio.file.Path',
    'java.util.HashMap',
    'java.util.LinkedHashMap',
    'java.util.Map',
    'java.util.Set',
    MC.RL
  )
  const configDir =
    loader === 'forge'
      ? (j.use('net.minecraftforge.fml.loading.FMLPaths'), 'FMLPaths.CONFIGDIR.get()')
      : loader === 'neoforge'
        ? (j.use('net.neoforged.fml.loading.FMLPaths'), 'FMLPaths.CONFIGDIR.get()')
        : (j.use('net.fabricmc.loader.api.FabricLoader'), 'FabricLoader.getInstance().getConfigDir()')
  const blocks = registry(p, j, 'BLOCK')
  const rl = p.rlFactory ? 'ResourceLocation.parse(id)' : 'new ResourceLocation(id)'
  out(
    'NkwConfig',
    j.render(`
/**
 * config/${configFileName(ns)}: harvest times, grow-back times and blocks of the game / other mods added to the
 * harvest and break rules. Written with the defaults on first start; read once (changes apply after a restart).
 */
public final class NkwConfig {
    /** hand harvests by block id: seconds (and, for crops of the game / other mods, input, after, regrowStage, give, adventure, sneak) */
    public static final Map<String, JsonObject> HARVEST = new HashMap<>();
    /** grow-back time (ticks) of Regenerating Blocks by block id */
    private static final Map<String, Integer> REGROW = new HashMap<>();
    /** break rules by block id or #tag: tool, level, cantBreak */
    public static final Map<String, JsonObject> BREAK = new LinkedHashMap<>();
    private static boolean checked;

    static {
        load();
    }

    private NkwConfig() {}

    @SuppressWarnings("deprecation")
    private static void load() {
        Path file = ${configDir}.resolve("${configFileName(ns)}");
        try {
            if (!Files.exists(file)) {
                try (InputStream in = NkwConfig.class.getResourceAsStream("/${defaultsPath(ns)}")) {
                    if (in == null) return;
                    Files.createDirectories(file.getParent());
                    Files.copy(in, file);
                }
            }
            JsonObject root = new JsonParser().parse(new String(Files.readAllBytes(file), StandardCharsets.UTF_8)).getAsJsonObject();
            objects(root, "harvest", HARVEST);
            objects(root, "breakRules", BREAK);
            if (root.has("regrowSeconds") && root.get("regrowSeconds").isJsonObject())
                for (Map.Entry<String, JsonElement> e : root.getAsJsonObject("regrowSeconds").entrySet())
                    if (e.getValue().isJsonPrimitive()) REGROW.put(e.getKey(), clampTicks(e.getValue().getAsDouble(), 1, 86400));
        } catch (Exception e) {
            NkwMod.LOGGER.warn("[NKW] Could not read {}: {}", file, e.toString());
        }
    }

    private static void objects(JsonObject root, String key, Map<String, JsonObject> into) {
        if (!root.has(key) || !root.get(key).isJsonObject()) return;
        for (Map.Entry<String, JsonElement> e : root.getAsJsonObject(key).entrySet())
            if (e.getValue().isJsonObject()) into.put(e.getKey().trim().toLowerCase(), e.getValue().getAsJsonObject());
    }

    private static int clampTicks(double seconds, double min, double max) {
        return (int) Math.round(Math.max(min, Math.min(max, seconds)) * 20);
    }

    /** Ticks of a "seconds" value (0.1 – 120 s), or def. */
    public static int ticks(JsonObject o, String key, int def) {
        try {
            return o.has(key) ? clampTicks(o.get(key).getAsDouble(), 0.1, 120) : def;
        } catch (Exception e) {
            return def;
        }
    }

    /** Index of a named choice, or def when missing / unknown. */
    public static int choice(JsonObject o, String key, String[] names, int def) {
        try {
            if (!o.has(key)) return def;
            String v = o.get(key).getAsString();
            for (int i = 0; i < names.length; i++) if (names[i].equals(v)) return i;
        } catch (Exception e) {
            /* not a text */
        }
        return def;
    }

    public static boolean bool(JsonObject o, String key, boolean def) {
        try {
            return o.has(key) ? o.get(key).getAsBoolean() : def;
        } catch (Exception e) {
            return def;
        }
    }

    public static int integer(JsonObject o, String key, int def, int min, int max) {
        try {
            return o.has(key) ? Math.max(min, Math.min(max, o.get(key).getAsInt())) : def;
        } catch (Exception e) {
            return def;
        }
    }

    /** Grow-back time of a Regenerating Block (its id), or def. */
    public static int regrowTicks(String id, int def) {
        Integer t = REGROW.get(id);
        return t == null ? def : t;
    }

    /**
     * Reports block ids that are not in the game (only blocks of the game or of other mods can be used); they never
     * match anything. Runs once, when the first block is looked up (every mod's blocks are registered by then).
     */
    public static synchronized void check() {
        if (checked) return;
        checked = true;
        for (Set<String> ids : java.util.Arrays.asList(HARVEST.keySet(), REGROW.keySet(), BREAK.keySet()))
            for (String id : ids) {
                if (id.startsWith("#")) continue;
                boolean known;
                try {
                    known = ${blocks}.containsKey(${rl});
                } catch (Exception e) {
                    known = false;
                }
                if (!known) NkwMod.LOGGER.warn("[NKW] ${configFileName(ns)}: \\"{}\\" is not a block of the game or of a mod, ignored", id);
            }
    }
}`)
  )
}
