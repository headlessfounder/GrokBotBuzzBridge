# Security

## Reporting a problem

Please report security issues privately through GitHub's **Report a
vulnerability** button on this repository (Security › Advisories), not in a
public issue. Include what you found, how to reproduce it, and the version.

## Threat model

The bridge sits between a public community and an AI agent that may have
access to private data. The main risks, and what the bridge does about them:

### Members steering Grok Bot (prompt injection)

Anyone in the community can write anything, including "ignore your
instructions and…". The bridge can't stop a model from being persuaded, so it
limits what persuasion can achieve:

- **Use a separate Grok Bot** for the community, with no server, GitHub, or
  write access to important systems. This is the most important control and
  it's yours to make. AI agents installing the bridge are told to refuse
  otherwise.
- Every payload marks the question as untrusted, and the routine instructions
  repeat it.
- `asker.isAdmin` is set by the bridge from `BRIDGE_ADMINS`, not from message
  text, so Grok Bot can rely on it.
- The connector can only post replies to questions it was given (not to any
  channel) unless an operator turns on `BRIDGE_ALLOW_FREE_POSTING`.
- The connector can only read the thread a question came from, not other
  channels, unless an operator turns on `BRIDGE_ALLOW_READING`. Otherwise a
  member could ask Grok Bot to quote a private channel the bot is in (an
  admin alerts channel, for example).
- Replies per question are capped; the bot ignores its own messages.
- Direct messages can only come from the bot's owner (a Buzz rule enforced by
  Block's `buzz-acp`), so nobody can steer the bot out of sight of others.

### Secrets

| Secret | Where it lives | Who sees it |
|---|---|---|
| Bot's Buzz secret key | `/data/secrets.json` (0600, container user) | Only the bridge. `gbb backup-key --show` prints it for backup. |
| Connector token | same file | The bridge, and the Grok Bot connector settings. Shown on the setup page. |
| Grok Bot webhook key | same file | The bridge. Pasted on the setup page. Not passed to `buzz-acp`. |
| Callback tokens | derived per task (HMAC) | Sent only to Grok Bot in that task's webhook. |

- The setup page opens from a one-time link (30 minutes) and then uses an
  HttpOnly, SameSite=Strict cookie for an hour. Forms carry a CSRF token. This
  keeps secrets out of AI agents' chats.
- Logs redact `nsec` keys, bearer tokens and `gbb_` tokens.
- The internal API listens on the container's loopback only and needs a token
  that changes on every start.

### Server-side request forgery

`buzz_reply` attachments are fetched by the bridge. Only `https://` URLs to
public addresses are fetched (private, loopback, link-local and multicast
ranges refused, re-checked on each redirect, at most 3 redirects), with a size
cap. A DNS answer that changes between the check and the fetch is not
defended against.

### What the bridge does not protect

- What Grok Bot says. Review its connectors and instructions.
- The Grok Bot account itself. Use strong sign-in and team sharing rather
  than shared passwords.
- The server. Anyone with Docker access on it can read `/data`.
