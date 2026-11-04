// The setup page a person opens from a one-time link. It is where secrets are
// pasted (the Grok Bot webhook key) and shown (the connector token), so they
// never pass through the chat of whichever AI agent is doing the install.

export interface SetupView {
  community: string;
  botName: string;
  npub: string;
  webhookConfigured: boolean;
  webhookFromEnv: boolean;
  webhookHost: string | null;
  connectorUrl: string | null;
  connectorUrlWithToken: string | null;
  connectorToken: string;
  checks: Array<{ name: string; ok: boolean | null; detail: string }>;
  flash: string | null;
  csrf: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderSetup(v: SetupView): string {
  const checks = v.checks
    .map((c) => `<li class="${c.ok === null ? "na" : c.ok ? "ok" : "bad"}"><b>${c.ok === null ? "–" : c.ok ? "✓" : "✗"} ${esc(c.name)}</b><span>${esc(c.detail)}</span></li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Bridge setup</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1f;--muted:#6a6a6a;--line:#e3e3e0;--ok:#0b6b3a;--bad:#a1260d;--accent:#0b6463;--chip:#eef6f5}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--ink:#eee;--muted:#a3a3a3;--line:#333;--ok:#5fd18f;--bad:#ff8a73;--accent:#6fd3cb;--chip:#20302f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 24px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
label{display:block;font-weight:600;margin:12px 0 4px}input[type=text],input[type=password],input[type=url]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button{margin-top:14px;padding:10px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;font:600 14px system-ui;cursor:pointer}
button.ghost{background:transparent;color:var(--accent)}code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all}
.copy{display:flex;gap:8px;align-items:center;background:var(--chip);border-radius:8px;padding:8px 10px;margin:4px 0}.copy code{flex:1}
ul.checks{list-style:none;padding:0;margin:0}ul.checks li{display:flex;flex-direction:column;padding:8px 0;border-top:1px solid var(--line)}ul.checks li:first-child{border-top:0}
li.ok b{color:var(--ok)}li.bad b{color:var(--bad)}li.na b{color:var(--muted)}ul.checks span{color:var(--muted);font-size:14px}
.flash{background:var(--chip);border-left:3px solid var(--accent);padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px}
.note{color:var(--muted);font-size:14px}ol{padding-left:20px}
</style></head><body><main>
<h1>${esc(v.botName)} ↔ Buzz bridge</h1>
<p class="sub">Community: <b>${esc(v.community)}</b> · Bot identity: <span class="mono">${esc(v.npub)}</span></p>
${v.flash ? `<div class="flash">${esc(v.flash)}</div>` : ""}

<section class="card"><h2>Status</h2><ul class="checks">${checks}</ul>
<form method="post" action="setup/refresh"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><button class="ghost">Run checks again</button></form></section>

<section class="card"><h2>1 · Grok Bot webhook</h2>
<p class="note">In the Grok Bot app, open the bot that will live in the community, create a routine with the trigger
<b>When a webhook fires</b>, and paste its <b>Webhook URL</b> and <b>Webhook key</b> here.</p>
${v.webhookFromEnv ? `<p class="note">The webhook is set through environment variables on the server, so it can't be changed here.</p>` : `
<form method="post" action="setup/webhook"><input type="hidden" name="csrf" value="${esc(v.csrf)}">
<label for="u">Webhook URL</label><input id="u" name="url" type="url" required placeholder="https://…" autocomplete="off">
<label for="k">Webhook key</label><input id="k" name="key" type="password" required autocomplete="off">
<button>Save webhook</button></form>`}
${v.webhookConfigured ? `<p class="note">Saved: webhook at <b>${esc(v.webhookHost ?? "")}</b>.</p>
<form method="post" action="setup/test-webhook"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><button class="ghost">Send a test webhook</button></form>
<p class="note">The test sends a harmless "ping" so you can see the routine run in Grok Bot. It does not post in Buzz.</p>` : ""}
</section>

<section class="card"><h2>2 · Buzz connector for Grok Bot</h2>
${v.connectorUrl ? `<p class="note">In the Grok Bot app, add a connector (MCP server) to the same bot. Use the URL and a header if the form offers one:</p>
<label>Connector URL</label><div class="copy"><code>${esc(v.connectorUrl)}</code></div>
<label>Header</label><div class="copy"><code>Authorization: Bearer ${esc(v.connectorToken)}</code></div>
<p class="note">If the form has no place for headers, use this URL instead (the token is part of it, so treat the whole URL as a secret):</p>
<div class="copy"><code>${esc(v.connectorUrlWithToken ?? "")}</code></div>
<form method="post" action="setup/rotate-connector" onsubmit="return confirm('Grok Bot will stop reaching Buzz until you paste the new token. Continue?')"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><button class="ghost">Make a new token</button></form>`
    : `<p class="note">Set <code>BRIDGE_PUBLIC_URL</code> on the server first. Grok Bot runs in the cloud and needs a public https address to reach the connector.</p>`}
</section>

<section class="card"><h2>3 · Routine instructions</h2>
<p class="note">Paste the text from <code>grokbot/ROUTINE.md</code> in the bridge's repository into the routine's instructions. It tells Grok Bot how to read each question and answer with the connector.</p>
</section>

<p class="note">This page link works once and this session ends after an hour. Ask the person or agent running the install for a new link with <code>gbb setup-link</code>.</p>
</main></body></html>`;
}
