/**
 * Forge 1.16.5's "official" mapping channel renames methods/fields only; classes keep their
 * MCP names and packages. This rewrites generated (Mojang-named) Java to those class names.
 */

/** Mojang FQCN → MCP FQCN (1.16.5) for every Minecraft class the generators use. */
const CLASSES: Record<string, string> = {
  'net.minecraft.resources.ResourceLocation': 'net.minecraft.util.ResourceLocation',
  'net.minecraft.world.item.Item': 'net.minecraft.item.Item',
  'net.minecraft.world.item.ItemStack': 'net.minecraft.item.ItemStack',
  'net.minecraft.world.item.Items': 'net.minecraft.item.Items',
  'net.minecraft.world.item.BlockItem': 'net.minecraft.item.BlockItem',
  'net.minecraft.world.item.Rarity': 'net.minecraft.item.Rarity',
  'net.minecraft.world.item.Tier': 'net.minecraft.item.IItemTier',
  'net.minecraft.world.item.ArmorItem': 'net.minecraft.item.ArmorItem',
  'net.minecraft.world.item.ArmorMaterial': 'net.minecraft.item.IArmorMaterial',
  'net.minecraft.world.item.RecordItem': 'net.minecraft.item.MusicDiscItem',
  'net.minecraft.world.item.CreativeModeTab': 'net.minecraft.item.ItemGroup',
  'net.minecraft.world.item.SwordItem': 'net.minecraft.item.SwordItem',
  'net.minecraft.world.item.PickaxeItem': 'net.minecraft.item.PickaxeItem',
  'net.minecraft.world.item.AxeItem': 'net.minecraft.item.AxeItem',
  'net.minecraft.world.item.ShovelItem': 'net.minecraft.item.ShovelItem',
  'net.minecraft.world.item.HoeItem': 'net.minecraft.item.HoeItem',
  'net.minecraft.world.item.context.BlockPlaceContext': 'net.minecraft.item.BlockItemUseContext',
  'net.minecraft.world.item.crafting.Ingredient': 'net.minecraft.item.crafting.Ingredient',
  'net.minecraft.world.food.FoodProperties': 'net.minecraft.item.Food',
  'net.minecraft.world.entity.EquipmentSlot': 'net.minecraft.inventory.EquipmentSlotType',
  'net.minecraft.sounds.SoundEvent': 'net.minecraft.util.SoundEvent',
  'net.minecraft.sounds.SoundEvents': 'net.minecraft.util.SoundEvents',
  'net.minecraft.tags.Tag': 'net.minecraft.tags.ITag',
  'net.minecraft.tags.ItemTags': 'net.minecraft.tags.ItemTags',
  'net.minecraft.world.level.block.Block': 'net.minecraft.block.Block',
  'net.minecraft.world.level.block.RotatedPillarBlock': 'net.minecraft.block.RotatedPillarBlock',
  'net.minecraft.world.level.block.SoundType': 'net.minecraft.block.SoundType',
  'net.minecraft.world.level.block.state.BlockBehaviour': 'net.minecraft.block.AbstractBlock',
  'net.minecraft.world.level.block.state.BlockState': 'net.minecraft.block.BlockState',
  'net.minecraft.world.level.block.state.StateDefinition': 'net.minecraft.state.StateContainer',
  'net.minecraft.world.level.block.state.properties.BlockStateProperties': 'net.minecraft.state.properties.BlockStateProperties',
  'net.minecraft.world.level.block.state.properties.DirectionProperty': 'net.minecraft.state.DirectionProperty',
  'net.minecraft.world.level.material.Material': 'net.minecraft.block.material.Material',
  'net.minecraft.world.level.BlockGetter': 'net.minecraft.world.IBlockReader',
  'net.minecraft.core.Direction': 'net.minecraft.util.Direction',
  'net.minecraft.core.BlockPos': 'net.minecraft.util.math.BlockPos',
  'net.minecraft.world.phys.shapes.CollisionContext': 'net.minecraft.util.math.shapes.ISelectionContext',
  'net.minecraft.world.phys.shapes.VoxelShape': 'net.minecraft.util.math.shapes.VoxelShape',
  'net.minecraft.world.phys.shapes.Shapes': 'net.minecraft.util.math.shapes.VoxelShapes',
  'net.minecraft.client.renderer.RenderType': 'net.minecraft.client.renderer.RenderType',
  'net.minecraft.client.renderer.ItemBlockRenderTypes': 'net.minecraft.client.renderer.RenderTypeLookup',
  'net.minecraft.world.effect.MobEffect': 'net.minecraft.potion.Effect',
  'net.minecraft.world.effect.MobEffects': 'net.minecraft.potion.Effects',
  'net.minecraft.world.effect.MobEffectInstance': 'net.minecraft.potion.EffectInstance',
  'net.minecraft.world.entity.LivingEntity': 'net.minecraft.entity.LivingEntity',
  'net.minecraft.world.entity.Entity': 'net.minecraft.entity.Entity',
  'net.minecraft.world.level.Level': 'net.minecraft.world.World',
  'net.minecraft.world.item.ItemNameBlockItem': 'net.minecraft.item.BlockNamedItem',
  'net.minecraft.world.level.block.entity.BlockEntity': 'net.minecraft.tileentity.TileEntity',
  'net.minecraft.world.level.block.entity.JukeboxBlockEntity': 'net.minecraft.tileentity.JukeboxTileEntity',
  // Forge API that moved later
  'net.minecraftforge.registries.RegistryObject': 'net.minecraftforge.fml.RegistryObject'
}

/** Simple-name renames inside code (word-bounded). Nested types first. */
const NAMES: [RegExp, string][] = [
  [/\bTag\.Named\b/g, 'ITag.INamedTag'],
  [/\bBlockBehaviour\b/g, 'AbstractBlock'],
  [/\bStateDefinition\b/g, 'StateContainer'],
  [/\bFoodProperties\b/g, 'Food'],
  [/\bTier\b/g, 'IItemTier'],
  [/\bArmorMaterial\b/g, 'IArmorMaterial'],
  [/\bEquipmentSlot\b/g, 'EquipmentSlotType'],
  [/\bRecordItem\b/g, 'MusicDiscItem'],
  [/\bCreativeModeTab\b/g, 'ItemGroup'],
  [/\bBlockPlaceContext\b/g, 'BlockItemUseContext'],
  [/\bBlockGetter\b/g, 'IBlockReader'],
  [/\bCollisionContext\b/g, 'ISelectionContext'],
  [/\bShapes\b/g, 'VoxelShapes'],
  [/\bItemBlockRenderTypes\b/g, 'RenderTypeLookup'],
  [/\bMobEffectInstance\b/g, 'EffectInstance'],
  [/\bMobEffects\b/g, 'Effects'],
  [/\bMobEffect\b/g, 'Effect'],
  [/\bLevel\b/g, 'World'],
  [/\bItemNameBlockItem\b/g, 'BlockNamedItem'],
  [/\bJukeboxBlockEntity\b/g, 'JukeboxTileEntity'],
  [/\bBlockEntity\b/g, 'TileEntity']
]

export function toMcp1165(java: string): string {
  const [head, ...rest] = java.split(/\n(?=(?:public |@Mod|\/\*\*))/)
  const imports = head.replace(/^import ([\w.]+);$/gm, (line, fqcn: string) => (CLASSES[fqcn] ? `import ${CLASSES[fqcn]};` : line))
  let body = rest.join('\n')
  for (const [re, to] of NAMES) body = body.replace(re, to)
  return rest.length ? `${imports}\n${body}` : imports
}
