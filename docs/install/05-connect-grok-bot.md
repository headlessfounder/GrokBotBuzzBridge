# 5 · Connect Grok Bot

Goal: Grok Bot receives questions (webhook) and can answer them (connector).

The person does this in the **Grok Bot app**, in the bot that will live in the
community. You guide them one step at a time and check each step from the
server. Secrets go into the setup page, never into this chat.

## 5.1 Confirm which bot

> **Say to the person:** "Open the Grok Bot app and pick the bot that will
> answer in Buzz. It must not be connected to your server or GitHub, because
> community members will be talking to it. Which bot is it?"

If they name the bot that's doing this install, or one with server or GitHub
connectors, stop (AGENTS.md rule 2). Suggest creating a new bot, ideally under
a team account shared with the other admins.

## 5.2 Open the setup page

```bash
docker compose exec bridge gbb setup-link
```

It prints a link that works once, for 30 minutes.

> **Say to the person:** "Open this link in your browser: `<link>`. It's the
> bridge's setup page. Keep it open; we'll use it for the next steps."

## 5.3 Create the routine

> **Say to the person:** "In Grok Bot, in that bot, create a new routine:
> 1. Trigger: **When a webhook fires**.
> 2. Instructions: paste everything below the line in
>    `https://github.com/HeadlessFounder/GrokBotBuzzBridge/blob/v0.1.0/grokbot/ROUTINE.md`,
>    and fill in the 'About this community' part at the end.
> 3. Save it. Grok Bot shows a **Webhook URL** and a **Webhook key**."

## 5.4 Paste the webhook into the setup page

> **Say to the person:** "On the setup page, in section 1, paste the Webhook
> URL and the Webhook key, then click **Save webhook**. The page sends Grok
> Bot a test right away and tells you if it worked."

Check:

```bash
docker compose exec bridge gbb check
```

Expect `✓ Grok Bot webhook saved` and `✓ Grok Bot accepts the webhook`.

| You see | Meaning | Fix |
|---|---|---|
| `HTTP 401` or `HTTP 403` | Wrong key | Copy the key again from the routine. |
| `HTTP 404` | Wrong URL, or the routine was deleted | Copy the URL again. |
| network error | The server can't reach Grok Bot | Check outbound internet from the server. |

## 5.5 Add the Buzz connector

> **Say to the person:** "Now, in the same bot in Grok Bot, add a connector
> (MCP server). On the setup page, section 2 shows the **Connector URL** and a
> **Header** (`Authorization: Bearer …`). Use those. If the Grok Bot form has
> no place for a header, use the longer URL under it, which has the token
> built in. Save it, and tell me when it's done."

## 5.6 Prove the connector works

```bash
docker compose exec bridge gbb test-webhook
```

The routine's instructions tell Grok Bot to call the connector once when it
gets this ping. Wait a minute for the routine to run, then:

```bash
docker compose exec bridge gbb check
```

Expect `✓ Grok Bot reaches the Buzz connector: last used …`.

If it still says "has not called the connector yet":

- Ask the person to open the routine's run history in Grok Bot and read what
  happened.
- "Unauthorized" or "401" there: the connector token is wrong. Copy it again
  from the setup page.
- The routine didn't use the connector at all: check the instructions were
  pasted completely, and that the connector is enabled for the bot.

## 5.7 Optional: databases and documents

Anything else Grok Bot should know comes from its own connectors and
knowledge: add them to the same bot in Grok Bot. Use **read-only** database
users and only the tables the community may see. Remember the bot talks to
everyone in the community.

**Check before moving on:** webhook saved and accepted, connector used.

Next: [6 · Test](06-test.md)
