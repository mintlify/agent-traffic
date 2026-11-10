# Classifying agent traffic

This document defines the categories `agent-traffic` uses, the order in which it checks a request, and the mistakes it's designed to avoid. You can apply these rules without the package; it's one implementation of them.

## Categories

Every request gets exactly one category.

| Category | Definition | Examples |
|---|---|---|
| `agent` | An AI product fetching a page **now, on behalf of a person** who asked it something or gave it a task | Claude Code, ChatGPT-User, Perplexity-User, GitHub Copilot, Google-Agent |
| `ai-crawler` | An AI company collecting pages **ahead of time**, for training, an AI search index or a knowledge base | GPTBot, ClaudeBot, OAI-SearchBot, PerplexityBot, ExaSearchBot |
| `crawler` | A search engine crawler | Googlebot, Bingbot, Applebot, YandexBot |
| `bot` | Any other automation | AhrefsBot, Slackbot, uptime monitors, curl, python-requests |
| `human` | A person using a browser | |
| `unknown` | Nothing to classify: no user agent and no headers | |

To tell `agent` from `ai-crawler`, ask whether a person is waiting on this request. If someone is, it's an `agent`. If it would have happened anyway on a schedule, it's an `ai-crawler`. Search engines whose index also feeds AI answers, like Googlebot and Bingbot, stay `crawler`: their main job is search, and their published documentation describes them that way.

Each result also has a `kind` with more detail:

| Category | Kinds |
|---|---|
| `agent` | `assistant` (chat products), `coding` (IDE and CLI agents), `browser` (agents that drive a browser), `unidentified` (agent behavior but no known product) |
| `ai-crawler` | `training`, `ai-search`, `ingest` (knowledge bases and retrieval pipelines) |
| `crawler` | `search` |
| `bot` | `seo`, `preview`, `ads`, `monitor`, `scanner`, `archiver`, `feed`, `http-client`, `headless`, `fake-browser`, `impersonator`, `unidentified` |

When reporting traffic, keep `agent` and `ai-crawler` separate. Crawler volume is scheduled and often much larger, so combining the two hides how much on-demand agent use there really is.

## Decision order

Run these checks in order. The first one that produces an answer wins.

1. **Known agent or crawler.** Match the request against [`data/agents.json`](data/agents.json), in this order:
   - the `User-Agent` header;
   - the exact `Accept` header, for tools that send a distinctive one (compared case-insensitively, ignoring whitespace);
   - the `Signature-Agent` header, but only on requests that also carry `Signature` and `Signature-Input`.

   If the match runs on its operator's servers, verify the client IP (see [Verification](#verification)).
