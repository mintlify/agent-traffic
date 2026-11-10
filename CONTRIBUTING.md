# Contributing

## Adding or fixing an agent

Edit `data/agents.json`. Each entry looks like this:

```json
{
  "id": "gptbot",
  "name": "GPTBot",
  "operator": "OpenAI",
  "category": "ai-crawler",
  "kind": "training",
  "runsOn": "operator",
  "userAgents": ["\\bGPTBot/"],
  "verify": { "ipRanges": ["https://openai.com/gptbot.json"] },
  "docs": "https://platform.openai.com/docs/bots",
  "examples": ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)"],
  "lastVerified": "2026-10-23"
}
```

- **`category` and `kind`:** follow [GUIDELINES.md](GUIDELINES.md). If you're unsure, ask whether a person is waiting on this request right now. If one is, it's an `agent`.
- **`runsOn`:** use `"user"` when the product fetches from the user's own machine, as CLIs and IDE agents do. Those entries are never IP-verified.
- **`userAgents`:** case-insensitive regular expressions anchored on the product token. Bare words like `Cursor` or `Code` are not accepted, because they match unrelated software. Capture `(?<version>…)` when the token carries one.
- **`examples`:** at least one real user agent you saw in traffic or in the operator's documentation. Don't invent one, but do replace anything that identifies a customer, like tenant or scan IDs, with a placeholder. The tests check that every example classifies as its own entry and nothing else.
- **`verify`:** only list sources the operator publishes. That means its IP range JSON, its reverse DNS domains, or its Web Bot Auth key directory.
- **`lastVerified`:** set it to the date you confirmed the entry.
- **Changed user agents:** when a product changes its user agent, keep the old pattern until the old version is no longer seen, and note the change in `notes`.

Run `pnpm install` once, then `pnpm test` before opening a PR.

## Data sources

Only add data you observed yourself or that the operator publishes. Don't copy entries from datasets whose licenses forbid reuse, such as non-commercial or all-rights-reserved bot directories.

## Privacy

Don't commit request captures that contain IP addresses, cookies, authorization headers or the hostnames of other people's sites.
