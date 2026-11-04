# Changelog

## 0.1.0 · 2026-11-04

First release.

- Answers @mentions and open-question channels in Buzz through a Grok Bot
  routine, in threads, with the whole thread as context.
- Buzz connector (MCP) for Grok Bot: reply, read the question's thread, finish,
  react, list channels; optional channel reading/search and free posting (both off
  by default).
- Webhook delivery with retries and backoff, per-thread ordering, timeouts with
  notices, per-person rate limits, admin commands (`!status`, `!pause`,
  `!resume`), alerts channel.
- Setup page with one-time links for pasting the webhook key and copying the
  connector token.
- `gbb` commands: status, check, setup-link, test-webhook, selftest, channels,
  identity, backup-key.
- Bundles Block's `buzz` and `buzz-acp` built from relay-v0.2.1
  (`6e5c462a`).
- Agent runbook (AGENTS.md) and step-by-step install docs.

Known limits: documents are shared as links (Buzz's 0.2.1 tool uploads only
images and MP4); DMs only from the bot's owner.
