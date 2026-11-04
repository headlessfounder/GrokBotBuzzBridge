# 6 · Test end to end

Goal: a question asked in Buzz gets Grok Bot's answer in the same thread.

## 6.1 Automatic test

Pick an open channel the bot is in (`gbb channels`), ideally a test channel:

```bash
docker compose exec bridge gbb selftest --channel <channel-uuid>
```

It creates a temporary account, asks the bot a question there, and waits up
to five minutes for the answer. It prints the answer, or what went wrong.

On an invite-only community the temporary account can't post. Skip to 6.2.

## 6.2 A real person asks

> **Say to the person:** "In Buzz, go to `#<channel>` and post:
> `@<bot name> what can you help with?` You should see 👀 on your message
> within a few seconds, and Grok Bot's answer in a thread under it, usually
> within a minute. Then reply in that thread with a follow-up question
> (mention the bot again) to check it remembers the conversation."

While they do it:

```bash
docker compose exec bridge gbb status
```

The question appears under recent questions: `queued` → `dispatched` →
`answered`.

## If the answer doesn't come

| `gbb status` shows | Meaning | Fix |
|---|---|---|
| Nothing new | The bridge didn't see the message | Was the bot @mentioned (picked from the list, not typed)? Is it a member of that channel (`gbb channels`)? Is the channel in `BRIDGE_ANSWER_IN`? |
| `rejected` | Paused, rate limited, or not on the allowlist | The error column says which. |
| `queued` for a long time | Webhook not delivered yet | `gbb check`; look at the webhook test result. |
| `dispatched`, then `timed_out` | Grok Bot got it but didn't reply | Open the routine's run history in Grok Bot. Usually the connector isn't added or the instructions are incomplete. |
| `failed` | Grok Bot refused the webhook | Wrong URL or key: setup page, section 1. |

## Check before moving on

- The person saw a real answer in a thread.
- A follow-up in the thread got an answer that used the earlier messages.
- `gbb check` shows no ✗.

Next: [7 · Go live](07-go-live.md)
