#!/usr/bin/env bash
# Read-only checks before installing GrokBotBuzzBridge on a server.
# Changes nothing. Prints what it finds and what to do about it.
#
#   scripts/preflight.sh wss://community.example.com
set -uo pipefail

RELAY="${1:-${BUZZ_RELAY_URL:-}}"
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "== This machine"
echo "  host: $(hostname)"
if have curl; then echo "  public IP: $(curl -s --max-time 5 https://ifconfig.me || echo unknown)"; fi
echo "  system: $(uname -sm)"
if [ -r /proc/meminfo ]; then
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  echo "  memory: ${mem_mb} MB total, ${avail_mb} MB available"
  [ "$avail_mb" -lt 300 ] && warn "less than 300 MB free; the bridge needs about 150 MB"
fi
df -h / 2>/dev/null | awk 'NR==2 {print "  disk /: " $4 " free"}'

echo "== Docker"
if have docker; then
  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '(daemon not reachable)')"
  if docker compose version >/dev/null 2>&1; then ok "$(docker compose version | head -1)"; else bad "docker compose plugin missing"; fi
  case "$(docker info --format '{{.Architecture}}' 2>/dev/null)" in
    x86_64 | amd64) ok "architecture amd64 (release images are built for amd64)" ;;
    aarch64 | arm64) warn "architecture arm64: build the image from source (see docs/install/02-install.md)" ;;
  esac
else
  bad "docker not installed (https://docs.docker.com/engine/install/)"
fi

echo "== Things already running here"
if have docker; then
  others=$(docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null)
  if [ -n "$others" ]; then
    echo "$others" | sed 's/^/  /'
    if echo "$others" | grep -qiE 'buzz|relay'; then
      warn "a Buzz relay runs on this server. Find its deployment directory and read its AGENTS.md / CLAUDE.md / README first (AGENTS.md rule 5)."
    fi
    if echo "$others" | grep -qiE 'caddy|nginx|traefik|cloudflared'; then
      warn "a reverse proxy or tunnel runs here. Route the bridge through it; ask before reloading it (AGENTS.md rule 4)."
    fi
  else
    echo "  (no containers)"
  fi
fi
if have ss; then
  if ss -ltn 2>/dev/null | grep -q '127.0.0.1:8787\|:8787 '; then warn "port 8787 is in use; set BRIDGE_HOST_PORT in .env to another port"; else ok "port 8787 is free"; fi
fi

echo "== The Buzz community"
if [ -z "$RELAY" ]; then
  warn "no community address given (pass it as the first argument)"
else
  http="${RELAY/wss:\/\//https://}"
  http="${http/ws:\/\//http://}"
  info=$(curl -s --max-time 10 -H 'Accept: application/nostr+json' "$http" || true)
  if echo "$info" | grep -q '"version"'; then
    ok "$RELAY answers: $(echo "$info" | tr -d '\n' | sed -E 's/.*"version" *: *"([^"]*)".*/version \1/')"
    echo "     Release images bundle Buzz tools from relay 0.2.1. If the version differs, build with a matching BUZZ_COMMIT (docs/operations.md#matching-the-relay-version)."
  else
    bad "$RELAY did not answer like a Buzz relay from this machine"
  fi
fi
echo
echo "Preflight finished. Nothing was changed."
