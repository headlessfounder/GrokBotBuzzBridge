# 4 · Give the bridge a public https address

Goal: `https://<your address>/healthz` answers from the internet, and
`BRIDGE_PUBLIC_URL` in `.env` is that address.

Grok Bot runs in the cloud. To reply, it calls the bridge's connector at
`<BRIDGE_PUBLIC_URL>/mcp`, so the bridge needs an https address. The bridge
listens only on `127.0.0.1:8787`; something in front of it adds https.

Only these paths need to be public: `/healthz`, `/mcp`, `/callback/…`,
`/setup`. Every one except `/healthz` requires a token.

**Stop and ask first.** Every option below changes something shared (a web
server's config, DNS, or a tunnel). Tell the person exactly what you'll change
and wait for a yes (AGENTS.md rule 4).

## Option A: a path on a web server you already run (Caddy)

Best when the server already serves your community over https, for example
the Caddy in front of a Buzz relay. Add a route for a path such as `/grokbot`:

```caddyfile
community.example.com {
    # … existing routes …
    handle /grokbot/* {
        reverse_proxy 127.0.0.1:8787
    }
}
```

Then `BRIDGE_PUBLIC_URL=https://community.example.com/grokbot`. The bridge
strips the `/grokbot` prefix itself, so don't use `handle_path`.

If Caddy runs in a Docker container, `127.0.0.1` is the container itself, not
the server. Either attach the bridge to Caddy's Docker network and use
`reverse_proxy bridge:8787` (add the network to `compose.yml`), or have Caddy
reach the host. Follow the existing deployment's conventions.

Validate before reloading: `caddy validate --config <file> --adapter caddyfile`.

## Option B: nginx

```nginx
location /grokbot/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
    client_max_body_size 4m;
}
```

`BRIDGE_PUBLIC_URL=https://community.example.com/grokbot`. Test with
`nginx -t` before reloading.

## Option C: Cloudflare Tunnel (no open ports, no web server)

If the domain is on Cloudflare: create a tunnel in the Cloudflare dashboard
(Zero Trust › Networks › Tunnels), add a public hostname such as
`grokbot.example.com` pointing to `http://localhost:8787`, and run the
connector on the server with the token the dashboard gives you. Then
`BRIDGE_PUBLIC_URL=https://grokbot.example.com`.

> **Say to the person:** "Cloudflare needs you to create the tunnel in its
> dashboard and give the server a tunnel token. I'll tell you what to click;
> paste the token straight into the server, not into this chat."

## Option D: Tailscale Funnel

If the server is on Tailscale: `tailscale funnel --bg 8787` publishes the
bridge at `https://<machine>.<tailnet>.ts.net`. Then set
`BRIDGE_PUBLIC_URL` to that address. (Grok Bot can also reach MCP servers on
a private tailnet through its Tailscale plugin, but Funnel is simpler.)

## Finish

1. Set `BRIDGE_PUBLIC_URL` in `.env` and apply it: `docker compose up -d`.
2. Check from **another machine** (servers often can't reach their own public
   address):

   ```bash
   curl -s https://community.example.com/grokbot/healthz
   ```

   Expect `{"ok":true,"version":"…"}`.
3. `docker compose exec bridge gbb check` → `✓ Public https address`.
   If only this check fails but step 2 worked, the server can't reach its own
   address; that's fine.

Next: [5 · Connect Grok Bot](05-connect-grok-bot.md)
