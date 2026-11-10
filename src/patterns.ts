import { agents, httpClients, type Category } from './data.ts'

const categories: Category[] = ['agent', 'ai-crawler', 'crawler', 'bot']

export const userAgents = Object.fromEntries(categories.map((c) => [c, [] as string[]])) as Record<Category, string[]>

for (const a of agents) userAgents[a.category].push(...a.userAgents)
for (const c of httpClients) userAgents.bot.push(c.userAgent)

const combine = (list: string[]) => new RegExp(list.map((p) => `(?:${p.replace(/\(\?<\w+>/g, '(?:')})`).join('|'), 'i')

export const patterns = Object.fromEntries(categories.map((c) => [c, combine(userAgents[c])])) as Record<Category, RegExp>
