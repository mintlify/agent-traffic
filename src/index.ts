import { agents } from './data.ts'
import { parseRangeFile, type IpRanges } from './ip.ts'

export { classify, prefersMarkdown } from './classify.ts'
export type { Classification, ClassifyOptions, Confidence, HeaderInput, RequestInput } from './classify.ts'
export { agents, httpClients, headers } from './data.ts'
export { patterns, userAgents } from './patterns.ts'
export type { Agent, Category, HeaderSignal, HttpClient } from './data.ts'
export type { IpRangeFile, IpRanges } from './ip.ts'

export async function loadIpRanges(fetchImpl: typeof fetch = fetch): Promise<IpRanges> {
  const urls = [...new Set(agents.flatMap((a) => a.verify?.ipRanges ?? []))]
  const results = await Promise.allSettled(urls.map(async (url) => parseRangeFile(url, await (await fetchImpl(url)).json())))
  const out: IpRanges = {}
  for (const r of results) if (r.status === 'fulfilled' && r.value.cidrs.length > 0) out[r.value.url] = r.value
  return out
}
