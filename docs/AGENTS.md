# Documentation project instructions

## About this project

- This is the documentation site for the `agent-traffic` package, built on [Mintlify](https://mintlify.com).
- Pages are MDX files with YAML frontmatter. Configuration lives in `docs.json`.
- The package's behavior is defined by `../src/classify.ts`, `../data/*.json` and `../GUIDELINES.md`. Docs must match them; check the code before describing behavior.

## Terminology

- Use the category names exactly as the package returns them: `agent`, `ai-crawler`, `crawler`, `bot`, `human`, `unknown`.
- "Agent" means an AI product fetching a page for a person right now. Don't use it for crawlers.

## Style preferences

- Use active voice and second person ("you").
- Use sentence case for headings.
- Code formatting for file names, commands, paths, header names and code references.
- Example user agents must be real, from traffic or operator documentation.

## Content boundaries

- Don't include customer names, traffic numbers from any company, or internal infrastructure details.
