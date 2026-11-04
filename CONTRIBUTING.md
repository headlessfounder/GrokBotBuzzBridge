# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Setup

Node.js 24+ and Docker.

```bash
npm install
npm run check          # type-check + unit tests
test/e2e/run.sh        # full test against a real Buzz relay (needs Docker, ~5 min the first time)
test/e2e/run.sh --down # same, then remove the test stack
```

The code is TypeScript run directly by Node 24 (type stripping): no build
step. Keep to erasable syntax: no `enum`, `namespace`, or parameter
properties, and import local files with their `.ts` extension.

## Layout

| Path | What |
|---|---|
| `src/main.ts` | `gbb` command line |
| `src/bridge.ts` | Tasks, webhook delivery, replies |
| `src/prompt.ts` | Reads the prompt `buzz-acp` builds |
| `src/acp.ts` | The ACP "agent" that `buzz-acp` starts |
| `src/supervisor.ts` | Runs and restarts `buzz-acp` |
| `src/mcp.ts` | The Buzz connector tools |
| `src/server.ts`, `src/setup-page.ts` | HTTP listeners and the setup page |
| `src/buzz.ts` | Wrapper around Block's `buzz` tool |
| `grokbot/ROUTINE.md` | Instructions people paste into Grok Bot |
| `docs/install/`, `AGENTS.md` | Install steps for people and agents |
| `test/e2e/` | Relay + bridge + mock Grok Bot test stack |

## Principles

- **Don't reimplement Buzz.** Use Block's `buzz` and `buzz-acp`. If they can't
  do something, prefer contributing it upstream.
- **Plain language** in messages people see, docs, and `fix:` hints.
- **No secrets in chats, logs or the repo.** Anything a person must paste goes
  through the setup page.
- **Update the docs** (and AGENTS.md if install steps change) in the same pull
  request.
- If you change the prompt parser, add the real prompt you saw to
  `test/unit/prompt.test.ts`.

By contributing you agree your work is licensed under Apache-2.0.
