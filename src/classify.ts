import { agents, httpClients, type Agent, type Category } from './data.ts'
import { inRanges, normalizeIp, type IpRangeFile, type IpRanges } from './ip.ts'

export type Confidence = 'high' | 'medium' | 'low'

export type Classification = {
  category: Category | 'human' | 'unknown'
  kind?: string
  id?: string
  name?: string
  operator?: string
  version?: string
  verified: boolean | null
  confidence: Confidence
  reasons: string[]
}

export type HeaderInput = Headers | Record<string, string | string[] | undefined>

export type RequestInput = {
  userAgent?: string
  headers?: HeaderInput
  ip?: string | null
}

export type ClassifyOptions = {
  ipRanges?: IpRanges
  headersComplete?: boolean
  maxRangeAgeDays?: number
  now?: Date
}

const compiledAgents = agents.map((a) => ({ agent: a, patterns: a.userAgents.map((p) => new RegExp(p, 'i')) }))
const compiledClients = httpClients.map((c) => ({ client: c, pattern: new RegExp(c.userAgent, 'i') }))
const BROWSER = /^Mozilla\/[4-6]\.0 \(|^Opera\/\d/
const BROWSER_ENGINE = /\(KHTML,? ?like Gecko|KHTML\/[\d.]+ \(like Gecko|Gecko\/\d|\) like Gecko|Trident\/\d|MSIE \d|Presto\/\d|Chromium\/\d/
const TEXT_BROWSER = /^(Lynx|ELinks|Links|w3m)\//
const BOT_WORD = /(?:[a-z0-9-]|\b)[Bb]ot(?:\b|\/)/
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}/i
const AUTOMATION = /crawl|spider|scrap|headless|https?:\/\/|\+http|(?:^|[^a-z])(?:archive|observ|monitor|check(?:er)?\b|preview|verif|render|insight|console|transcod|scanner|synthetic)|lighthouse|selenium|cypress|webdriver|\bsplash\b|gomezagent|rigor|speedcurve|\bptst\b|dareboost|dejaclick|favicon|siteimprove|onetrust|datanyze|feeder\.co|rss\b|weblight|duplexweb|ips-agent/i

function isBrowser(ua: string): boolean {
  if (TEXT_BROWSER.test(ua)) return true
  if (!BROWSER.test(ua) || !BROWSER_ENGINE.test(ua)) return false
  if (BOT_WORD.test(ua) || EMAIL.test(ua) || AUTOMATION.test(ua)) return false
  return !/compatible;/.test(ua) || /MSIE|Trident|Konqueror/.test(ua)
}

function normalizeHeaders(input?: HeaderInput): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input) return out
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    input.forEach((v, k) => (out[k] = v))
    return out
  }
  for (const [k, v] of Object.entries(input as Record<string, string | string[] | undefined>)) {
    if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

function rankAccept(accept: string) {
  return accept
    .split(',')
    .map((part, i) => {
      const [type, ...params] = part.trim().toLowerCase().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const parsed = q ? Number(q.slice(2)) : 1
      return { type: type.trim(), q: Number.isNaN(parsed) ? 1 : parsed, i }
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
}

function ranksAboveHtml(accept: string, types: string[]): boolean {
  const ranked = rankAccept(accept)
  const md = ranked.findIndex((r) => types.includes(r.type))
  if (md === -1) return false
  const html = ranked.findIndex((r) => r.type === 'text/html')
  return html === -1 || md < html
}

export function prefersMarkdown(accept: string): boolean {
  return ranksAboveHtml(accept, ['text/markdown', 'text/x-markdown'])
}

function normalizeAccept(accept: string): string {
  return accept.toLowerCase().replace(/\s*([,;=])\s*/g, '$1').trim()
}

function signatureAgentHost(value: string): string | undefined {
  const url = value.match(/https?:\/\/([^/"\s]+)/i)
  if (url) return url[1].toLowerCase()
  const bare = value.replace(/^[\w-]+=/, '').replace(/"/g, '').trim()
  return bare ? bare.toLowerCase() : undefined
}

type AgentMatch = { agent: Agent; version?: string; reason: string; weak?: boolean }

function findAgent(ua: string, h: Record<string, string>): AgentMatch | undefined {
  for (const { agent, patterns } of compiledAgents) {
    for (const p of patterns) {
      const m = p.exec(ua)
      if (m) return { agent, version: m.groups?.version, reason: `user agent matches ${agent.name}` }
    }
  }
  const accept = h['accept'] && normalizeAccept(h['accept'])
  if (accept) {
    const agent = agents.find((a) => a.accept?.some((x) => normalizeAccept(x) === accept))
    if (agent) return { agent, reason: `Accept header matches ${agent.name}'s fingerprint` }
  }
  const signed = h['signature'] && h['signature-input']
  const sig = signed && h['signature-agent'] && signatureAgentHost(h['signature-agent'])
  if (sig) {
    const agent = agents.find((a) => a.signatureAgent?.includes(sig))
    if (agent) return { agent, weak: true, reason: `signed request names ${sig} in Signature-Agent; the signature itself is not verified` }
  }
  return undefined
}

function ageDays(createdAt: string | undefined, now: Date): number {
  const t = createdAt ? Date.parse(createdAt) : NaN
  return Number.isNaN(t) ? Infinity : (now.getTime() - t) / 86_400_000
}

function fromAgent(match: AgentMatch, rawIp: string | null | undefined, opts: ClassifyOptions): Classification {
  const { agent } = match
  const base: Classification = {
    category: agent.category,
    kind: agent.kind,
    id: agent.id,
    name: agent.name,
    operator: agent.operator,
    version: match.version,
    verified: null,
    confidence: match.weak ? 'low' : 'medium',
    reasons: [match.reason],
  }
  if (agent.runsOn === 'user') {
    base.reasons.push(`${agent.name} runs on the user's machine, so IP verification does not apply`)
    return base
  }
  const ip = rawIp == null ? undefined : normalizeIp(rawIp)
  if (rawIp != null && ip === undefined) {
    base.reasons.push(`IP "${rawIp}" is not a single valid address, so it was not checked`)
    return base
  }
  const urls = agent.verify?.ipRanges ?? []
  const files = urls.map((u) => opts.ipRanges?.[u]).filter((f): f is IpRangeFile => f !== undefined && f.cidrs.length > 0)
  if (!ip || files.length === 0) return base
  if (files.some((f) => inRanges(ip, f))) {
    return { ...base, verified: true, confidence: 'high', reasons: [...base.reasons, `${ip} is in ${agent.operator}'s published ranges`] }
  }
  const now = opts.now ?? new Date()
  const maxAge = opts.maxRangeAgeDays ?? 180
  if (files.some((f) => ageDays(f.createdAt, now) <= maxAge)) {
    return {
      category: 'bot',
      kind: 'impersonator',
      verified: false,
      confidence: 'high',
      reasons: [`claims to be ${agent.name} but ${ip} is outside ${agent.operator}'s published ranges`],
    }
  }
  return { ...base, reasons: [...base.reasons, `${agent.operator}'s range file is older than ${maxAge} days, so a mismatch is not treated as spoofing`] }
}

function majorVersion(ua: string, re: RegExp): number {
  const m = ua.match(re)
  return m ? Number(m[1]) : 0
}

function sendsFetchMetadata(ua: string): boolean {
  if (/Firefox\//.test(ua)) return majorVersion(ua, /Firefox\/(\d+)/) >= 90
  if (/Chrome\//.test(ua)) return majorVersion(ua, /Chrome\/(\d+)/) >= 80
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return majorVersion(ua, /Version\/(\d+)/) >= 17
  return false
}

function fromBrowser(ua: string, h: Record<string, string>, opts: ClassifyOptions): Classification {
  const fake = (reason: string, confidence: Confidence): Classification => ({ category: 'bot', kind: 'fake-browser', verified: null, confidence, reasons: [reason] })
  if (h['accept'] && ranksAboveHtml(h['accept'], ['text/plain'])) return fake('Accept header ranks text/plain above HTML, which browsers never do', 'low')
  if (h['accept']?.includes('application/metalink')) return fake('Accept header asks for metalink, which download tools send and browsers do not', 'medium')
  if (!opts.headersComplete) {
    return { category: 'human', verified: null, confidence: 'low', reasons: ['browser user agent; headers not checked'] }
  }
  if (h['sec-ch-ua'] && !/Chrome\//.test(ua)) return fake('sec-ch-ua sent with a non-Chromium user agent', 'high')
  if (!h['sec-fetch-mode'] && sendsFetchMetadata(ua)) return fake('browser user agent without sec-fetch-* headers', 'medium')
  if (!h['accept-language']) return fake('browser user agent without Accept-Language', 'low')
  return { category: 'human', verified: null, confidence: 'medium', reasons: ['browser user agent with consistent browser headers'] }
}

export function classify(input: RequestInput, opts: ClassifyOptions = {}): Classification {
  const h = normalizeHeaders(input.headers)
  const ua = (input.userAgent ?? h['user-agent'] ?? '').trim()

  const match = findAgent(ua, h)
  if (match) return fromAgent(match, input.ip, opts)

  if (h['accept'] && prefersMarkdown(h['accept'])) {
    return { category: 'agent', kind: 'unidentified', verified: null, confidence: 'medium', reasons: ['Accept header prefers markdown over HTML, which browsers never do'] }
  }

  const client = compiledClients.find((c) => c.pattern.test(ua))?.client
  if (client) {
    return { category: 'bot', kind: client.kind, name: client.name, verified: null, confidence: 'medium', reasons: [`user agent is ${client.name}`] }
  }

  if (isBrowser(ua)) return fromBrowser(ua, h, opts)

  if (!ua && Object.keys(h).length === 0) return { category: 'unknown', verified: null, confidence: 'low', reasons: ['no user agent or headers to classify'] }
  if (!ua) return { category: 'bot', kind: 'unidentified', verified: null, confidence: 'low', reasons: ['request has no user agent, which browsers always send'] }
  return { category: 'bot', kind: 'unidentified', verified: null, confidence: 'low', reasons: ['user agent is not a browser and matches no known agent, crawler or client'] }
}
