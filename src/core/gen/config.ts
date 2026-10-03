import type { GameCropIR, ModIR } from '../ir'
import { JavaFile, MC, registry } from './java'
import { RES, json, type GenCtx } from './types'

/**
 * The mod's config file (config/<modid>-harvest.json), for server owners. It only changes times and adds
 * blocks: harvest times, grow-back times of Regenerating Blocks, and more blocks of the game / other mods for
 * the sets the nodes made (each "Harvest a game crop" node and each Break Rule node is a set; added blocks are
 * picked / ruled like the set). Only blocks that are in the game count: other ids are reported in the log.
 * A section is only written when the mod has what it changes. Written with the nodes' settings on first start.
 */

/** Own crops whose hand harvest takes time (hold / stand still). */
const timedCrops = (ir: ModIR) => ir.blocks.filter((b) => b.crop && (b.crop.input === 'hold' || b.crop.input === 'stand'))

/** The "Harvest a game crop" nodes as sets (in node order) with their crops. */
export function gameCropSets(ir: ModIR): GameCropIR[][] {
  const sets = new Map<string, GameCropIR[]>()
  for (const g of ir.gameCrops) sets.set(g.nodeId, [...(sets.get(g.nodeId) ?? []), g])
  return [...sets.values()]
}

/** Whether the mod has anything the config file can change. */
export const usesConfig = (ir: ModIR) => timedCrops(ir).length > 0 || ir.gameCrops.length > 0 || ir.blocks.some((b) => b.regen) || ir.breakRules.length > 0

/** Name of the config file in the game's config folder. */
export const configFileName = (ns: string) => `${ns}-harvest.json`

/** Path of the default config inside the jar. */
const defaultsPath = (ns: string) => `nkw/${ns}-harvest.json`

const secs = (ticks: number) => Math.round((ticks / 20) * 100) / 100

/** The default config: the nodes' times, and the sets' blocks for reference (`_` keys are not read). */
export function defaultConfig(ir: ModIR, tagged = true): Record<string, unknown> {
  const ns = ir.meta.modId
  const out: Record<string, unknown> = {
    _readme: [
      'Times and added blocks only. Delete this file to get the defaults back. Changes apply after a restart.',
      'แก้ได้เฉพาะเวลาและเพิ่มบล็อก ลบไฟล์นี้เพื่อกลับไปค่าเริ่มต้น แก้แล้วต้องเปิดเกมใหม่',
      '"add": blocks of the game or of other mods only (e.g. minecraft:potatoes, othermod:rice); unknown ids are ignored and reported in the log.',
      '"add": ใส่ได้เฉพาะบล็อกที่มีในเกมหรือม็อดอื่น (เช่น minecraft:potatoes, othermod:rice) ID ที่ไม่มีจะถูกข้ามและแจ้งใน log'
    ]
  }
  const crops = timedCrops(ir)
  if (crops.length) out.crops = Object.fromEntries(crops.map((b) => [`${ns}:${b.id}`, { harvestSeconds: secs(b.crop!.harvestTicks) }]))
  const sets = gameCropSets(ir)
  if (sets.length) {
    out._gameCrops_help = [
      'One set per "Harvest a game crop" node. add: more crops picked the same way (they need growth stages).',
      'หนึ่งชุดต่อโหนด "เก็บเกี่ยวพืชในเกม" · add: เพิ่มพืชที่เก็บแบบเดียวกัน (พืชต้องมีระยะการโต)'
    ]
    out.gameCrops = Object.fromEntries(
      sets.map((set, i) => [
        String(i + 1),
        { _crops: set.map((g) => g.block), ...(set[0].input !== 'click' ? { harvestSeconds: secs(set[0].harvestTicks) } : {}), add: [] }
      ])
    )
  }
  const regen = ir.blocks.filter((b) => b.regen)
  if (regen.length) {
    const back = new Map(ir.blocks.filter((b) => b.depleted).map((b) => [b.depleted!.restore, b.depleted!.ticks]))
    out.regenBlocks = Object.fromEntries(
      regen.map((b) => [
        `${ns}:${b.id}`,
        { ...(b.regen!.input !== 'break' ? { harvestSeconds: secs(b.regen!.harvestTicks) } : {}), regrowSeconds: secs(back.get(b.id) ?? 1200) }
      ])
    )
  }
  if (ir.breakRules.length) {
    out._breakRules_help = [
      `One set per Break Rule node. add: more block ids${tagged ? ' or #tags' : ''} that follow the same rule.`,
      `หนึ่งชุดต่อโหนดกฎการทุบบล็อก · add: เพิ่ม ID บล็อก${tagged ? 'หรือ #แท็ก' : ''}ที่ใช้กฎเดียวกัน`
    ]
    out.breakRules = Object.fromEntries(
      ir.breakRules.map((r, i) => [
        String(i + 1),
        {
          _rule: `${r.tool}, ${r.level}${r.onFail === 'cantBreak' ? ', cannot be broken' : ''}`,
          _blocks: [...r.blocks, ...(tagged ? r.tags.map((x) => `#${x}`) : [])],
          add: []
        }
      ])
    )
  }
  return out
}

