import { t, type L10n } from '../l10n'

/**
 * Node types that no longer exist. A project that still has one keeps the node (its data is not lost) and
 * the compiler only warns, instead of reporting an unknown node type.
 */
export const REMOVED_NODE_TYPES: Record<string, L10n> = {
  script: t(
    'Script (Java class) nodes are no longer supported: this node is ignored. Delete it, or keep it to copy its code.',
    'โหนดสคริปต์ (คลาส Java) ไม่รองรับแล้ว: โหนดนี้จะถูกข้าม ลบทิ้งได้ หรือเก็บไว้เพื่อคัดลอกโค้ด'
  ),
  reroute: t(
    'Reroute nodes have been removed: connect pins directly.',
    'โหนดจุดพักสายถูกนำออกแล้ว: ลากสายเชื่อมต่อหากันโดยตรง'
  ),
  mob: t(
    'Mob nodes are no longer supported in the core editor.',
    'โหนดม็อบถูกนำออกจากโปรแกรมหลักแล้ว'
  ),
  toolMaterial: t(
    'Tool Material nodes have been removed: configure mineral tier directly on the tool.',
    'โหนดวัสดุเครื่องมือถูกนำออกแล้ว: กำหนดประเภทแร่ในตัวเครื่องมือได้โดยตรง'
  ),
  armorMaterial: t(
    'Armor Material nodes have been removed: configure material tier directly on the armor piece.',
    'โหนดวัสดุเกราะถูกนำออกแล้ว: กำหนดประเภทวัสดุในตัวชิ้นเกราะได้โดยตรง'
  ),
  gameCrop: t(
    'Vanilla crop harvesting is now part of the RP Add-on.',
    'ระบบเก็บเกี่ยวพืชในเกมย้ายไปอยู่ใน RP Add-on แล้ว'
  )
}
