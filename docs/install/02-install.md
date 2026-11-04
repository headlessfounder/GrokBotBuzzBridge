# 2 · Install and start the bridge

Goal: the bridge container is running, has created the bot's Buzz identity,
and is connected to the community.

## Steps

1. Create the settings file from the example and fill it in with the
   decisions from step 0:

   ```bash
   cd /opt/grokbot-buzz-bridge/deploy
   cp ../.env.example .env
   chmod 600 .env
   ```

   Set at least `BUZZ_RELAY_URL`, `BRIDGE_PUBLIC_URL` (you'll finish it in
   step 4, but decide the address now), `BRIDGE_BOT_NAME`, and `BRIDGE_ADMINS`.
   Every setting is explained in [configuration](../configuration.md).

   Do **not** put the Grok Bot webhook key in `.env`. It goes into the setup
   page in step 5.

2. Get the image and start it:

   ```bash
   docker compose pull
   docker compose up -d
   ```

   If `pull` fails (no release image for this server's architecture, or it
   isn't published yet), build from source instead: in `compose.yml`, comment
   out `image:` and uncomment `build:`, then run `docker compose up -d --build`.
   Building compiles Block's Buzz tools and needs about 3 GB of memory and
   5–25 minutes.

3. Check it:

   ```bash
   docker compose exec bridge gbb status
   docker compose exec bridge gbb identity
   ```

   `status` should show `runner running`. `identity` shows the bot's **npub**:
   you need it in step 3.

## What happened

On first start the bridge:

- created the bot's Buzz identity and stored it in the `bridge-data` volume
  (`/data/secrets.json`, readable only by the bridge),
- created the connector token and callback secret in the same file,
- set the bot's name and description in Buzz (if the community already lets
  it in),
- joined the open channels it should answer in, and
- started Block's agent runner (`buzz-acp`), which listens for questions.

## If it fails

| Symptom | Fix |
|---|---|
| Container restarts; log says `BUZZ_RELAY_URL must be set` | Fill in `.env` and run `docker compose up -d` again. |
| `BRIDGE_PUBLIC_URL must start with https://` | Use the https address you'll set up in step 4. |
| `runner restarting` in `gbb status` | `docker compose logs --tail 50 bridge` and look at `[buzz-acp]` lines. On an invite-only community this is expected until step 3. |

**Check before moving on:** `gbb status` answers, and you have the bot's npub.

Next: [3 · Let the bot into the community](03-join-community.md)
