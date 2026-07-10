// ============================================================
// Clippy integration for the Copilot Usage Dashboard.
// Loads `clippyjs` from CDN (no build step needed) and wires
// contextual banter to the dashboard's data + interactions.
// The dashboard already sports a Windows 2000 desktop theme,
// so the classic Office paperclip fits right in. 📎
// ============================================================

// Pinned: clippyjs 0.1.0 is the only published version (== latest). Pinning guards
// against a future breaking release. The 0.1.0 ESM API: initAgent + agents.Clippy
// + show/speak/moveTo/animate — all used below.
const CLIPPY_CDN = "https://cdn.jsdelivr.net/npm/clippyjs@0.1.0/dist/index.mjs";
const AGENTS_CDN = "https://cdn.jsdelivr.net/npm/clippyjs@0.1.0/dist/agents/index.mjs";

let agent = null;
let ready = false;
let booted = false;
let lastSpoke = 0;

// Shared mute flag — lifted out of the chatbot engine's ctx so it gates ALL of
// Clippy's speech: idle banter, fetch/drill-in remarks, AND chatbot voicing.
// The chatbot's "be quiet"/"speak" intents sync this via setMuted().
let muted = false;

const greetings = [
  "Hi there! I'm Clippy. Looks like you're checking Copilot usage — want some help?",
  "Hello! I'm here to help you make sense of those AI credits. They add up fast!",
  "Welcome! I'm Clippy, your friendly neighborhood usage assistant. Let's crunch some numbers!",
  "It looks like you're trying to optimize AI spend. Would you like help with that?",
];

const idleLines = [
  "Did you know? Code completions are free — credits go to Chat, the agent, and PR summaries.",
  "I can hold paper together AND analyze token usage. Multitalented!",
  "Keeping an eye on those AI credits? Smart move.",
  "Agent sessions burn credits fast — worth a glance at who's running the most.",
  "I'm just a paperclip standing in front of a dashboard, asking it to make sense.",
  "Every 1 credit is a penny. A thousand credits? That's lunch. Spend wisely!",
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Avoid stomping a speech balloon that's only just appeared.
function throttle(ms = 6000) {
  const now = Date.now();
  if (now - lastSpoke < ms) return false;
  lastSpoke = now;
  return true;
}

// ---------- lifecycle ----------
export async function bootClippy() {
  if (booted) return;
  booted = true;
  try {
    const { initAgent } = await import(CLIPPY_CDN);
    const agents = await import(AGENTS_CDN);
    agent = await initAgent(agents.Clippy);
    await agent.show();
    // clippyjs 0.1.0 sets its own z-index (10001) on the agent element, which is
    // already above the chat window (9000) and chart tooltip (50) — no DOM tweak
    // needed. (The element is a classless div, so querySelector wouldn't target it.)
    ready = true;
    // Park Clippy clear of the chat window (which lives bottom-left). He keeps
    // his iconic bottom-right spot on desktop, but moves to the top-right on
    // narrow screens so the two never fight for space.
    positionClippy();
    window.addEventListener('resize', positionClippy);
    say(pick(greetings));

    // Idle: occasionally strike a pose…
    setInterval(() => { if (ready) agent.animate(); }, 22000);
    // …and every so often chip in with a remark. (Gated by `muted` via say().)
    setInterval(() => { if (ready && throttle(30000)) say(pick(idleLines)); }, 75000);
  } catch (e) {
    // CDN blocked / offline? No problem — dashboard works fine without me.
    console.warn("[clippy] could not load agent:", e);
  }
}

// All speech funnels through here, so the shared `muted` flag gates every channel.
function say(msg) {
  if (!ready || !agent || muted) return;
  try { agent.speak(msg); lastSpoke = Date.now(); } catch { /* ignore */ }
}

// Keep Clippy clear of the chat window (bottom-left). Desktop → bottom-right
// (his classic spot); narrow screens → top-right so they never overlap.
let _posTimer = null;
function positionClippy() {
  if (!agent) return;
  // Debounce: clippyjs queues actions, so coalesce rapid resize bursts.
  clearTimeout(_posTimer);
  _posTimer = setTimeout(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const x = Math.max(8, w - 140);          // ~124px sprite + margin
    const y = w < 700 ? 8 : Math.max(8, h - 120); // top-right on mobile, else bottom-right
    try { agent.moveTo(x, y, 0); } catch { /* ignore */ }
  }, 80);
}

// Public speak: used by the rule-based chatbot to voice its replies through Clippy.
// Also gated by the shared `muted` flag so "be quiet" silences this channel too.
export function clippySpeak(msg) {
  if (!ready || !agent || muted) return false;
  try { agent.speak(msg); lastSpoke = Date.now(); return true; } catch { return false; }
}

// Sync the shared mute flag from the chatbot engine's ctx.muted.
export function setMuted(v) { muted = !!v; }
export function clippyReady() { return ready; }

// ---------- contextual hooks ----------
// All reference agentic fields only (aiCredits, agentSessions, activeUsers,
// topModels, overLimit) — no acceptance-rate / languages, which PR #1 removed.
export function clippyCommentOverview(state) {
  if (!ready || !throttle()) return;
  const o = state?.overview;
  if (!o?.kpis) { say(pick(idleLines)); return; }
  const k = o.kpis;
  const usdPerCredit = state.meta?.creditUsd ?? 0.01;
  const lines = [];

  if (k.aiCredits != null) {
    const dollars = (k.aiCredits * usdPerCredit);
    lines.push(`Your team used ${k.aiCredits.toLocaleString()} AI credits — about $${dollars.toLocaleString()}. Ka-ching!`);
  }
  if (k.agentSessions != null) lines.push(`${k.agentSessions} agent sessions this window — that's where the credits go!`);
  if (k.activeUsers != null) lines.push(`${k.activeUsers} active users this window. Adoption looks healthy!`);
  const top = o.topModels?.[0];
  if (top) lines.push(`Top model: ${top.name}. Fancy!`);

  say(pick(lines) || pick(idleLines));
}

export function clippyCommentUser(u) {
  if (!ready || !throttle()) return;
  if (!u) return;
  const lines = [
    `Checking up on ${u.name || u.login}? I'm sure they're doing their best.`,
    `${(u.aiCredits || 0).toLocaleString()} credits for this user. Every token counts!`,
    u.overLimit > 0
      ? `${u.login} is over their credit limit by ${u.overLimit}. Might be worth a chat!`
      : `${u.agentSessions ?? 0} agent sessions for ${u.login}. The proof is in the pull requests!`,
    `Looking at ${u.login}'s breakdown? Let me know if anything looks fishy.`,
  ];
  say(pick(lines));
}
