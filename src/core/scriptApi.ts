import type { L10n } from './nodes/defs'
import type { Loader, Target } from './project'

/**
 * Script nodes are plain Java source files of the mod, written like in any Minecraft mod (imports,
 * classes, event handlers). This module holds what the compiler, the generator and the editor share:
 * class detection, the package line, which targets a file applies to, an import catalogue for
 * completion, ready-made examples per loader/version, and javac error parsing.
 */

const t = (en: string, th: string): L10n => ({ en, th })

/** Java keywords and built-in types (completion in the editor, colours in the canvas preview). */
export const JAVA_KEYWORDS = [
  'public',
  'private',
  'protected',
  'static',
  'final',
  'abstract',
  'class',
  'interface',
  'enum',
  'record',
  'extends',
  'implements',
  'void',
  'int',
  'long',
  'float',
  'double',
  'boolean',
  'char',
  'byte',
  'short',
  'var',
  'return',
  'new',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'throws',
  'this',
  'super',
  'null',
  'true',
  'false',
  'instanceof',
  'import',
  'package'
]

/** Classes the generator writes itself; a script may not use these names. */
export const RESERVED_CLASSES = new Set([
  'NkwMod',
  'NkwClient',
  'NkwTags',
  'ModItems',
  'ModBlocks',
  'ModSounds',
  'ModTabs',
  'ModArmorMaterials',
  'ModToolTiers',
  'NkwEffect',
  'NkwFoilItem',
  'NkwArmorItem',
  'NkwGeoArmorItem',
  'NkwDiscItem',
  'NkwModelBlock',
  'NkwFacingModelBlock',
  'NkwJukebox',
  'NkwHeadwear',
  'NkwSwordItem',
  'NkwPickaxeItem',
  'NkwAxeItem',
  'NkwShovelItem',
  'NkwHoeItem'
])

export const targetKey = (t: Pick<Target, 'loader' | 'mc'>) => `${t.loader}-${t.mc}`

/** Empty list = every target of the project. */
export const scriptAppliesTo = (targets: string[], t: Pick<Target, 'loader' | 'mc'>) => !targets.length || targets.includes(targetKey(t))

/** Name of the file's first top-level public class / interface / enum / record (= the .java file name). */
export function scriptClassName(code: string): string | null {
  const clean = stripCommentsAndStrings(code)
  const m = /(?:^|[\s;}])public\s+(?:(?:final|abstract|sealed|non-sealed|static)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/.exec(
    clean
  )
  return m ? m[1] : null
}

/** Code with comments and string/char literals blanked out (same length, so positions still match). */
function stripCommentsAndStrings(code: string): string {
  let out = ''
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') ((out += ' '), i++)
      if (i < code.length) out += '\n'
      continue
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      const stop = end < 0 ? code.length : end + 2
      for (; i < stop; i++) out += code[i] === '\n' ? '\n' : ' '
      i--
      continue
    }
    if (c === '"' || c === "'") {
      out += c
      let j = i + 1
      for (; j < code.length && code[j] !== c && code[j] !== '\n'; j++) {
        if (code[j] === '\\') ((out += ' '), j++)
        out += ' '
      }
      if (j < code.length && code[j] === c) out += c
      i = code[j] === c ? j : j - 1
      continue
    }
    out += c
  }
  return out
}

/**
 * The file as it goes into the mod: its `package` line set to the mod's package. The line count never
 * changes (a missing package line is put in front of line 1), so javac line numbers match the editor.
 */
export function scriptSource(code: string, pkg: string): string {
  const src = code.replace(/\r\n?/g, '\n')
  const re = /^(\s*)package\s+[\w.]+\s*;/m
  if (re.test(stripCommentsAndStrings(src))) return src.replace(re, (_m, ws: string) => `${ws}package ${pkg};`)
  return `package ${pkg}; ${src}`
}

