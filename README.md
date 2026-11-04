# GrokBotBuzzBridge

Put a **Grok Bot** inside your **Buzz** community. Members @mention it in a
channel and get answers in a thread. Follow-ups keep the whole conversation,
and your Grok Bot brings its own memory, knowledge and connectors (databases,
documents, the web).

```
Buzz member: "@Grok Bot when is the next meetup?"
        │
        ▼
 ┌───────────────────────────────┐   webhook (question + whole thread)   ┌──────────────────────┐
 │ GrokBotBuzzBridge             │ ────────────────────────────────────▶ │ Grok Bot routine     │
 │ on your server, holds the     │                                       │ (cloud)              │
 │ bot's Buzz identity           │ ◀──────────────────────────────────── │ uses your connectors │
 └───────────────────────────────┘   "Buzz" connector: buzz_reply(…)     └──────────────────────┘
        │
        ▼
 Answer posted in the same Buzz thread
```

> Not affiliated with xAI, Block, or the Buzz project. "Grok" and "Grok Bot"
> belong to their owners; this project only connects to them.

## Install with your AI agent

Give your agent (Grok Bot, Claude Code, Codex, Cursor, …) this repository's
link and ask it to install the bridge for your community. The agent follows
[AGENTS.md](AGENTS.md): it checks your server, installs the bridge, and walks
you through the few steps that happen in the Buzz and Grok Bot apps, checking
each one as you go.

The agent needs a shell on the server that will run the bridge. You need to
be an admin of the community and have the Grok Bot app.

Two safety rules the agent enforces, and you should too:

- **Use a separate Grok Bot for the community.** The bot that answers in Buzz
  must not have access to your server or GitHub. Anyone in the community can
  talk to it.
- **Secrets never go through the agent's chat.** You paste the Grok Bot
  webhook key into the bridge's own setup page.

## Install by hand

Follow the same steps yourself: [docs/install](docs/install/00-before-you-start.md).
In short:

```bash
git clone --depth 1 --branch v0.1.0 https://github.com/HeadlessFounder/GrokBotBuzzBridge.git
cd GrokBotBuzzBridge/deploy
cp ../.env.example .env        # set BUZZ_RELAY_URL, BRIDGE_PUBLIC_URL, BRIDGE_ADMINS
docker compose up -d
docker compose exec bridge gbb identity     # the bot's npub: add it to your community if it's invite-only
docker compose exec bridge gbb setup-link   # open it, then follow the page
```

## What it can do

| | |
|---|---|
| Answer @mentions in channels, in a thread | ✓ |
| Answer every message in a dedicated `#ask` channel | ✓ |
| Follow-ups with the whole thread as context | ✓ |
| Text with Markdown and links | ✓ |
| Attach images and MP4 video | ✓ |
| Attach documents (PDF, Word, slides) | Shared as links for now¹ |
| Direct messages | Owner only² |
| Admin commands in Buzz: `!status`, `!pause`, `!resume` | ✓ |
| Read other channels or search Buzz | Off by default (`BRIDGE_ALLOW_READING`) |
| Rate limit per person, timeouts, retries, alerts | ✓ |

¹ Block's Buzz command-line tool (as of relay 0.2.1) uploads only images and
video. Native document attachments are planned.
² A Buzz safety rule: in DMs, only the bot's owner can prompt it.

## How it's built

The bridge doesn't reimplement Buzz. It runs Block's own **agent runner**
(`buzz-acp`) and **command-line tool** (`buzz`), built from the same commit as
your relay, and adds a small Node.js service for the Grok Bot side: a task
queue, webhook delivery with retries, the Buzz connector (MCP) and a setup
page. Details in [docs/how-it-works.md](docs/how-it-works.md).

## Documentation

- [Install steps](docs/install/00-before-you-start.md): for people and agents
- [AGENTS.md](AGENTS.md): the runbook AI agents follow
- [Grok Bot routine instructions](grokbot/ROUTINE.md): pasted into Grok Bot
- [How it works](docs/how-it-works.md)
- [Configuration](docs/configuration.md): every setting
- [Operations](docs/operations.md): status, updates, backups, troubleshooting
- [Webhook and connector reference](docs/reference.md): for other agents or webhooks
- [Security](SECURITY.md)

## Status

Version 0.1.0. Tested end to end against a real Buzz relay 0.2.1 with a mock
Grok Bot (`test/e2e/run.sh`). Grok Bot's webhook routines and connector form
are configured by hand and were not automated or tested here; please report
what you find.

## License

[Apache-2.0](LICENSE). Bundles binaries built from [block/buzz](https://github.com/block/buzz)
(Apache-2.0); see [NOTICE](NOTICE).
