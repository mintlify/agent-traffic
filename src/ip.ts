export type IpRangeFile = { url: string; createdAt?: string; cidrs: string[] }
export type IpRanges = Record<string, IpRangeFile>

type Parsed = { v6: boolean; value: bigint }

function parseV4(ip: string): bigint | undefined {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  let n = 0n
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return undefined
    n = (n << 8n) | BigInt(p)
  }
  return n
}

function parseV6(ip: string): bigint | undefined {
  const zone = ip.indexOf('%')
  let s = zone === -1 ? ip : ip.slice(0, zone)
  const v4Tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4Tail) {
    const v4 = parseV4(v4Tail[1])
    if (v4 === undefined) return undefined
    s = s.slice(0, -v4Tail[1].length) + ((v4 >> 16n) & 0xffffn).toString(16) + ':' + (v4 & 0xffffn).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return undefined
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail]
  if (groups.length !== 8) return undefined
  let n = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined
    n = (n << 16n) | BigInt(parseInt(g, 16))
  }
  return n
}

export function parseIp(ip: string): Parsed | undefined {
  const s = ip.trim()
  if (s.includes(':')) {
    const value = parseV6(s)
    return value === undefined ? undefined : { v6: true, value }
  }
  const value = parseV4(s)
  return value === undefined ? undefined : { v6: false, value }
}

function toV4String(n: bigint): string {
  return [24n, 16n, 8n, 0n].map((s) => ((n >> s) & 0xffn).toString()).join('.')
}

export function normalizeIp(ip: string): string | undefined {
  const s = ip.trim()
  if (!s || s.includes(',')) return undefined
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/)
  const v4WithPort = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  const candidate = bracketed ? bracketed[1] : v4WithPort ? v4WithPort[1] : s
  const parsed = parseIp(candidate)
  if (!parsed) return undefined
  if (parsed.v6 && parsed.value >> 32n === 0xffffn) return toV4String(parsed.value & 0xffffffffn)
  return candidate
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/')
  const a = parseIp(ip)
  const b = parseIp(base)
  if (!a || !b || a.v6 !== b.v6) return false
  const width = a.v6 ? 128n : 32n
  const bits = BigInt(bitsRaw ?? width.toString())
  const mask = bits === 0n ? 0n : ((1n << bits) - 1n) << (width - bits)
  return (a.value & mask) === (b.value & mask)
}

export function inRanges(ip: string, file: IpRangeFile): boolean {
  const normalized = normalizeIp(ip)
  return normalized !== undefined && file.cidrs.some((c) => inCidr(normalized, c))
}

export function parseRangeFile(url: string, body: unknown): IpRangeFile {
  const json = body as { creationTime?: string; prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] }
  const cidrs = (json.prefixes ?? []).map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter((c): c is string => !!c)
  return { url, createdAt: json.creationTime, cidrs }
}
