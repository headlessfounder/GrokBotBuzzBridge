// The THREAD sample is a real prompt captured from Block's buzz-acp (relay
// 0.2.1) during the end-to-end test. Keys in it are throwaway test keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTurn, routeFor, stripMentions } from "../../src/prompt.ts";

const ROOT = "43554bcef2691dd6b2bcd3bef03b9e93a8f9cd22156a4d264bc0d7b71d62c4d6";
const CH = "4c43b3c1-2856-4645-a42b-aec99d6f1640";
const ASKER = "004d418086118a3e3a3203ae96ccba2f4d523eb3fb0f1d22903a0846a14d1620";

const THREAD = `[Context]
Scope: thread
Channel: general (#${CH})
Thread root: ${ROOT}
Thread context included below. Use \`buzz messages thread --channel <UUID> --event <ID>\` for full history if truncated.
IMPORTANT: For ordinary replies in this turn, use \`--reply-to ${ROOT}\` on \`buzz messages send\` so the conversation stays threaded. If the human explicitly asks for a channel-root, top-level, or broadcast post, send that message without \`--reply-to\`. If the requested destination is ambiguous, ask before sending.

[Thread Context (3 of 3 messages)]
[1] Test Member (${ASKER}) (2026-11-04T02:20:37+00:00): @Grok Bot what time is the meetup?
[2] Grok Bot (7a5623e9a16bfd29b9c5e50b5b5e8e68a7e3e1d1774f5697544cb4729466d3a5) (2026-11-04T02:20:38+00:00): Mock answer
I can see 1 message(s) in this thread.
[3] Test Member (${ASKER}) (2026-11-04T02:20:44+00:00): @Grok Bot and who is bringing food?

[Buzz event: mentions]
Event ID: 3764cf3fa7296d15376cdef8275ee0ee19dde321df7bb239509e9e319b422f36
Channel: general (#${CH})
Kind: 9
From: Test Member (npub: npub1qpx5rqyxzx9ruw3jqwhfdn969ax4y04nlv836g5s8gyydg2dzcsqqf62cg, hex: ${ASKER})
Time: 2026-11-04T02:20:44+00:00
Content: @Grok Bot and who is bringing food?
Tags: [["h","${CH}"],["e","${ROOT}","","reply"],["p","7a5623e9a16bfd29b9c5e50b5b5e8e68a7e3e1d1774f5697544cb4729466d3a5"]]
Parsed: parent=${ROOT}, root=${ROOT}, mentions=[Grok Bot (7a5623e9a16bfd29b9c5e50b5b5e8e68a7e3e1d1774f5697544cb4729466d3a5)]`;

const TOP_ID = "a".repeat(64);
const TOP_LEVEL = `[Context]
Scope: channel
Channel: ask-grok (#${CH})
Hint: Use \`buzz messages get --channel <UUID>\` for recent messages if needed.
IMPORTANT: This is a new top-level message. For ordinary replies in this turn, use \`--reply-to ${TOP_ID}\` on \`buzz messages send\` — the triggering message is the thread root.

[Buzz event: open-questions]
Event ID: ${TOP_ID}
Channel: ask-grok (#${CH})
Kind: 9
From: npub1qpx5rqyxzx9ruw3jqwhfdn969ax4y04nlv836g5s8gyydg2dzcsqqf62cg (hex: ${ASKER})
Time: 2026-11-04T02:20:44+00:00
Content: Where are the notes?
Second line of the question.
Tags: [["h","${CH}"]]`;

test("reads a threaded follow-up", () => {
  const t = parseTurn(THREAD);
  assert.equal(t.scope, "thread");
  assert.equal(t.channelId, CH);
  assert.equal(t.channelName, "general");
  assert.equal(t.threadRoot, ROOT);
  assert.equal(t.replyAnchor, ROOT);
  assert.equal(t.events.length, 1);
  const e = t.events[0]!;
  assert.equal(e.id, "3764cf3fa7296d15376cdef8275ee0ee19dde321df7bb239509e9e319b422f36");
  assert.equal(e.fromHex, ASKER);
  assert.equal(e.fromLabel, "Test Member");
  assert.equal(e.content, "@Grok Bot and who is bringing food?");
  assert.equal(e.root, ROOT);
  const r = routeFor(t);
  assert.equal(r.replyTo, ROOT);
  assert.equal(r.threadKey, `${CH}:${ROOT}`);
});

test("reads a top-level question without a profile name", () => {
  const t = parseTurn(TOP_LEVEL);
  assert.equal(t.scope, "channel");
  assert.equal(t.channelName, "ask-grok");
  const e = t.events[0]!;
  assert.equal(e.fromHex, ASKER);
  assert.equal(e.content, "Where are the notes?\nSecond line of the question.");
  const r = routeFor(t);
  assert.equal(r.replyTo, TOP_ID, "a top-level question starts a thread on itself");
  assert.equal(r.threadKey, `${CH}:${TOP_ID}`);
});

test("follow-ups and the first question share one thread key", () => {
  // The first question's key is channel:<its id>; follow-ups carry root=<that id>.
  const first = routeFor(parseTurn(TOP_LEVEL));
  const followUp = routeFor(parseTurn(THREAD.replaceAll(ROOT, TOP_ID)));
  assert.equal(first.threadKey, followUp.threadKey);
});

test("strips the bot's @mention, including names with spaces", () => {
  assert.equal(stripMentions("@Grok Bot !status", ["Grok Bot"]), "!status");
  assert.equal(stripMentions("@grok bot, what time?", ["Grok Bot"]), "what time?");
  assert.equal(stripMentions("@Grok Bot @Grok Bot hi", ["Grok Bot"]), "hi");
  assert.equal(stripMentions("@Alice can you check?", ["Grok Bot"]), "@Alice can you check?");
  assert.equal(stripMentions("@Grokky hello", ["Grok"]), "@Grokky hello");
  assert.equal(stripMentions("@someone hello"), "hello");
});

test("unparseable text yields no route", () => {
  const t = parseTurn("hello there");
  assert.equal(t.channelId, null);
  assert.equal(routeFor(t).trigger, null);
});