/** Fabric/Quilt entrypoints a script class implements (added to fabric.mod.json / quilt.mod.json). */
export function scriptEntrypoints(code: string): { main: boolean; client: boolean } {
  const clean = stripCommentsAndStrings(code)
  const impl = /\bimplements\s+([^{]+)\{/.exec(clean)?.[1] ?? ''
  return { main: /\bModInitializer\b/.test(impl.replace(/\bClientModInitializer\b/g, '')), client: /\bClientModInitializer\b/.test(impl) }
}

/** "…/com/nkw/mymod/Welcome.java:12: error: cannot find symbol" → file class, line, message. */
export function parseJavacError(line: string): { cls: string; line: number; message: string; severity: 'error' | 'warning' } | null {
  const m = /[\\/]src[\\/]main[\\/]java[\\/](?:[\w$]+[\\/])*([\w$]+)\.java:(\d+):\s*(error|warning):\s*(.+)$/.exec(line)
  return m ? { cls: m[1], line: Number(m[2]), message: m[4].trim(), severity: m[3] as 'error' | 'warning' } : null
}

// ───────────── import catalogue (for completion) ─────────────

export interface JavaClassInfo {
  name: string
  fqcn: string
  doc: L10n
}

type Era = { loader: Loader; old: boolean; fabric: boolean; neo: boolean; neo21: boolean; v: number }
const eraOf = (t: Pick<Target, 'loader' | 'mc'>): Era => {
  const [, minor, patch] = t.mc.split('.').map(Number)
  const v = minor * 100 + (patch || 0)
  return {
    loader: t.loader,
    old: v <= 1802,
    fabric: t.loader === 'fabric' || t.loader === 'quilt',
    neo: t.loader === 'neoforge',
    neo21: t.loader === 'neoforge' && v >= 2100,
    v
  }
}

const mc = (name: string, pkg: string, en: string, th: string): JavaClassInfo => ({
  name,
  fqcn: `net.minecraft.${pkg ? `${pkg}.` : ''}${name}`,
  doc: t(en, th)
})

/** Classes worth suggesting for a target, with the right package for its version. */
export function javaClassCatalog(target: Pick<Target, 'loader' | 'mc'>): JavaClassInfo[] {
  const e = eraOf(target)
  const list: JavaClassInfo[] = [
    mc('Player', 'world.entity.player', 'A player (both sides).', 'ผู้เล่น'),
    mc('ServerPlayer', 'server.level', 'A player on the server.', 'ผู้เล่นฝั่งเซิร์ฟเวอร์'),
    mc('Level', 'world.level', 'A world / dimension.', 'โลก / มิติ'),
    mc('ServerLevel', 'server.level', 'A world on the server.', 'โลกฝั่งเซิร์ฟเวอร์'),
    mc('ItemStack', 'world.item', 'A stack of items.', 'กองไอเทม'),
    mc('Item', 'world.item', 'An item type.', 'ชนิดไอเทม'),
    mc('Items', 'world.item', 'All vanilla items (Items.DIAMOND …).', 'ไอเทมทั้งหมดของเกม (Items.DIAMOND …)'),
    mc('Block', 'world.level.block', 'A block type.', 'ชนิดบล็อก'),
    mc('Blocks', 'world.level.block', 'All vanilla blocks.', 'บล็อกทั้งหมดของเกม'),
    mc('BlockState', 'world.level.block.state', 'A placed block with its properties.', 'บล็อกพร้อมสถานะ'),
    mc('BlockPos', 'core', 'A block position (x, y, z).', 'ตำแหน่งบล็อก (x, y, z)'),
    mc('Component', 'network.chat', 'Chat text. ' + (e.old ? 'Use new TextComponent("…") on this version.' : 'Component.literal("…")'), 'ข้อความแชท'),
    mc('ChatFormatting', '', 'Colours and styles for text.', 'สีและรูปแบบข้อความ'),
    mc('InteractionHand', 'world', 'MAIN_HAND / OFF_HAND.', 'มือหลัก / มือรอง'),
    mc('InteractionResult', 'world', 'SUCCESS / PASS / FAIL.', 'ผลลัพธ์การกระทำ'),
    mc(
      'MobEffectInstance',
      'world.effect',
      'An effect with duration and level: new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 1).',
      'เอฟเฟกต์พร้อมเวลาและระดับ'
    ),
    mc('MobEffects', 'world.effect', 'All vanilla effects.', 'เอฟเฟกต์ทั้งหมดของเกม'),
    mc('SoundEvents', 'sounds', 'All vanilla sounds.', 'เสียงทั้งหมดของเกม'),
    mc('SoundSource', 'sounds', 'Sound category (PLAYERS, BLOCKS …).', 'หมวดเสียง'),
    mc('EntityType', 'world.entity', 'All entity types.', 'ชนิดสิ่งมีชีวิต/วัตถุ'),
    mc('Entity', 'world.entity', 'Any entity.', 'สิ่งมีชีวิต/วัตถุใด ๆ'),
    mc('LivingEntity', 'world.entity', 'A mob or player.', 'มอบหรือผู้เล่น'),
    mc('Vec3', 'world.phys', 'A 3D vector / exact position.', 'เวกเตอร์ 3 มิติ'),
    mc('MinecraftServer', 'server', 'The running server.', 'เซิร์ฟเวอร์ที่กำลังทำงาน'),
    mc('Commands', 'commands', 'Command registration helpers (Commands.literal …).', 'ตัวช่วยสร้างคำสั่ง'),
    mc('CommandSourceStack', 'commands', 'Who runs a command.', 'ผู้สั่งคำสั่ง')
  ]
  if (e.old) list.push(mc('TextComponent', 'network.chat', 'Plain chat text: new TextComponent("…").', 'ข้อความแชทธรรมดา'))
  if (!(e.v >= 2102)) list.push(mc('InteractionResultHolder', 'world', 'Result + item stack (use / UseItemCallback).', 'ผลลัพธ์พร้อมไอเทม'))
  const add = (name: string, fqcn: string, en: string, th: string) => list.push({ name, fqcn, doc: t(en, th) })
  if (e.fabric) {
    add(
      'ModInitializer',
      'net.fabricmc.api.ModInitializer',
      'Implement it and put your setup in onInitialize() — the app registers the class as an entrypoint.',
      'implements แล้วเขียนการตั้งค่าใน onInitialize() — แอปลงทะเบียน entrypoint ให้'
    )
    add(
      'ClientModInitializer',
      'net.fabricmc.api.ClientModInitializer',
      'Client-only setup in onInitializeClient().',
      'ตั้งค่าฝั่ง client ใน onInitializeClient()'
    )
    add('UseItemCallback', 'net.fabricmc.fabric.api.event.player.UseItemCallback', 'A player right-clicks with an item.', 'ผู้เล่นคลิกขวาด้วยไอเทม')
    add('UseBlockCallback', 'net.fabricmc.fabric.api.event.player.UseBlockCallback', 'A player right-clicks a block.', 'ผู้เล่นคลิกขวาที่บล็อก')
    add('AttackEntityCallback', 'net.fabricmc.fabric.api.event.player.AttackEntityCallback', 'A player hits an entity.', 'ผู้เล่นตีสิ่งมีชีวิต')
    add(
      'PlayerBlockBreakEvents',
      'net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents',
      'Before / after a player breaks a block.',
      'ก่อน/หลังผู้เล่นทุบบล็อก'
    )
    add(
      'ServerPlayConnectionEvents',
      'net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents',
      'Players joining / leaving (JOIN, DISCONNECT).',
      'ผู้เล่นเข้า/ออก'
    )
    add('ServerTickEvents', 'net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents', 'Every server / world tick.', 'ทุก tick ของเซิร์ฟเวอร์/โลก')
    add('ServerLifecycleEvents', 'net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents', 'Server starting / stopping.', 'เซิร์ฟเวอร์เริ่ม/หยุด')
    add(
      'CommandRegistrationCallback',
      e.old ? 'net.fabricmc.fabric.api.command.v1.CommandRegistrationCallback' : 'net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback',
      'Register commands.',
      'ลงทะเบียนคำสั่ง'
    )
  } else {
    const base = e.neo ? 'net.neoforged.neoforge' : 'net.minecraftforge'
    add(
      'SubscribeEvent',
      e.neo ? 'net.neoforged.bus.api.SubscribeEvent' : 'net.minecraftforge.eventbus.api.SubscribeEvent',
      'Marks a static method as an event handler.',
      'บอกว่าเมธอดนี้รับเหตุการณ์'
    )
    if (e.neo21)
      add(
        'EventBusSubscriber',
        'net.neoforged.fml.common.EventBusSubscriber',
        "@EventBusSubscriber(modid = NkwMod.MOD_ID): the class's @SubscribeEvent methods are registered automatically.",
        'class นี้ถูกลงทะเบียนรับเหตุการณ์อัตโนมัติ'
      )
    else
      add(
        'Mod',
        e.neo ? 'net.neoforged.fml.common.Mod' : 'net.minecraftforge.fml.common.Mod',
        "@Mod.EventBusSubscriber(modid = NkwMod.MOD_ID): the class's @SubscribeEvent methods are registered automatically.",
        'class นี้ถูกลงทะเบียนรับเหตุการณ์อัตโนมัติ'
      )
    add(
      'PlayerEvent',
      `${base}.event.entity.player.PlayerEvent`,
      'PlayerEvent.PlayerLoggedInEvent, PlayerRespawnEvent … ' + (e.old && !e.neo ? '(getPlayer())' : '(getEntity())'),
      'เหตุการณ์ของผู้เล่น'
    )
    add('PlayerInteractEvent', `${base}.event.entity.player.PlayerInteractEvent`, 'RightClickItem, RightClickBlock, LeftClickBlock …', 'ผู้เล่นคลิกไอเทม/บล็อก')
    add('LivingDeathEvent', `${base}.event.entity.living.LivingDeathEvent`, 'A mob or player dies.', 'มอบหรือผู้เล่นตาย')
    add(
      'BlockEvent',
      e.old && !e.neo ? 'net.minecraftforge.event.world.BlockEvent' : `${base}.event.level.BlockEvent`,
      'BlockEvent.BreakEvent, EntityPlaceEvent …',
      'เหตุการณ์ของบล็อก'
    )
    add('RegisterCommandsEvent', `${base}.event.RegisterCommandsEvent`, 'Register commands (event.getDispatcher()).', 'ลงทะเบียนคำสั่ง')
    if (e.neo && e.v >= 2100)
      add(
        'ServerTickEvent',
        'net.neoforged.neoforge.event.tick.ServerTickEvent',
        'ServerTickEvent.Post: after every server tick.',
        'หลังทุก tick ของเซิร์ฟเวอร์'
      )
    else add('TickEvent', `${base}.event.TickEvent`, 'TickEvent.ServerTickEvent / PlayerTickEvent (check event.phase).', 'เหตุการณ์ทุก tick')
  }
  return list
}

/** Where to put an import for `fqcn` (after the last import, or after the package line). null = already imported. */
export function importInsertPos(code: string, fqcn: string): { pos: number; text: string } | null {
  const clean = stripCommentsAndStrings(code)
  const simple = fqcn.slice(fqcn.lastIndexOf('.') + 1)
  if (new RegExp(`^\\s*import\\s+(?:${fqcn.replace(/\./g, '\\.')}|${fqcn.slice(0, fqcn.lastIndexOf('.')).replace(/\./g, '\\.')}\\.\\*)\\s*;`, 'm').test(clean))
    return null
  if (new RegExp(`^\\s*import\\s+[\\w.]+\\.${simple}\\s*;`, 'm').test(clean)) return null
  const imports = [...clean.matchAll(/^\s*import\s+[\w.*]+\s*;[^\n]*$/gm)]
  if (imports.length) {
    const last = imports[imports.length - 1]
    return { pos: last.index! + last[0].length, text: `\nimport ${fqcn};` }
  }
  const pkg = /^\s*package\s+[\w.]+\s*;[^\n]*$/m.exec(clean)
  if (pkg) return { pos: pkg.index + pkg[0].length, text: `\n\nimport ${fqcn};` }
  return { pos: 0, text: `import ${fqcn};\n\n` }
}

// ───────────── ready-made examples ─────────────

export interface ScriptPreset {
  id: string
  title: L10n
  /** Java for this target (real mod code) */
  code: (target: Pick<Target, 'loader' | 'mc'>) => string
}

const literal = (e: Era, s: string) => (e.old ? `new TextComponent(${s})` : `Component.literal(${s})`)
const textImport = (e: Era) => (e.old ? 'import net.minecraft.network.chat.TextComponent;' : 'import net.minecraft.network.chat.Component;')

function forgeHeader(e: Era, imports: string[]): { imports: string; annotation: string } {
  const sub = e.neo ? 'import net.neoforged.bus.api.SubscribeEvent;' : 'import net.minecraftforge.eventbus.api.SubscribeEvent;'
  const ann = e.neo21
    ? 'import net.neoforged.fml.common.EventBusSubscriber;'
    : e.neo
      ? 'import net.neoforged.fml.common.Mod;'
      : 'import net.minecraftforge.fml.common.Mod;'
  return {
    imports: [...imports, sub, ann].sort().join('\n'),
    annotation: e.neo21 ? '@EventBusSubscriber(modid = NkwMod.MOD_ID)' : '@Mod.EventBusSubscriber(modid = NkwMod.MOD_ID)'
  }
}

export const SCRIPT_PRESETS: ScriptPreset[] = [
  {
    id: 'welcome',
    title: t('Welcome message + gift when a player joins', 'ข้อความต้อนรับ + ของขวัญเมื่อผู้เล่นเข้าโลก'),
    code: (target) => {
      const e = eraOf(target)
      if (e.fabric)
        return `package mod;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
${textImport(e)}
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** Greets every player that joins and gives them some bread. */
public class Welcome implements ModInitializer {
    @Override
    public void onInitialize() {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            ServerPlayer player = handler.player;
            player.displayClientMessage(${literal(e, '"§6Welcome, " + player.getName().getString() + "!"')}, false);
            player.addItem(new ItemStack(Items.BREAD, 3));
            NkwMod.LOGGER.info("{} joined", player.getName().getString());
        });
    }
}
`
      const h = forgeHeader(e, [
        textImport(e),
        'import net.minecraft.world.entity.player.Player;',
        'import net.minecraft.world.item.ItemStack;',
        'import net.minecraft.world.item.Items;',
        `import ${e.neo ? 'net.neoforged.neoforge' : 'net.minecraftforge'}.event.entity.player.PlayerEvent;`
      ])
      return `package mod;

${h.imports}

/** Greets every player that joins and gives them some bread. */
${h.annotation}
public class Welcome {
    @SubscribeEvent
    public static void onJoin(PlayerEvent.PlayerLoggedInEvent event) {
        Player player = event.${e.old && !e.neo ? 'getPlayer()' : 'getEntity()'};
        player.displayClientMessage(${literal(e, '"§6Welcome, " + player.getName().getString() + "!"')}, false);
        player.addItem(new ItemStack(Items.BREAD, 3));
        NkwMod.LOGGER.info("{} joined", player.getName().getString());
    }
}
`
    }
  },
  {
    id: 'wand',
    title: t('Magic wand: right-click a stick for speed + a sound', 'ไม้วิเศษ: คลิกขวาไม้ได้ความเร็ว + เสียง'),
    code: (target) => {
      const e = eraOf(target)
      const effect = 'new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 160, 2)'
      const sound = 'level.playSound(null, player.getX(), player.getY(), player.getZ(), SoundEvents.PLAYER_LEVELUP, SoundSource.PLAYERS, 1.0F, 1.5F);'
      if (e.fabric) {
        const modern = e.v >= 2102
        return `package mod;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
${modern ? 'import net.minecraft.world.InteractionResult;' : 'import net.minecraft.world.InteractionResultHolder;'}
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** Right-click with a stick: a speed boost and a sound. (Swap Items.STICK for ModItems.YOUR_ITEM.) */
public class MagicWand implements ModInitializer {
    @Override
    public void onInitialize() {
        UseItemCallback.EVENT.register((player, level, hand) -> {
            ItemStack stack = player.getItemInHand(hand);
            if (stack.getItem() != Items.STICK) return ${modern ? 'InteractionResult.PASS' : 'InteractionResultHolder.pass(stack)'};
            if (!level.isClientSide) {
                player.addEffect(${effect});
                ${sound}
            }
            return ${modern ? 'InteractionResult.SUCCESS' : 'InteractionResultHolder.success(stack)'};
        });
    }
}
`
      }
      const base = e.neo ? 'net.neoforged.neoforge' : 'net.minecraftforge'
      const h = forgeHeader(e, [
        'import net.minecraft.sounds.SoundEvents;',
        'import net.minecraft.sounds.SoundSource;',
        'import net.minecraft.world.InteractionResult;',
        'import net.minecraft.world.effect.MobEffectInstance;',
        'import net.minecraft.world.effect.MobEffects;',
        'import net.minecraft.world.entity.player.Player;',
        'import net.minecraft.world.item.Items;',
        'import net.minecraft.world.level.Level;',
        `import ${base}.event.entity.player.PlayerInteractEvent;`
      ])
      return `package mod;

${h.imports}

/** Right-click with a stick: a speed boost and a sound. (Swap Items.STICK for ModItems.YOUR_ITEM${e.neo || e.loader === 'forge' ? '.get()' : ''}.) */
${h.annotation}
public class MagicWand {
    @SubscribeEvent
    public static void onRightClick(PlayerInteractEvent.RightClickItem event) {
        if (event.getItemStack().getItem() != Items.STICK) return;
        Player player = event.${e.old && !e.neo ? 'getPlayer()' : 'getEntity()'};
        Level level = event.${e.old && !e.neo ? 'getWorld()' : 'getLevel()'};
        if (!level.isClientSide) {
            player.addEffect(${effect});
            ${sound}
        }
        event.setCancellationResult(InteractionResult.SUCCESS);
        event.setCanceled(true);
    }
}
`
    }
  }
]

/** A new Script node starts with an empty class to fill in. */
export const SCRIPT_STARTER = `package mod;

/**
 * A Java class of your mod — write it like in any Minecraft mod.
 * Pick an example above for your loader, or start from scratch.
 */
public class MyScript {
}
`
