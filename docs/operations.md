# Operations

Run commands from the directory with `compose.yml`. `gbb` commands run inside
the container: `docker compose exec bridge gbb <command>`.

## Everyday

| Want to | Run |
|---|---|
| See what it's doing | `gbb status` |
| Check everything, with fixes | `gbb check` |
| Read the log | `docker compose logs --tail 200 -f bridge` |
| Open the setup page | `gbb setup-link` (one use, 30 minutes) |
| Ping Grok Bot | `gbb test-webhook` |
| Ask a test question | `gbb selftest --channel <uuid>` |
| See channels | `gbb channels` |
| Pause / resume | In Buzz: `@<bot> !pause` / `@<bot> !resume` (admins) |

## Updating

```bash
cd <install dir>
git fetch --tags && git checkout v<new version>
cd deploy
docker compose pull        # or: docker compose build, when building from source
docker compose up -d
docker compose exec bridge gbb check
```

Read [CHANGELOG.md](../CHANGELOG.md) first. The `/data` volume carries over.

## Matching the relay version

The image bundles Block's `buzz` and `buzz-acp` built from one commit of
block/buzz (`io.buzz.tools.commit` label on the image). Release images use
**relay-v0.2.1**. If your relay runs another version and something fails,
build with its commit:

```bash
docker build --build-arg BUZZ_COMMIT=<commit of your relay's release> -t grokbot-buzz-bridge:local ..
```

and set `image: grokbot-buzz-bridge:local` in `compose.yml`. The relay's
version is in its NIP-11 document: `curl -H 'Accept: application/nostr+json'
https://<community>`.

## Backups

- **The bot's secret key**: `gbb backup-key --show`, run by a person, stored
  in a password manager. Losing it means a new identity for the bot.
- **The `bridge-data` volume**: key, tokens, question history. Include it in
  server backups, for example:

  ```bash
  docker run --rm -v grokbot-buzz-bridge_bridge-data:/data -v "$PWD":/backup busybox \
    tar czf /backup/bridge-data-$(date +%F).tgz -C /data .
  ```

  The archive contains secrets. Store it like one.

## Restoring

Create the volume, unpack the archive into it, then `docker compose up -d`.
To bring an existing identity without the archive, set `BUZZ_PRIVATE_KEY` in
`.env` to the backed-up `nsec`.

## Rotating secrets

| Secret | How |
|---|---|
| Connector token | Setup page › **Make a new token**, then update the connector in Grok Bot. |
| Grok Bot webhook key | Regenerate it in Grok Bot, then paste it on the setup page. |
| Bot identity | Only if compromised: set a new `BUZZ_PRIVATE_KEY` (or delete `buzzSecretHex` from `secrets.json`), restart, and add the new npub to the community and its private channels. Remove the old one. |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nobody gets answers; `gbb status` shows no new questions | Bot not in the channel, not @mentioned properly, or the channel isn't in `BRIDGE_ANSWER_IN` | `gbb channels`; have members pick the bot from the @ list. |
| `runner restarting` | `buzz-acp` can't sign in (invite-only community, bot not a member) or can't reach the relay | `docker compose logs bridge \| grep buzz-acp`; add the bot's npub as a member. |
| Questions `failed` with HTTP 401/403 | Webhook key wrong or rotated | Setup page › section 1. |
| Questions `failed` with HTTP 404 | Routine deleted or URL wrong | Setup page › section 1. |
| Questions `timed_out` | Grok Bot ran but didn't reply | Grok Bot › routine run history. Usually the connector is missing, its token is wrong, or the instructions were cut off. |
| `✗ Grok Bot reaches the Buzz connector` | Connector not added, or wrong URL/token | Setup page › section 2; `gbb test-webhook`, wait a minute, `gbb check`. |
| `✗ Public https address` but it works from your laptop | The server can't reach its own public address (common) | Nothing to fix. |
| DMs to the bot get no answer | Only the owner can DM the bot (Buzz rule) | Ask in a channel, or set `BRIDGE_OWNER`. |
| Grok Bot can't attach a PDF | Buzz's 0.2.1 tool uploads images and MP4 only | Share documents as links. |
| `rejected: rate limit` | Person hit `BRIDGE_RATE_LIMIT_PER_HOUR` | Raise the limit, or make them an admin. |
