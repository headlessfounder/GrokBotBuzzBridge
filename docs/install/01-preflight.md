# 1 · Preflight

Goal: confirm the right server, see what already runs there, and check it can
reach the community. Nothing is changed in this step.

## Steps

1. Connect to the server and confirm it:

   ```bash
   hostname; curl -s https://ifconfig.me; echo
   ```

   > **Say to the person:** "I'm connected to `<hostname>` at `<ip>`. Is this
   > the server you want the bridge on?"

   Wait for a yes.

2. Get the repository at the release you're installing:

   ```bash
   git clone --depth 1 --branch v0.1.0 https://github.com/HeadlessFounder/GrokBotBuzzBridge.git /opt/grokbot-buzz-bridge
   cd /opt/grokbot-buzz-bridge
   ```

   Pick another directory if the server's own rules say so.

3. Run the read-only preflight:

   ```bash
   scripts/preflight.sh wss://your-community.example
   ```

## Reading the result

| You see | Do this |
|---|---|
| `docker not installed` | Install Docker Engine and the compose plugin, or ask the person to. |
| `a Buzz relay runs on this server` | Find that deployment's directory (look at `docker inspect` labels or `docker compose ls`) and read its `AGENTS.md`, `CLAUDE.md` or `README.md` before going on. Its rules on names, networks and the proxy win. |
| `a reverse proxy or tunnel runs here` | Note which one. Step 4 routes the bridge through it, with the person's approval. |
| `architecture arm64` | Plan to build the image from source in step 2. |
| `did not answer like a Buzz relay` | Check the address with the person. The server may also block outbound traffic. |
| a relay version other than 0.2.1 | Release images bundle Buzz tools from 0.2.1. Newer relays may still work; if anything fails, rebuild with a matching commit ([operations](../operations.md#matching-the-relay-version)). |

**Check before moving on:** the person confirmed the server, Docker works, and
the community answers.

Next: [2 · Install](02-install.md)
