import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agents, classify, httpClients, patterns, prefersMarkdown, userAgents, type IpRanges } from '../src/index.ts'
import { inCidr, normalizeIp } from '../src/ip.ts'

const CATEGORIES = new Set(['agent', 'ai-crawler', 'crawler', 'bot'])

test('agent data is well formed', () => {
  const ids = new Set<string>()
  for (const a of agents) {
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`)
    ids.add(a.id)
    assert.ok(CATEGORIES.has(a.category), `${a.id} has invalid category`)
    assert.ok(a.userAgents.length > 0 || (a.signatureAgent?.length ?? 0) > 0, `${a.id} has no matcher`)
    assert.match(a.lastVerified, /^\d{4}-\d{2}-\d{2}$/)
    for (const p of a.userAgents) assert.doesNotThrow(() => new RegExp(p, 'i'), `${a.id} pattern ${p}`)
    if (a.userAgents.length > 0) assert.ok(a.examples.length > 0, `${a.id} needs an example`)
  }
})

test('every example user agent classifies as its own entry', () => {
  for (const a of agents) {
    for (const ua of a.examples) {
      const r = classify({ userAgent: ua })
      assert.equal(r.id, a.id, `${ua} classified as ${r.id ?? r.category}`)
      assert.equal(r.category, a.category)
    }
  }
})

test('http clients are bots', () => {
  for (const ua of ['axios/1.13.2', 'curl/8.7.1', 'node', 'python-httpx/0.28.1', 'Go-http-client/2.0', 'Python-urllib/3.12']) {
    assert.equal(classify({ userAgent: ua }).category, 'bot', ua)
  }
  assert.equal(httpClients.length > 0, true)
})

test('claude code is not confused with claude-user or near misses', () => {
  assert.equal(classify({ userAgent: 'Claude-User (claude-code/2.1.308; +https://support.anthropic.com/)' }).version, '2.1.308')
  assert.notEqual(classify({ userAgent: 'Claude-Code-Docs-Fetcher/3.0' }).id, 'claude-code')
  assert.equal(classify({ userAgent: 'Claude-User' }).id, 'claude-user')
  assert.notEqual(classify({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.109.3 Chrome/142.0.0.0 Electron/39.2.3 Safari/537.36' }).id, 'github-copilot')
})

const ranges = (createdAt: string): IpRanges => ({
  'https://openai.com/gptbot.json': { url: 'https://openai.com/gptbot.json', createdAt, cidrs: ['132.196.86.0/24', '2a01:111::/32'] },
})
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)'
const now = new Date('2026-10-23T00:00:00Z')

test('vendor IP verification', () => {
  const ok = classify({ userAgent: GPTBOT, ip: '132.196.86.12' }, { ipRanges: ranges('2026-09-22T00:00:00Z'), now })
  assert.equal(ok.verified, true)
  assert.equal(ok.confidence, 'high')

  const v6 = classify({ userAgent: GPTBOT, ip: '2a01:111:f00::1' }, { ipRanges: ranges('2026-09-22T00:00:00Z'), now })
  assert.equal(v6.verified, true)

  const spoof = classify({ userAgent: GPTBOT, ip: '73.12.4.9' }, { ipRanges: ranges('2026-09-22T00:00:00Z'), now })
  assert.equal(spoof.kind, 'impersonator')
  assert.equal(spoof.verified, false)

  const stale = classify({ userAgent: GPTBOT, ip: '73.12.4.9' }, { ipRanges: ranges('2025-01-01T00:00:00Z'), now })
  assert.equal(stale.id, 'gptbot')
  assert.equal(stale.verified, null)

  const unchecked = classify({ userAgent: GPTBOT, ip: '73.12.4.9' })
  assert.equal(unchecked.id, 'gptbot')
  assert.equal(unchecked.verified, null)
})

test('agents that run on user machines are never treated as spoofed', () => {
  const r = classify({ userAgent: 'Claude-User (claude-code/2.1.308; +https://support.anthropic.com/)', ip: '73.12.4.9' }, { ipRanges: ranges('2026-09-22T00:00:00Z'), now })
  assert.equal(r.id, 'claude-code')
  assert.equal(r.verified, null)
})

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0'
const browserHeaders = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'document', 'Accept-Language': 'en-US', 'Sec-Ch-Ua': '"Chromium";v="149"' }

test('browser header consistency', () => {
  assert.equal(classify({ userAgent: CHROME }).category, 'human')
  assert.equal(classify({ userAgent: CHROME }).confidence, 'low')
  assert.equal(classify({ userAgent: CHROME, headers: browserHeaders }, { headersComplete: true }).category, 'human')
  assert.equal(classify({ userAgent: CHROME, headers: new Headers(browserHeaders) }, { headersComplete: true }).confidence, 'medium')
  assert.equal(classify({ userAgent: CHROME, headers: { 'accept-language': 'en' } }, { headersComplete: true }).kind, 'fake-browser')
  assert.equal(classify({ userAgent: FIREFOX, headers: browserHeaders }, { headersComplete: true }).kind, 'fake-browser')
  assert.equal(classify({ userAgent: CHROME, headers: { 'accept-language': 'en' } }).category, 'human')
})

test('markdown-first Accept means agent, even with a browser user agent', () => {
  const r = classify({ userAgent: CHROME, headers: { Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1' } })
  assert.equal(r.category, 'agent')
  const opencode = classify({ userAgent: CHROME, headers: { accept: 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1' } })
  assert.equal(opencode.id, 'opencode')
})

const signed = { signature: 'sig1=:abc:', 'signature-input': 'sig1=("@authority");tag="web-bot-auth"' }

test('Signature-Agent identifies signed agents in both header forms, at low confidence until verified', () => {
  const a = classify({ userAgent: CHROME, headers: { ...signed, 'signature-agent': '"https://chatgpt.com"' } })
  assert.equal(a.id, 'chatgpt-agent')
  assert.equal(a.confidence, 'low')
  assert.equal(classify({ userAgent: CHROME, headers: { ...signed, 'Signature-Agent': 'sig1="https://agent.bot.goog"' } }).id, 'google-agent')
})

test('a bare Signature-Agent header without a signature is ignored', () => {
  const r = classify({ userAgent: 'curl/8.7.1', headers: { 'signature-agent': '"https://chatgpt.com"' } })
  assert.equal(r.category, 'bot')
  assert.equal(r.kind, 'http-client')
})

test('every example matches exactly one agent entry', () => {
  const compiled = agents.map((a) => ({ id: a.id, patterns: a.userAgents.map((p) => new RegExp(p, 'i')) }))
  for (const a of agents) {
    for (const ua of a.examples) {
      const hits = compiled.filter((c) => c.patterns.some((p) => p.test(ua))).map((c) => c.id)
      assert.deepEqual(hits, [a.id], `${ua} matches ${hits.join(', ')}`)
    }
  }
})

test('unusable IP input never produces an impersonator', () => {
  const opts = { ipRanges: ranges('2026-09-22T00:00:00Z'), now }
  for (const ip of ['::ffff:132.196.86.5', '132.196.86.5:443', '[::ffff:132.196.86.5]:443']) {
    const r = classify({ userAgent: GPTBOT, ip }, opts)
    assert.equal(r.verified, true, ip)
  }
  for (const ip of ['132.196.86.5, 10.0.0.1', 'unknown', '', '999.1.1.1', null]) {
    const r = classify({ userAgent: GPTBOT, ip }, opts)
    assert.equal(r.id, 'gptbot', ip)
    assert.equal(r.verified, null, ip)
  }
  const empty: IpRanges = { 'https://openai.com/gptbot.json': { url: 'https://openai.com/gptbot.json', createdAt: '2026-09-22T00:00:00Z', cidrs: [] } }
  assert.equal(classify({ userAgent: GPTBOT, ip: '132.196.86.5' }, { ipRanges: empty, now }).verified, null)
})

test('normalizeIp', () => {
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4')
  assert.equal(normalizeIp('1.2.3.4:80'), '1.2.3.4')
  assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:db8::1')
  assert.equal(normalizeIp(' 2001:db8::1 '), '2001:db8::1')
  assert.equal(normalizeIp('1.2.3.4, 5.6.7.8'), undefined)
  assert.equal(normalizeIp('nope'), undefined)
})

test('real browsers on every platform count as human', () => {
  for (const ua of [
    'Mozilla/5.0 (Android 16; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
  ]) {
    assert.equal(classify({ userAgent: ua }).category, 'human', ua)
  }
})

test('Accept fingerprints ignore spacing and case', () => {
  assert.equal(classify({ headers: { accept: 'text/markdown;q=1.0,text/x-markdown;q=0.9,text/plain;q=0.8,text/html;q=0.7,*/*;q=0.1' } }).id, 'opencode')
  assert.equal(classify({ headers: { accept: 'TEXT/MARKDOWN; Q=1.0, text/x-markdown; q=0.9, text/plain; q=0.8, text/html; q=0.7, */*; q=0.1' } }).id, 'opencode')
})

test('a browser user agent that ranks text/plain above HTML is not a browser', () => {
  assert.equal(classify({ userAgent: CHROME, headers: { accept: 'text/plain, text/html;q=0.9' } }).kind, 'fake-browser')
  assert.equal(classify({ userAgent: CHROME, headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } }).category, 'human')
})

test('prefersMarkdown', () => {
  assert.equal(prefersMarkdown('text/markdown'), true)
  assert.equal(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'), false)
  assert.equal(prefersMarkdown('text/html;q=0.5, text/markdown'), true)
  assert.equal(prefersMarkdown('text/html, text/markdown;q=0.9'), false)
  assert.equal(prefersMarkdown('text/markdown;q=0, text/html'), false)
  assert.equal(prefersMarkdown('text/markdown; charset=utf-8'), true)
  assert.equal(prefersMarkdown('text/html;q=bogus, text/markdown;q=0.5'), false)
})

test('inCidr', () => {
  assert.equal(inCidr('10.1.2.3', '10.0.0.0/8'), true)
  assert.equal(inCidr('11.1.2.3', '10.0.0.0/8'), false)
  assert.equal(inCidr('2001:4860:4801:10::1', '2001:4860:4801:10::/64'), true)
  assert.equal(inCidr('2001:4860:4801:11::1', '2001:4860:4801:10::/64'), false)
  assert.equal(inCidr('10.1.2.3', '2001:4860::/32'), false)
})

test('fallbacks', () => {
  assert.equal(classify({}).category, 'unknown')
  assert.equal(classify({ userAgent: '', headers: { accept: '*/*' } }).category, 'bot')
  assert.equal(classify({ userAgent: 'docs-mirror/1.0 (+https://example.com/bot)' }).category, 'bot')
  assert.equal(classify({ userAgent: 'ARCTIC' }).category, 'bot')
  assert.equal(classify({ userAgent: 'Mozilla/5.0' }).category, 'bot')
  assert.equal(classify({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }).category, 'bot')
})

test('older and embedded browsers count as human', () => {
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko',
    'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; WOW64; Trident/4.0)',
    'Mozilla/5.0 (X11; Linux x86_64; rv:25.0) Gecko/20100101 conkeror/1.0pre',
    'Mozilla/5.0 (Linux; Android 6.0; CUBOT MAX Build/MRA58K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.81 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Mobile Safari/537.36 (Ecosia android@111.0.5563.116)',
    'Lynx/2.9.0dev.12 libwww-FM/2.14 SSL-MM/1.4.1 GNUTLS/3.7.8',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.123 Mobile Safari/537.36 CamScanner/4.8.5.2310271827',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML,like Gecko) Version/16.6.1 Mobile/15E148 Safari/605.1.15 NewsSapphire/1.0.4',
    'Mozilla/5.0 (compatible; Konqueror/4.4; Linux) KHTML/4.4.5 (like Gecko) Kubuntu',
  ]) {
    assert.equal(classify({ userAgent: ua }).category, 'human', ua)
  }
})

test('tools that borrow a browser user agent are not human', () => {
  for (const ua of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.61 Safari/537.36 ArchiveBox/0.6.2',
    'Mozilla/5.0 (compatible; GlintbaseResearch/1.0)',
    'Mozilla/5.0 (X11; Linux x86_64; Splunk Synthetics) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.88 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36; Selenium',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36 PTST/SpeedCurve/230120.120134',
  ]) {
    assert.equal(classify({ userAgent: ua }).category, 'bot', ua)
  }
  assert.equal(classify({ userAgent: CHROME, headers: { accept: '*/*,application/metalink4+xml,application/metalink+xml' } }).kind, 'fake-browser')
})

test('category patterns match each example in exactly its own category', () => {
  for (const a of agents) {
    for (const ua of a.examples) {
      const hits = Object.entries(patterns).filter(([, re]) => re.test(ua)).map(([c]) => c)
      assert.deepEqual(hits, [a.category], `${ua} matches ${hits.join(', ')}`)
    }
  }
  assert.ok(patterns.bot.test('curl/8.7.1'))
  assert.ok(!patterns.agent.test('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'))
  assert.equal(userAgents.agent.length, agents.filter((a) => a.category === 'agent').reduce((n, a) => n + a.userAgents.length, 0))
})
