#!/usr/bin/env bash
# End-to-end test against a real Buzz relay (the pinned 0.2.1 image) on this
# machine. Needs Docker. Builds the bridge image, starts relay + bridge + a
# mock Grok Bot, asks questions as a member, and checks the answers arrive.
#
#   test/e2e/run.sh          run the test, leave the stack up for inspection
#   test/e2e/run.sh --down   stop and delete the test stack afterwards
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HERE="$(pwd)"
ROOT="$(cd ../.. && pwd)"
COMPOSE=(docker compose -f "$HERE/compose.yml" --env-file "$HERE/.env.e2e")
IMAGE="${E2E_BRIDGE_IMAGE:-grokbot-buzz-bridge:dev}"

pass=0
fail=0
ok() { echo "  ✓ $*"; pass=$((pass + 1)); }
bad() { echo "  ✗ $*"; fail=$((fail + 1)); }

# Throwaway keys for this run (never reuse them anywhere).
if [ ! -f "$HERE/.env.e2e" ]; then
  node --no-warnings --input-type=module -e "
    const m = await import('$ROOT/src/identity.ts');
    const o = m.generateSecret(), r = m.generateSecret(), u = m.generateSecret();
    console.log('E2E_OWNER_SECRET=' + o);
    console.log('E2E_OWNER_PUBKEY=' + m.publicKeyFromSecret(o));
    console.log('E2E_RELAY_SECRET=' + r);
    console.log('E2E_USER_SECRET=' + u);
    console.log('E2E_USER_PUBKEY=' + m.publicKeyFromSecret(u));
  " > "$HERE/.env.e2e"
  chmod 600 "$HERE/.env.e2e"
fi
set -a
# shellcheck disable=SC1091
. "$HERE/.env.e2e"
set +a

echo "== Building the bridge image ($IMAGE)"
docker buildx build -q -t "$IMAGE" --load "$ROOT" >/dev/null

echo "== Starting the relay"
"${COMPOSE[@]}" up -d --wait relay >/dev/null

# Run Block's buzz tool (from the bridge image) as the owner or a member.
bz() {
  local who="$1"
  shift
  local secret="$E2E_OWNER_SECRET"
  [ "$who" = user ] && secret="$E2E_USER_SECRET"
  docker run --rm -i --network gbb-e2e_default \
    -e BUZZ_RELAY_URL=ws://relay:3000 -e BUZZ_PRIVATE_KEY="$secret" \
    --entrypoint /usr/local/bin/buzz "$IMAGE" "$@"
}
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

echo "== Creating channels"
channel_id() {
  local name="$1"
  local id
  id=$(bz owner channels list | json "next((c['channel_id'] for c in d if c['name']=='$name'), '')")
  if [ -z "$id" ]; then
    id=$(bz owner channels create --name "$name" --type stream --visibility open --description "e2e $name" | json "d['channel_id']")
  fi
  echo "$id"
}
GENERAL=$(channel_id general)
ASK=$(channel_id ask-grok)
echo "  general=$GENERAL ask-grok=$ASK"
bz user channels join --channel "$GENERAL" >/dev/null
bz user channels join --channel "$ASK" >/dev/null
bz user users set-profile --name "Test Member" --about e2e >/dev/null

echo "== Starting the bridge and the mock Grok Bot"
E2E_OPEN_CHANNEL="$ASK" "${COMPOSE[@]}" up -d --force-recreate bridge mockgrok >/dev/null
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T bridge gbb status >/dev/null 2>&1; then break; fi
  sleep 2
done
BOT=$("${COMPOSE[@]}" exec -T bridge gbb identity | json "d['pubkey']")
echo "  bot pubkey $BOT"
sleep 8 # let buzz-acp connect and subscribe

wait_reply() { # channel root_event needle timeout
  local channel="$1" root="$2" needle="$3" timeout="${4:-60}" t=0
  while [ "$t" -lt "$timeout" ]; do
    if bz owner messages thread --channel "$channel" --event "$root" |
      python3 -I -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(m['pubkey']=='$BOT' and '''$needle''' in m['content'] for m in d) else 1)"; then
      return 0
    fi
    sleep 3
    t=$((t + 3))
  done
  return 1
}

echo "== Test 1: @mention in a normal channel gets an answer in a thread"
Q1=$(printf '@Grok Bot what time is the meetup?' | bz user messages send --channel "$GENERAL" --content - --mention "$BOT" | json "d['event_id']")
if wait_reply "$GENERAL" "$Q1" "Mock answer to" 90; then ok "answer posted in the thread"; else bad "no answer to the @mention"; fi

echo "== Test 2: a plain message in the open-questions channel gets an answer"
Q2=$(printf 'Where are the meeting notes?' | bz user messages send --channel "$ASK" --content - | json "d['event_id']")
if wait_reply "$ASK" "$Q2" "Mock answer to" 90; then ok "answer posted without an @mention"; else bad "no answer in the open-questions channel"; fi

echo "== Test 3: a follow-up in the same thread sees the whole conversation"
printf '@Grok Bot and who is bringing food?' | bz user messages send --channel "$GENERAL" --reply-to "$Q1" --content - --mention "$BOT" >/dev/null
if wait_reply "$GENERAL" "$Q1" "3 message(s)" 90; then ok "follow-up answered with the full thread (3 messages)"; else bad "follow-up not answered with thread context"; fi

echo "== Test 4: a retried reply does not post twice"
COUNT=$(bz owner messages thread --channel "$GENERAL" --event "$Q1" | json "sum(1 for m in d if m['pubkey']=='$BOT' and 'Mock answer' in m['content'])")
if [ "$COUNT" = 2 ]; then ok "exactly 2 answers for 2 questions"; else bad "expected 2 answers in the thread, found $COUNT"; fi

echo "== Test 5: admin command"
S1=$(printf '@Grok Bot !status' | bz owner messages send --channel "$GENERAL" --content - --mention "$BOT" | json "d['event_id']")
if wait_reply "$GENERAL" "$S1" "Status: running" 60; then ok "!status answered by the bridge"; else bad "no reply to !status"; fi

echo "== Test 6: non-admins cannot pause the bot"
P1=$(printf '@Grok Bot !pause' | bz user messages send --channel "$GENERAL" --content - --mention "$BOT" | json "d['event_id']")
if wait_reply "$GENERAL" "$P1" "Mock answer to" 90; then ok "treated as a normal question"; else bad "a member's !pause was not treated as a question"; fi

echo "== Test 7: gbb check and the ping"
if "${COMPOSE[@]}" exec -T bridge gbb test-webhook >/dev/null; then ok "webhook ping accepted"; else bad "webhook ping failed"; fi
sleep 5
"${COMPOSE[@]}" exec -T bridge gbb check || true

echo "== Test 8: gbb selftest"
if "${COMPOSE[@]}" exec -T bridge gbb selftest --channel "$ASK" --timeout 90; then ok "selftest passed"; else bad "selftest failed"; fi

echo
"${COMPOSE[@]}" exec -T bridge gbb status || true
echo
echo "Passed $pass, failed $fail"
if [ "${1:-}" = "--down" ]; then "${COMPOSE[@]}" down -v >/dev/null; fi
[ "$fail" -eq 0 ]