2. **Asks for markdown.** If `Accept` ranks `text/markdown` or `text/x-markdown` above `text/html`, the request is an `agent`. Browsers never do this; AI tools that read pages do.
3. **Generic HTTP client or headless browser.** Match the `User-Agent` against [`data/http-clients.json`](data/http-clients.json). A match is a `bot`.
4. **Browser.** A user agent counts as a browser when it starts with `Mozilla/`, carries a rendering-engine token (`KHTML, like Gecko`, `Gecko/`, `Trident/` and similar), and shows no sign of automation, such as:
   - a `bot`, `crawl` or `spider` token;
   - a URL or email address;
   - a monitoring or testing tool's name, like Selenium, Lighthouse or a synthetic monitor.

   Browsers are `human` unless their headers contradict it (see [Browser checks](#browser-checks)). In-app browsers like the Twitter, LinkedIn and Google apps and iOS web views count as browsers.
5. **Otherwise** it's a `bot` (`unidentified`). Anything that isn't a browser and matches no known entry is automation, including empty user agents, truncated browser strings, native-app HTTP stacks and one-off scripts. `unknown` is reserved for requests with no user agent and no headers at all.

## Verification

User agents and headers are set by the client, so anyone can claim to be GPTBot. Operators that fetch from their own servers publish the IP ranges they use, which turns a claim into something checkable.

- **The IP is inside the operator's published ranges.** The identity is verified, with `high` confidence.
- **The IP is outside the ranges, and the range file is current.** The request is an `impersonator` (a `bot`), not the product it names.
- **Anything else leaves the claim accepted but unverified:**
  - no IP was provided;
  - the IP isn't a single valid address;
  - the operator publishes no ranges;
  - the range file is empty or older than 180 days.

  An unusable input should never turn a real crawler into a suspected fake.

Two rules matter most here:

- **Skip IP checks for products that run on the user's own machine.** Coding agents like Claude Code, OpenCode and GitHub Copilot fetch from the developer's computer, so their IPs will never be in the vendor's ranges. These entries are marked `"runsOn": "user"` in the data and are never IP-checked.
- **Use the real client IP.** Behind a CDN or proxy, read the IP from the header your own proxy sets, such as `CF-Connecting-IP` on Cloudflare. The leftmost `X-Forwarded-For` value is set by the client, so it proves nothing. Ports and IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) are normalized before checking.

## Browser checks

Real browsers send a predictable set of headers, and many automated clients that borrow a browser user agent don't. A browser-style user agent is classified as a `fake-browser` bot when:

- `Accept` ranks `text/plain` above `text/html`, or asks for metalink downloads. This is checked whenever `Accept` is present.
- These three are checked only when you've confirmed the headers arrived intact (`headersComplete: true`):
  - a recent Chrome, Firefox or Safari sends no `sec-fetch-*` headers;
  - a Firefox or Safari user agent sends `sec-ch-ua`, which only Chromium-based browsers send;
  - there's no `Accept-Language`.

Only enable the intact-headers checks for HTTPS traffic that reaches you unmodified. Browsers don't send `sec-fetch-*` over plain HTTP, and some proxies strip it.

## Confidence

| Confidence | When |
|---|---|
| `high` | An IP verified the identity, an IP proved an impersonator, or a non-Chromium browser sent `sec-ch-ua` |
| `medium` | A known user agent or `Accept` fingerprint, a markdown-first `Accept`, a generic HTTP client, a browser missing `sec-fetch-*`, or a browser with consistent headers |
| `low` | An unverified `Signature-Agent`, a browser missing `Accept-Language` or ranking `text/plain` first, a browser whose headers weren't checked, or a fallback guess |

## Common mistakes

- **Matching loose substrings.** `Cursor`, `Copilot` or `Code/` appear inside ordinary browser, editor and Electron user agents. Every pattern in the data is anchored on the product token, and every entry has real examples that the tests check against all other entries.
- **Treating every markdown fetch as an agent.** Scripts, documentation mirrors and integrations fetch `.md` and `llms.txt` files too. A request only counts as an agent if it identifies itself or asks for markdown in `Accept`.
- **Trusting JavaScript analytics.** Crawlers that render pages, like Googlebot, Bingbot and headless browsers, run your analytics script and appear as visitors. Classify on the server whenever you can.
- **Counting native apps as people.** An app's own HTTP stack (`CFNetwork`, `Dalvik`, `okhttp`) fetches pages programmatically, even when a person is using the app. These count as `bot` / `http-client`. Pages opened in an app's built-in browser use a browser user agent and count as `human`.
- **Using robots.txt tokens as user agents.** `Google-Extended` and `Applebot-Extended` control usage in robots.txt but never appear in requests.
- **Over-attributing shared identities.** Some products fetch through another company's infrastructure or user agent. A signature from a hosted-browser platform proves the platform, not the agent running on it. Codex has been reported to fetch as `ChatGPT-User`, and Cursor through Exa as `ExaUser`. Name only the identity you can prove. The `notes` field in the data records known cases.

## Classifying from logs

When classifying after the fact, the user agent alone covers known agents, crawlers and HTTP clients. To get the same results as request-time classification, log these fields as well:

- the exact `Accept` value;
- the real client IP, or the verification result;
- whether `sec-fetch-mode`, `sec-ch-ua`, `accept-language`, `signature` and `signature-agent` were present.

Without them, agents that use a browser user agent can't be told apart from people.

## Known limitations

- **Agents inside a person's browser are invisible at the HTTP level.** Agentic browsers and extensions that run in a person's own browser send that browser's requests.
