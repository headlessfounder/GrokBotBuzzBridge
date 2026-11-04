// Reads the prompt text that Block's agent runner (buzz-acp) builds for each
// turn. The runner writes plain-text sections such as:
//
//   [Context]
//   Scope: thread
//   Channel: ask-grok (#5f0c…uuid)
//   Thread root: <64 hex>
//   …use `--reply-to <64 hex>`…
//
//   [Thread Context (3 of 3 messages)]
//   [1] Alice (npub: …) (2026-11-03T…): first message
//
//   [Buzz event: @mention]
//   Event ID: <64 hex>
//   Channel: ask-grok (#uuid)
//   Kind: 9
//   From: Alice (npub: npub1…, hex: <64 hex>)
//   Time: 2026-11-03T…
//   Content: the question, possibly over several lines
//   Tags: [[…]]
//   Parsed: parent=…, root=…
//
// We only need a few fields to route the answer back. The whole text is also
// forwarded to Grok Bot unchanged, so nothing is lost if parsing misses a field.

export interface BuzzEvent {
  id: string;
  kind: number | null;
  fromHex: string | null;
  fromLabel: string | null;
  content: string;
  root: string | null;
}

export interface ParsedTurn {
  scope: "dm" | "thread" | "channel" | "unknown";
  channelId: string | null;
  channelName: string | null;
  threadRoot: string | null;
  replyAnchor: string | null;
  events: BuzzEvent[];
}

const HEX = "[0-9a-f]{64}";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function contextSection(text: string): string {
  const start = text.indexOf("[Context]");
  if (start < 0) return "";
  const rest = text.slice(start + "[Context]".length);
  const next = rest.search(/\n\[[A-Z][^\]\n]*\]/);
  return next < 0 ? rest : rest.slice(0, next);
}

function parseChannel(line: string | undefined): { id: string | null; name: string | null } {
  if (!line) return { id: null, name: null };
  const withName = line.match(new RegExp(`^(.*) \\(#(${UUID})\\)\\s*$`, "i"));
  if (withName) return { id: withName[2]!.toLowerCase(), name: withName[1]!.trim() || null };
  const bare = line.match(new RegExp(`(${UUID})`, "i"));
  return { id: bare ? bare[1]!.toLowerCase() : null, name: null };
}

function parseEvents(text: string): BuzzEvent[] {
  const events: BuzzEvent[] = [];
  const re = new RegExp(`^Event ID: (${HEX})$`, "gim");
  const starts: Array<{ id: string; index: number }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push({ id: m[1]!.toLowerCase(), index: m.index });
  for (let i = 0; i < starts.length; i++) {
    const block = text.slice(starts[i]!.index, i + 1 < starts.length ? starts[i + 1]!.index : undefined);
    const kind = block.match(/^Kind: (\d+)$/m);
    const from = block.match(new RegExp(`^From: (.*?)\\s*\\((?:npub: [^,]+, )?hex: (${HEX})\\)\\s*$`, "im"));
    const fromNoLabel = block.match(new RegExp(`^From: (npub1[0-9a-z]+) \\(hex: (${HEX})\\)`, "im"));
    // Content runs until the Tags line (always written by the runner) or the
    // next blank-line section header.
    const contentMatch = block.match(/^Content: ([\s\S]*?)(?=\nTags: |\nParsed: |\n\n\[|(?![\s\S]))/m);
    const root = block.match(new RegExp(`^Parsed: .*\\broot=(${HEX})`, "im"));
    let fromLabel: string | null = null;
    let fromHex: string | null = null;
    if (from) {
      fromHex = from[2]!.toLowerCase();
      fromLabel = from[1]!.trim() || null;
    } else if (fromNoLabel) {
      fromHex = fromNoLabel[2]!.toLowerCase();
      fromLabel = fromNoLabel[1]!;
    }
    events.push({
      id: starts[i]!.id,
      kind: kind ? Number(kind[1]) : null,
      fromHex,
      fromLabel,
      content: (contentMatch?.[1] ?? "").trim(),
      root: root ? root[1]!.toLowerCase() : null,
    });
  }
  return events;
}

export function parseTurn(text: string): ParsedTurn {
  const ctx = contextSection(text);
  const scopeMatch = ctx.match(/^Scope: (dm|thread|channel)\s*$/m);
  const channel = parseChannel(ctx.match(/^Channel: (.*)$/m)?.[1]);
  const threadRoot = ctx.match(new RegExp(`^Thread root: (${HEX})`, "im"))?.[1]?.toLowerCase() ?? null;
  const replyAnchor = ctx.match(new RegExp("--reply-to (" + HEX + ")", "i"))?.[1]?.toLowerCase() ?? null;
  const events = parseEvents(text);
  // Fall back to the event block's channel if the context section was absent.
  let { id: channelId, name: channelName } = channel;
  if (!channelId && events.length > 0) {
    const evChannel = text.match(new RegExp(`^Channel: (.*\\(#${UUID}\\))\\s*$`, "im"));
    const parsed = parseChannel(evChannel?.[1]);
    channelId = parsed.id;
    channelName = parsed.name;
  }
  return {
    scope: (scopeMatch?.[1] as ParsedTurn["scope"]) ?? "unknown",
    channelId,
    channelName,
    threadRoot,
    replyAnchor,
    events,
  };
}

/** Where the bot's answer should go, and which conversation it belongs to. */
export function routeFor(turn: ParsedTurn): { replyTo: string | null; threadKey: string; trigger: BuzzEvent | null } {
  const trigger = turn.events.length > 0 ? turn.events[turn.events.length - 1]! : null;
  const root = turn.threadRoot ?? trigger?.root ?? null;
  let replyTo: string | null;
  if (turn.replyAnchor) replyTo = turn.replyAnchor;
  else if (root) replyTo = root;
  else if (turn.scope === "dm") replyTo = null; // plain DM: answer in the DM, not as a thread
  else replyTo = trigger?.id ?? null; // top-level mention: start a thread on it
  const conversation = turn.scope === "dm" && !root ? "dm" : (root ?? trigger?.id ?? "unknown");
  return { replyTo, threadKey: `${turn.channelId ?? "unknown"}:${conversation}`, trigger };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips leading @mentions so commands like "!pause" can be read and the
 * question reads naturally. Display names can contain spaces ("@Grok Bot"),
 * so known names are removed first, longest first.
 */
export function stripMentions(content: string, names: string[] = []): string {
  let s = content.trim();
  const known = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of known) {
      const re = new RegExp(`^@${escapeRegex(name)}(?=$|[\\s,:;!?.])[\\s,:;]*`, "i");
      if (re.test(s)) {
        s = s.replace(re, "");
        changed = true;
      }
    }
    const generic = s.match(/^(?:@\S+|nostr:npub1[0-9a-z]+)[\s,:;]*/i);
    if (generic && !known.length) {
      s = s.slice(generic[0].length);
      changed = true;
    } else if (/^nostr:npub1[0-9a-z]+/i.test(s)) {
      s = s.replace(/^nostr:npub1[0-9a-z]+[\s,:;]*/i, "");
      changed = true;
    }
  }
  return s.trim();
}
