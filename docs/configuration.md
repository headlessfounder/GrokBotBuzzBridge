# Configuration

All settings are environment variables, normally in `deploy/.env` (start from
[.env.example](../.env.example)). Apply changes with `docker compose up -d`.

## Required

| Variable | Example | Meaning |
|---|---|---|
| `BUZZ_RELAY_URL` | `wss://community.example.com` | The community address, as members type it. |
| `BRIDGE_PUBLIC_URL` | `https://community.example.com/grokbot` | Public https address of the bridge. A path is fine; the bridge strips it. Needed for the connector. |

## The bot

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_BOT_NAME` | `Grok Bot` | Display name in Buzz. Also used to strip "@Name" from questions. |
| `BRIDGE_BOT_ABOUT` | short text | Profile description. |
| `BRIDGE_BOT_AVATAR_URL` | none | https link to a square image. |
| `BRIDGE_COMMUNITY_NAME` | relay host name | Community name shown to Grok Bot. |
| `BUZZ_PRIVATE_KEY` | generated | Bring an existing identity (nsec or hex). Otherwise one is created and stored in `/data/secrets.json`. |

## People

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_ADMINS` | none | npubs or hex keys, comma separated. Admin commands, no rate limit, `isAdmin=true` in the payload. |
| `BRIDGE_OWNER` | first admin | The bot's owner in Buzz. Only the owner can DM the bot. |
| `BRIDGE_RESPOND_TO` | `anyone` | `anyone` or `allowlist`. |
| `BRIDGE_ALLOWLIST` | none | Keys allowed to ask when `BRIDGE_RESPOND_TO=allowlist` (admins always allowed). |

## Where it answers

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_ANSWER_IN` | `all` | `all`, or channel UUIDs where @mentions are answered. |
| `BRIDGE_OPEN_CHANNELS` | none | Channel UUIDs where every message is a question. |
| `BRIDGE_AUTO_JOIN` | `true` | Join open channels it should answer in (every open channel when `BRIDGE_ANSWER_IN=all`). Checked every 5 minutes. |
| `BRIDGE_ALERT_CHANNEL` | none | Channel UUID for problem alerts. Use a private admin channel and add the bot to it. |

## Limits

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_RATE_LIMIT_PER_HOUR` | `6` | Questions per person per hour; `0` = unlimited. |
| `BRIDGE_TASK_TIMEOUT_MINUTES` | `10` | Wait before a "taking longer" notice. |
| `BRIDGE_MAX_REPLIES_PER_TASK` | `5` | Messages Grok Bot may post per question. |
| `BRIDGE_MAX_ATTACHMENT_MB` | `25` | Largest attachment (images, MP4). |
| `BRIDGE_ACK_REACTION` | `👀` | Reaction while a question is being worked on; empty to turn off. |
| `BRIDGE_ALLOW_FREE_POSTING` | `false` | Adds the `buzz_post_message` connector tool (post anywhere the bot is). Off by default for safety. |
| `BRIDGE_ALLOW_READING` | `false` | Adds `buzz_read_channel` and `buzz_search` (read any channel the bot is in). Off by default: members could ask Grok Bot to quote private channels. The question's own thread is always readable. |

## Advanced

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_PORT` | `8787` | Public listener inside the container. |
| `BRIDGE_HOST_PORT` | `8787` | Host port in `deploy/compose.yml` (bound to 127.0.0.1). |
| `BRIDGE_INTERNAL_PORT` | `8788` | Loopback listener inside the container. |
| `BRIDGE_DATA_DIR` | `/data` | State directory. |
| `BRIDGE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `BRIDGE_CONNECTOR_TOKEN` | generated | Fix the connector token (tests). Normally leave unset and use the setup page. |
| `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_KEY` | none | Set the webhook through the environment instead of the setup page (automation, tests). The setup page then can't change it. |
| `BRIDGE_ALLOW_HTTP_PUBLIC_URL` | `false` | Allow an `http://` public URL (local tests only). |
| `BUZZ_ACP_*` | bridge defaults | Passed to Block's `buzz-acp`; anything set here overrides the bridge's defaults. |

The bridge's defaults for `buzz-acp`: subscribe by rules file, respond to
`anyone`/`allowlist` per `BRIDGE_RESPOND_TO`, no base prompt, no agent
memory, queue events that arrive mid-turn, one agent process, 120-second idle
timeout.

## Build arguments

| Argument | Default | Meaning |
|---|---|---|
| `BUZZ_COMMIT` | `6e5c462a…` (relay-v0.2.1) | Commit of [block/buzz](https://github.com/block/buzz) the Buzz tools are built from. Match your relay. |
| `BUZZ_REPO` | `https://github.com/block/buzz` | Source repository for the tools. |
| `NODE_IMAGE` | `node:24-bookworm-slim` | Runtime base image. |
