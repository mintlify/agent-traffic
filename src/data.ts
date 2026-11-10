import agentsJson from '../data/agents.json' with { type: 'json' }
import httpClientsJson from '../data/http-clients.json' with { type: 'json' }
import headersJson from '../data/headers.json' with { type: 'json' }

export type Category = 'agent' | 'ai-crawler' | 'crawler' | 'bot'

export type Agent = {
  id: string
  name: string
  operator: string
  category: Category
  kind: string
  runsOn: 'operator' | 'user'
  userAgents: string[]
  accept?: string[]
  signatureAgent?: string[]
  verify?: { ipRanges?: string[]; reverseDns?: string[]; webBotAuth?: string }
  docs?: string
  examples: string[]
  notes?: string
  lastVerified: string
}

export type HttpClient = { name: string; kind: 'http-client' | 'headless'; userAgent: string }

export type HeaderSignal = { header: string; controlledBy: string; meaning: string; usedBy: string }

export const agents = agentsJson as Agent[]
export const httpClients = httpClientsJson as HttpClient[]
export const headers = headersJson as HeaderSignal[]
