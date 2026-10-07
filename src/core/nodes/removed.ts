import { t, type L10n } from '../l10n'

/**
 * Node types that no longer exist. A project that still has one keeps the node (its data is not lost) and
 * the compiler only warns, instead of reporting an unknown node type.
 */
export const REMOVED_NODE_TYPES: Record<string, L10n> = {
  script: t(
    'Script (Java class) nodes are no longer supported: this node is ignored. Delete it, or keep it to copy its code.',
    'โหนดสคริปต์ (คลาส Java) ไม่รองรับแล้ว: โหนดนี้จะถูกข้าม ลบทิ้งได้ หรือเก็บไว้เพื่อคัดลอกโค้ด'
  )
}
