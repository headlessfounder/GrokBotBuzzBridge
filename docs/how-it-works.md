# How it works

## The pieces

One container runs three things:

| Piece | From | Job |
|---|---|---|
| `buzz-acp` | Block, built from the relay's commit | Keeps a live connection to the relay as the bot, finds the bot's channels, filters @mentions and open-question channels, fetches the thread so far, and formats each question as a prompt. Reconnects and replays missed mentions after outages. |
| `buzz` | Block, same commit | Every write and read the bridge does in Buzz: posting answers, threads, reactions, profile, channel joins. |
| `gbb` | This repository (Node.js 24) | Starts and supervises `buzz-acp`, turns prompts into tasks, delivers them to Grok Bot, serves the Buzz connector (MCP) and the setup page. |

Using Block's own tools means the bridge never implements the Buzz protocol.
When Buzz changes, rebuilding with the matching commit keeps it correct.

## A question's journey

1. A member posts `@Grok Bot …` in a channel the bot is in.
2. `buzz-acp` sees it (mention filter, author gate), fetches the thread so
   far, and starts a turn by sending the prompt to `gbb acp` over ACP (the
   Agent Client Protocol, JSON-RPC on stdio).
3. `gbb acp` hands the prompt to the bridge service and ends the turn at once,
   so the channel is never blocked while Grok Bot works.
4. The bridge parses the prompt (channel, thread root, the message, who
   asked), checks pause state, rate limits and the allowlist, and stores a
   **task** in SQLite. It reacts 👀 to the question.
5. The dispatcher sends the task to the Grok Bot routine's webhook:
   `POST <webhook URL>` with `Authorization: Bearer <webhook key>` and a JSON
   body (see [reference](reference.md)). Failures are retried with backoff
   (up to 8 tries, honoring `Retry-After`); a refused key fails at once.
6. Grok Bot's routine runs, reads the payload, uses its own connectors to
   find the answer, and calls `buzz_reply` on the Buzz connector.
7. The connector (MCP over streamable HTTP, token-protected) posts the answer
   with Block's `buzz` tool as a reply in the question's thread, removes 👀,
   and marks the task answered.

Follow-ups in the same thread become new tasks with the same **thread key**.
Tasks in one thread are delivered one at a time, in order, so Grok Bot never
answers two messages of the same conversation at once. Different threads run
in parallel.

## What makes it robust

| Risk | Handling |
|---|---|
| Relay connection drops | `buzz-acp` reconnects and replays mentions it missed. |
| Bridge restarts mid-question | Tasks are in SQLite; queued ones are delivered after restart. Each Buzz message is recorded, so replays never create a second task. |
| Grok Bot is down or rate limited | Webhook retries with exponential backoff up to 5 minutes apart; `Retry-After` honored. |
| Grok Bot gets the question but never answers | After `BRIDGE_TASK_TIMEOUT_MINUTES` the thread gets a polite notice and admins get an alert. A late answer is still posted (within 24 hours). |
| Grok Bot retries a reply | `buzz_reply` takes an idempotency key (default: a hash of the text), so the same answer is never posted twice. |
| A runaway loop | At most `BRIDGE_MAX_REPLIES_PER_TASK` messages per question. The bot ignores its own messages. |
| One person floods the bot | Per-person hourly limit, admins exempt. They're told once per hour. |
| `buzz-acp` crashes | The supervisor restarts it with backoff; `gbb status` shows restarts. |
| Something needs a human | Alerts go to `BRIDGE_ALERT_CHANNEL` (rate limited) and the log. Admins can `!pause` from Buzz. |

## State

Everything lives in the `/data` volume:

| File | Contents |
|---|---|
| `secrets.json` (0600) | Bot secret key, connector token, callback secret, Grok Bot webhook URL and key |
| `bridge.db` | Tasks, seen messages, replies, settings, setup tokens, audit log |
| `buzz-acp.toml` | Subscription rules for `buzz-acp`, rewritten from settings on each start |
| `internal-token` | Per-start token for the loopback API between `gbb` processes |

## Network

| Listener | Address | Paths |
|---|---|---|
| Public | `0.0.0.0:8787` in the container (`127.0.0.1:8787` on the host by default) | `/healthz` (open), `/mcp` (connector token), `/callback/<task>` (per-task token), `/setup` (one-time link, then a cookie) |
| Internal | `127.0.0.1:8788`, inside the container only | `/internal/*` for `gbb acp` and the CLI (per-start token) |

Outbound: the relay (WebSocket and HTTPS), the Grok Bot webhook URL, and
public https URLs Grok Bot asks it to attach (private addresses refused).

## Why a webhook and a connector

Grok Bot has two ways to work with outside systems: routines that a webhook
can start, and connectors (MCP servers) it can call. The bridge uses both: the
webhook brings each question in, and the connector lets Grok Bot read the
thread and answer. The same connector also works when an admin chats with the
bot in the Grok Bot app ("post a summary in #announcements" needs
`BRIDGE_ALLOW_FREE_POSTING=true`).

A plain HTTP callback (`/callback/<task>`) is offered as a fallback for
routines that can make HTTP requests but can't use the connector, and for
other webhook-driven agents.
