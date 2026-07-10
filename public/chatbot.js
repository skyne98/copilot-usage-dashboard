// ============================================================
// Clippy Chat — browser UI layer.
// Imports the pure rule engine (chatbot-engine.js, which has no
// DOM/CDN deps and is unit-tested in test/chatbot.test.js) and
// adds a Win2k-style chat window. Replies are also voiced through
// Clippy himself via clippySpeak() if the clippyjs agent loaded.
//
// An optional "🧠 AI" toggle loads LFM2.5-350M-ONNX in-browser
// (WebGPU) and routes messages to the real model with streaming,
// instead of the rule engine. See clippy-lfm.js.
// ============================================================

import { respond, makeContext } from './chatbot-engine.js';
import { clippySpeak, setMuted } from './clippy.js';
import { lfmSupported, loadLFM, clippyAskLFM } from './clippy-lfm.js';

// ============================================================
//  Chat UI — a Win2k-style chat window, built from JS.
// ============================================================
class ChatUI {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'chatwin';
    this.root.innerHTML = `
      <div class="chat-titlebar">
        <span class="chat-avatar">📎</span>
        <span class="chat-title">Clippy Chat</span>
        <span class="chat-btns">
          <button class="chat-ai" title="Toggle on-device AI (LFM2.5 via WebGPU)">🧠 AI</button>
          <button class="chat-clear" title="Clear conversation">✕</button>
          <button class="chat-min" title="Minimize">_</button>
        </span>
      </div>
      <div class="chat-body">
        <div class="chatlog"></div>
        <div class="chat-suggest"></div>
        <div class="chat-inputrow">
          <input class="chat-input" type="text" placeholder="Ask Clippy anything…" autocomplete="off" />
          <button class="chat-send">Send</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);

    this.log = this.root.querySelector('.chatlog');
    this.input = this.root.querySelector('.chat-input');
    this.body = this.root.querySelector('.chat-body');
    this.minBtn = this.root.querySelector('.chat-min');
    this.clearBtn = this.root.querySelector('.chat-clear');
    this.aiBtn = this.root.querySelector('.chat-ai');
    this.sendBtn = this.root.querySelector('.chat-send');
    this.suggest = this.root.querySelector('.chat-suggest');

    this.sendBtn.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this.submit(); });
    this.minBtn.addEventListener('click', () => this.toggle());
    this.clearBtn.addEventListener('click', () => this.clear());
    this.aiBtn.addEventListener('click', () => this.onToggleAI?.());
    // AI mode now works on any browser (WASM fallback); only disable if even WASM
    // somehow isn't available.
    this.aiBtn.disabled = typeof WebAssembly === 'undefined';
    this.aiBtn.title = typeof WebAssembly === 'undefined'
      ? 'WebAssembly unavailable — AI mode needs a modern browser'
      : 'Toggle on-device AI (LFM2.5 via WebGPU, or WASM fallback) — first load downloads ~276MB';
  }
  submit() {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.onSend?.(text);
    this.input.focus();
  }
  add(text, who) {
    const el = document.createElement('div');
    el.className = `chatmsg ${who}`;
    el.innerHTML = `<span class="who">${who === 'user' ? 'You' : '📎 Clippy'}:</span> ${escapeHtml(text)}`;
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    this.body.classList.remove('hidden');
    return el;
  }
  // A bot message whose text we'll mutate as tokens stream in.
  streamingMsg() {
    const el = document.createElement('div');
    el.className = 'chatmsg bot streaming';
    el.innerHTML = '<span class="who">📎 Clippy:</span> <span class="stream-text"></span><span class="cursor">▌</span>';
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    this.body.classList.remove('hidden');
    return el.querySelector('.stream-text');
  }
  toggle() {
    const hidden = this.body.classList.toggle('hidden');
    this.minBtn.textContent = hidden ? '▢' : '_';
  }
  clear() {
    this.log.innerHTML = '';
    this.onClear?.();
    this.add('Conversation cleared. What would you like to know?', 'bot');
  }
  setSuggestions(chips) {
    this.suggest.innerHTML = chips.map(c => `<button class="chat-chip">${escapeHtml(c)}</button>`).join('');
    this.suggest.querySelectorAll('.chat-chip').forEach(btn =>
      btn.addEventListener('click', () => { this.input.value = btn.textContent; this.submit(); }));
  }
  setAIState(state) {
    // 'off' | 'loading' | 'on' | 'error'
    const map = { off: '🧠 AI', loading: '⏳ AI…', on: '🧠 AI ✓', error: '⚠️ AI' };
    this.aiBtn.textContent = map[state] || map.off;
    this.aiBtn.classList.toggle('active', state === 'on' || state === 'loading');
    this.aiBtn.classList.toggle('err', state === 'error');
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- public init ----------
export function initChatbot({ getState } = {}) {
  const ctx = makeContext(null);
  const ui = new ChatUI();
  let aiMode = false;       // rule engine by default
  let aiLoading = false;

  // Toggle AI mode: load the model on first enable; off → back to rule engine.
  ui.onToggleAI = async () => {
    if (aiMode) { aiMode = false; ui.setAIState('off'); ui.add('Switched back to rule-based mode.', 'bot'); return; }
    if (aiLoading) return;
    if (!lfmSupported()) { ui.add('AI mode needs WebAssembly — try a modern browser.', 'bot'); return; }
    aiLoading = true; ui.setAIState('loading');
    ui.add('Loading LFM2.5-350M in your browser (uses WebGPU if available, else WASM; first run downloads the model)…', 'bot');
    try {
      await loadLFM({ onProgress: m => {/* status reflected in button; could log here */} });
      aiMode = true; ui.setAIState('on');
      ui.add('🧠 AI ready! Now chatting with LFM2.5 running locally in your browser. (Toggle off anytime.)', 'bot');
    } catch (e) {
      ui.setAIState('error');
      ui.add(`AI load failed: ${e.message}. Staying in rule-based mode.`, 'bot');
    } finally { aiLoading = false; }
  };

  ui.onSend = async (text) => {
    ctx.state = getState?.() || null;
    ui.add(text, 'user');

    if (aiMode) {
      // Stream the model's reply token-by-token into the chat window + Clippy.
      const target = ui.streamingMsg();
      let got = '';
      try {
        got = await clippyAskLFM(text, {
          onToken: (delta, full) => { target.textContent = full; ui.log.scrollTop = ui.log.scrollHeight; },
        }) ?? '';
      } catch (e) {
        target.textContent = `(AI error: ${e.message})`;
      }
      if (!got.trim()) {
        target.textContent = '(no reply — try rephrasing, or toggle AI off)';
      }
      ctx.turns++;
      return;
    }

    // Rule-based path (default).
    const { text: reply } = respond(text, ctx);
    ui.add(reply, 'bot');
    setMuted(ctx.muted); // sync mute flag to Clippy's shared state
    if (!ctx.muted) clippySpeak(reply);
    ctx.turns++;
  };
  ui.onClear = () => { ctx.pending = null; ctx._kk = null; ctx.lastIntent = null; };

  // Quick-start suggestion chips — surface the chatbot's range at a glance.
  ui.setSuggestions(['help', 'how many credits', 'top user', 'tell me a joke', 'play a game']);
  ui.setAIState('off');

  // Opening line.
  setTimeout(() => {
    ui.add("Hi! I'm Clippy's chat brain — 100% rule-based, zero AI. Try “help”, “how many credits”, “top user”, or “@their-login”. Or just say hi! (Click 🧠 AI to run LFM2.5 on-device.)", 'bot');
  }, 500);

  return { respond, ctx, ui };
}
