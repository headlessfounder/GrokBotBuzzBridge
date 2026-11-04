# 0 · Before you start

About 30–60 minutes in total, most of it in the Grok Bot and Buzz apps.

## What you need

- **A Buzz community** you can manage: you are its owner, or an admin who can
  add members and add people to private channels.
- **A Grok Bot account** for the bot that will answer in Buzz. For a team,
  create it under a team account and share the bot with the other admins
  (Grok Bot's team sharing), so nobody shares a password.
- **A server that is always on**, with Docker. The bridge needs about 150 MB
  of memory. The server that already runs your Buzz relay is a good choice.
- **A public https address** for the bridge, because Grok Bot runs in the
  cloud and has to reach it. Options are in [step 4](04-public-address.md).

## Decisions to make first

Write these down; the install asks for them.

1. **Which community?** Its address, for example `wss://community.example.com`.
2. **Which Grok Bot answers?** It must be a bot that does **not** have access
   to your server or GitHub. Members of the community will be talking to it,
   and some will try to make it do things. Give it only what it needs to
   answer: knowledge, documents, read-only databases.
3. **Who are the admins?** Their Buzz public keys (npub). Admins can pause the
   bot, are never rate limited, and Grok Bot is told when an admin is asking.
4. **Where should it answer?**
   - In every channel it's in, when someone @mentions it (the default), and/or
   - in a dedicated channel such as `#ask-grok`, where every message is a
     question.
   - Direct messages work only for the bot's owner. That is a Buzz safety
     rule: it stops strangers from privately steering a shared bot.
5. **Where do problems get reported?** Optionally a private admin channel the
   bot posts alerts to.
6. **What's the bot called?** Name, one-line description, avatar link.

> **Say to the person:** "Before we start, I need six decisions: the community
> address, which Grok Bot will answer (it must not have access to your server
> or GitHub), the admins' npubs, where it should answer, an optional alerts
> channel, and the bot's name. I'll also need you in the Buzz app and the Grok
> Bot app for a few steps."

## What it can and can't do

- **Text and links:** yes, with Markdown, in threads.
- **Images and MP4 video:** yes, attached by link.
- **Documents (PDF, Word, slides):** shared as links. Block's Buzz tool (as of
  relay 0.2.1) can only upload images and video, so the bridge can't attach
  documents yet.
- **Follow-up questions:** yes. Every question carries the whole thread, so
  Grok Bot sees the conversation so far.
- **Speed:** each question starts a Grok Bot routine run, so answers take as
  long as a run takes (often 10–60 seconds). The 👀 reaction shows a question
  was picked up.

Next: [1 · Preflight](01-preflight.md)