/** The default config file inside the jar, copied to the config folder on first start. */
export function configResource(ir: ModIR, mc: string): { path: string; text: string } {
  // 1.16.5 has no block tag keys
  return { path: `${RES}/${defaultsPath(ir.meta.modId)}`, text: json(defaultConfig(ir, mc !== '1.16.5')) }
}

/** NkwConfig: reads the config file (both sides) and reports unknown block ids once the game is loaded. */
export function genConfig(ctx: GenCtx, out: (cls: string, text: string) => void): void {
  const { pkg, p, ns, loader } = ctx
  const j = new JavaFile(pkg, 'NkwConfig').use(
    'com.google.gson.JsonArray',
    'com.google.gson.JsonElement',
    'com.google.gson.JsonObject',
    'com.google.gson.JsonParser',
    'java.io.InputStream',
    'java.nio.charset.StandardCharsets',
    'java.nio.file.Files',
    'java.nio.file.Path',
    'java.util.ArrayList',
    'java.util.Collections',
    'java.util.HashMap',
    'java.util.List',
    'java.util.Map',
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
 * config/${configFileName(ns)}: harvest times, grow-back times, and blocks of the game / other mods added to the
 * nodes' sets. Written with the defaults on first start; read once (changes apply after a restart).
 */
public final class NkwConfig {
    /** the mod's own crops and Regenerating Blocks by block id: harvestSeconds, regrowSeconds */
    public static final Map<String, JsonObject> OWN = new HashMap<>();
    /** "Harvest a game crop" sets by number: harvestSeconds, add */
    public static final Map<String, JsonObject> GAME_CROPS = new HashMap<>();
    /** Break Rule sets by number: add */
    public static final Map<String, JsonObject> BREAK = new HashMap<>();
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
            objects(root, "crops", OWN);
            objects(root, "regenBlocks", OWN);
            objects(root, "gameCrops", GAME_CROPS);
            objects(root, "breakRules", BREAK);
        } catch (Exception e) {
            NkwMod.LOGGER.warn("[NKW] Could not read {}: {}", file, e.toString());
        }
    }

    private static void objects(JsonObject root, String key, Map<String, JsonObject> into) {
        if (!root.has(key) || !root.get(key).isJsonObject()) return;
        for (Map.Entry<String, JsonElement> e : root.getAsJsonObject(key).entrySet())
            if (e.getValue().isJsonObject()) into.put(e.getKey().trim().toLowerCase(), e.getValue().getAsJsonObject());
    }

    /** Ticks of a seconds value (between min and max seconds), or def when it is missing or not a number. */
    private static int ticks(JsonObject o, String key, int def, double min, double max) {
        try {
            return o != null && o.has(key) ? (int) Math.round(Math.max(min, Math.min(max, o.get(key).getAsDouble())) * 20) : def;
        } catch (Exception e) {
            return def;
        }
    }

    /** Harvest time (0.1 – 120 s) of a config entry, or def. */
    public static int harvestTicks(JsonObject o, int def) {
        return ticks(o, "harvestSeconds", def, 0.1, 120);
    }

    /** Grow-back time of a Regenerating Block (its id), or def. */
    public static int regrowTicks(String id, int def) {
        return ticks(OWN.get(id), "regrowSeconds", def, 1, 86400);
    }

    /** The "add" list of a set (lower-case ids / #tags). */
    public static List<String> added(JsonObject o) {
        if (o == null || !o.has("add") || !o.get("add").isJsonArray()) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        JsonArray list = o.getAsJsonArray("add");
        for (JsonElement e : list)
            if (e.isJsonPrimitive()) {
                String id = e.getAsString().trim().toLowerCase();
                if (!id.isEmpty()) out.add(id);
            }
        return out;
    }

    /**
     * Reports added block ids that are not in the game (only blocks of the game or of other mods can be added);
     * they never match anything. Runs once, at the first block lookup (every mod's blocks are registered by then).
     */
    public static synchronized void check() {
        if (checked) return;
        checked = true;
        List<String> ids = new ArrayList<>();
        for (JsonObject o : GAME_CROPS.values()) ids.addAll(added(o));
        for (JsonObject o : BREAK.values()) ids.addAll(added(o));
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
