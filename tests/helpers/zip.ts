import { crc32 } from 'node:zlib'

/** A minimal "stored" zip writer for tests; `symlink` marks an entry as a unix symbolic link. */
export function makeZip(files: Record<string, string | Buffer>, opts: { symlink?: string[]; lieAboutSize?: Record<string, number> } = {}): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const nameBuf = Buffer.from(name)
    const crc = name.endsWith('/') ? 0 : crc32(data)
    const declared = opts.lieAboutSize?.[name] ?? data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(declared, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(0x031e, 4) // made by unix
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(declared, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    const mode = opts.symlink?.includes(name) ? 0o120777 : name.endsWith('/') ? 0o040755 : 0o100644
    cd.writeUInt32LE((mode << 16) >>> 0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cdBuf, end])
}
