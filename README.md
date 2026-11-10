# agent-traffic

Tell agents, AI crawlers, search crawlers and bots apart from people.

Mintlify hosts documentation for thousands of companies, and those sites serve hundreds of millions of requests a month. For years almost all of that came from developers reading docs in a browser. Now a growing share comes from agents: Claude Code pulling a page into a coding session, ChatGPT answering a question with your docs, Cursor checking an API reference before it writes a call.

As that traffic grew, we kept needing to answer questions our tools couldn't. How much of our traffic is agents, and which ones? Is that request from GPTBot really OpenAI, or someone borrowing the name? Is a coding agent reading the docs, or is an AI company crawling them for training data, or a script mirroring `llms.txt` every hour? The bot lists we started with matched user agent substrings, put everything automated into one bucket, and believed whatever a request claimed to be.

So we built our own. We studied our traffic, tested the existing open-source bot lists against it, and kept track of which signals actually separate one kind of request from another. agent-traffic is what came out of that: a tested dataset of the user agents, headers and official verification sources of real agents and crawlers, plus a small classifier that applies it. We're open-sourcing it so you don't have to learn all of this from scratch.

## Get started with your agent

Install the skill in Claude Code, Cursor, Codex or any agent the [skills CLI](https://skills.sh) supports:

```
npx skills add mintlify/agent-traffic
```

The [skill](skills/agent-traffic/SKILL.md) teaches your agent how classification works and how to use the package and dataset, from request handlers to stored logs. Then ask it for whatever you need. You can also paste the skill's URL straight into any agent.

## What it does

```js
import { classify } from '@mintlify/agent-traffic'

classify({ userAgent: 'Claude-User (claude-code/2.1.308; +https://support.anthropic.com/)' })
// { category: 'agent', kind: 'coding', name: 'Claude Code', operator: 'Anthropic', version: '2.1.308', ... }

classify({ userAgent: 'axios/1.13.2' })
// { category: 'bot', kind: 'http-client', name: 'axios', ... }
```

- A curated, tested dataset of the user agents, headers and official verification sources of real agents and crawlers
- Verifies crawlers against their operators' published IP ranges and catches impersonators
- Every result explains itself
- Zero dependencies, and runs anywhere `fetch` does: Node, Bun, Deno, Cloudflare Workers, Vercel Edge

## Install it yourself

```
npm i @mintlify/agent-traffic
```

## Usage

In a Cloudflare Worker, pass the request headers and the real client IP:

```js
import { classify, loadIpRanges } from '@mintlify/agent-traffic'

let ipRanges

export default {
  async fetch(request) {
    ipRanges ??= loadIpRanges()

    const result = classify(
      { headers: request.headers, ip: request.headers.get('cf-connecting-ip') },
      { ipRanges: await ipRanges, headersComplete: true }
    )

    if (result.category === 'agent') {
      return serveMarkdown(request)
    }

    return fetch(request)
  }
}
```

The ranges load on the first request because Workers can't fetch at startup, and caching the promise keeps concurrent requests from each downloading them. `headersComplete` turns on the fake-browser checks, which is safe when browser headers reach the Worker untouched over HTTPS; leave it off if plain HTTP or a proxy in front can strip them.

Someone spoofing a crawler gets caught:

```js
classify({ userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)', ip: '73.12.4.9' }, { ipRanges })
// { category: 'bot', kind: 'impersonator', verified: false, confidence: 'high',
//   reasons: ["claims to be GPTBot but 73.12.4.9 is outside OpenAI's published ranges"] }
```

Agents that hide behind a browser user agent still ask for markdown:

```js
classify({ headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; ...) Chrome/149.0.0.0 Safari/537.36', accept: 'text/markdown, text/html;q=0.9' } })
// { category: 'agent', kind: 'unidentified', confidence: 'medium',
//   reasons: ['Accept header prefers markdown over HTML, which browsers never do'] }
```

Just need a quick check? Each category is also available as a single regular expression:

```js
import { patterns } from '@mintlify/agent-traffic'

patterns.agent.test(userAgent)
patterns['ai-crawler'].test(userAgent)
```

## Querying your logs

Your agent can do this for you with the [skill](skills/agent-traffic/SKILL.md). It translates the patterns for your database; ClickHouse, DuckDB and Postgres are verified.

To do it yourself, classify each distinct user agent once and join the results:

```js
import { classify } from '@mintlify/agent-traffic'

const rows = distinctUserAgents.map((ua) => ({ user_agent: ua, ...classify({ userAgent: ua }) }))
// load rows into a table, then: SELECT ... FROM logs JOIN user_agent_classes USING (user_agent)
```

Logs usually keep only the user agent. That still identifies known agents, crawlers and HTTP clients, but agents that borrow a browser user agent will look like people unless you also log the `Accept` header.

## Categories

| `category` | Meaning | `kind` |
|---|---|---|
| `agent` | An AI product fetching a page right now, for a person | `assistant`, `coding`, `browser`, `unidentified` |
| `ai-crawler` | An AI company collecting pages ahead of time | `training`, `ai-search`, `ingest` |
| `crawler` | A search engine | `search` |
| `bot` | Any other automation | `seo`, `preview`, `ads`, `monitor`, `scanner`, `archiver`, `feed`, `http-client`, `headless`, `fake-browser`, `impersonator`, `unidentified` |
| `human` | A person in a browser | |
| `unknown` | Nothing to classify (no user agent or headers) | |

## API

### `classify(request, options?)`

`request`:

| Field | Type | |
|---|---|---|
| `userAgent` | `string` | Read from `headers` when omitted |
| `headers` | `Headers \| Record<string, string \| string[]>` | Any casing |
| `ip` | `string` | The real client IP. Ports and IPv4-mapped IPv6 addresses are handled |

`options`:

| Field | Default | |
|---|---|---|
| `ipRanges` | none | From `loadIpRanges()`. Turns on IP verification |
| `headersComplete` | `false` | Set when browser headers reach you untouched over HTTPS. Turns on fake-browser checks |
| `maxRangeAgeDays` | `180` | An operator's range file older than this can verify a request, but never flag it as an impersonator |

Returns:

```ts
{
  category: 'agent' | 'ai-crawler' | 'crawler' | 'bot' | 'human' | 'unknown'
  kind?: string
  id?: string
  name?: string
  operator?: string
  version?: string
  verified: boolean | null
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}
```

- `verified: true` means the IP is in the operator's published ranges.
- `verified: false` means it's provably not who it claims to be.
- `verified: null` means it wasn't checked, or can't be. Coding agents like Claude Code run on the user's own machine, so they're never IP-checked.

### `loadIpRanges(fetch?)`

Downloads the IP range files published by OpenAI, Anthropic, Google, Perplexity, Apple, Microsoft, Common Crawl and DuckDuckGo. Call it once at startup, refresh it about daily, and pass the result to `classify`. Files that fail to load are skipped, so requests from those operators come back unverified rather than flagged.

### `agents`, `httpClients`, `headers`

The dataset, also importable as plain JSON from `@mintlify/agent-traffic/data/*.json` for use from other languages or SQL:

- [`agents.json`](data/agents.json) lists known agents and crawlers. Each entry has user agent patterns, Accept and `Signature-Agent` fingerprints, verification sources, docs, real example user agents, and the date it was last verified.
- [`http-clients.json`](data/http-clients.json) lists generic HTTP libraries and headless browsers.
- [`headers.json`](data/headers.json) says what each request header tells you, and who controls it.

### `patterns`, `userAgents`

`patterns` is one case-insensitive `RegExp` per category: `agent`, `ai-crawler`, `crawler` and `bot`. `userAgents` holds the same patterns as arrays of strings, for building your own matchers. They match user agents only. Use `classify` to get verification, `Accept` and header checks.

### `prefersMarkdown(accept)`

`true` when an `Accept` header ranks `text/markdown` above `text/html`.

## How it works

Checks run in order, and the first one that answers wins:

1. Known agent or crawler, verified by IP when possible
2. Asks for markdown
3. Generic HTTP client or headless browser
4. Browser, unless its headers contradict it
5. Otherwise a bot

[GUIDELINES.md](GUIDELINES.md) covers the full rules, why they work this way, and how to apply them without this package.

## Caveats

- **Some products share an identity.** Codex has been reported to fetch as `ChatGPT-User`, and Cursor through Exa as `ExaUser`. Results name only what can be proven.
- **Some agents are invisible at the HTTP level.** Agentic browsers that run inside a person's own Chrome (Atlas, Comet, Claude in Chrome) look exactly like that person.

## Contributing

Agents change their fetchers often. If you see one that's missing or wrong, open a PR against [`data/agents.json`](data/agents.json) with a real example user agent and a source. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Mintlify](https://mintlify.com)
