# 3 · Let the bot into the community

Goal: the bot can sign in to Buzz and is a member of every channel it should
answer in.

## Is the community open or invite-only?

- **Open** (anyone with the address can join): nothing to do for membership.
  The bridge joins the open channels it should answer in by itself.
- **Invite-only:** an admin must add the bot as a member, the same way they
  add a person.

> **Say to the person (invite-only):** "Please add the bot to the community
> in the Buzz app, the same way you'd add a new member. Its public key is
> `<npub from gbb identity>`. Tell me when it's done."

## Private channels

The bot can't join private channels itself. For each private channel it
should answer in:

> **Say to the person:** "In the Buzz app, open `#<channel>`, open its member
> list, and add `<bot name>` (npub `<npub>`). Tell me when it's done."

## A dedicated questions channel (optional)

If you chose an `#ask-<bot>` channel where every message is a question, create
it in the Buzz app (open or private), then put its channel UUID in
`BRIDGE_OPEN_CHANNELS` in `.env` and restart:

```bash
docker compose up -d
```

To find a channel's UUID, run `docker compose exec bridge gbb channels`. It lists
every channel the bot can see, its UUID, and whether the bot is a member.

## Check

```bash
docker compose exec bridge gbb check
```

Look for:

- `✓ Bot signs in to Buzz`
- `✓ Bot is in channels: member of N: …` listing the channels you expect
- `✓ Listening for questions (buzz-acp): running`

If the bot isn't in a channel you expected, it's either private (an admin adds
it) or not in `BRIDGE_ANSWER_IN`.

Next: [4 · Public address](04-public-address.md)
