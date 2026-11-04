# 7 · Go live and hand over

## 7.1 Back up the bot's identity

The bot's secret key lives only on the server. If it's lost, the bot loses
its name, history and memberships.

> **Say to the person:** "Please run this yourself on the server (not through
> me), and save the result in your password manager as '<bot name> Buzz key':
> `docker compose exec bridge gbb backup-key --show`"

Also include the `bridge-data` Docker volume in the server's backups. It holds
the key, tokens and question history.

## 7.2 Tell the community

A short post works well, for example:

> "Meet @<bot name>! Mention it in any channel (or post in #ask-<bot>) and it
> will answer in a thread, usually within a minute. It can see the thread
> you're in, so follow-ups work. It's run by the admins; tell us if it says
> something wrong."

## 7.3 What admins can do in Buzz

Mention the bot with:

- `!status`: is it running, how many questions are waiting
- `!pause`: stop answering non-admins (it tells people it's paused)
- `!resume`: start again

## 7.4 Record the deployment

If the person keeps a deployment repository for this server, add a short note
(or a pull request) with: the directory, the version, the public address, the
channels it answers in, the admins, and how to update. **No secrets.**

## 7.5 Hand-over summary

Give the person:

- Server and directory: `…`
- Version: `v0.1.0`
- Public address and connector: `…/mcp`
- Answers in: `…` · Admins: `…` · Alerts go to: `…`
- Commands: `gbb status`, `gbb check`, `gbb setup-link`
- Updating: [operations](../operations.md#updating)
- Anything left to do.
