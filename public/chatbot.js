// ============================================================
// Clippy Chat — browser UI layer.
// Imports the pure rule engine (chatbot-engine.js, which has no
// DOM/CDN deps and is unit-tested in test/chatbot.test.js) and
// adds a Win2k-style chat window. Replies are also voiced through
// Clippy himself via clippySpeak() if the clippyjs agent loaded.
// ============================================================

import { respond, makeContext } from './chatbot-engine.js';
import { clippySpeak, setMuted } from './clippy.js';

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
    this.sendBtn = this.root.querySelector('.chat-send');
    this.suggest = this.root.querySelector('.chat-suggest');

    this.sendBtn.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this.submit(); });
    this.minBtn.addEventListener('click', () => this.toggle());
    this.clearBtn.addEventListener('click', () => this.clear());
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
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- public init ----------
export function initChatbot({ getState } = {}) {
  const ctx = makeContext(null);
  const ui = new ChatUI();

  ui.onSend = (text) => {
    ctx.state = getState?.() || null;
    ui.add(text, 'user');
    const { text: reply } = respond(text, ctx);
    // If muted, still log bot replies quietly? No — muted means Clippy stays quiet,
    // but the chat window is the explicit channel, so always show there.
    ui.add(reply, 'bot');
    // Sync the engine's mute flag to Clippy's shared flag so “be quiet” silences
    // his autonomous chatter (idle lines, fetch/drill-in remarks) too — not just
    // this chat window's voicing.
    setMuted(ctx.muted);
    if (!ctx.muted) clippySpeak(reply); // voice it through the paperclip if he's around
    ctx.turns++;
  };
  ui.onClear = () => { ctx.pending = null; ctx._kk = null; ctx.lastIntent = null; };

  // Quick-start suggestion chips — surface the chatbot's range at a glance.
  ui.setSuggestions(['help', 'how many credits', 'top user', 'tell me a joke', 'play a game']);

  // Opening line.
  setTimeout(() => {
    ui.add("Hi! I'm Clippy's chat brain — 100% rule-based, zero AI. Try “help”, “how many credits”, “top user”, or “@their-login”. Or just say hi!", 'bot');
  }, 500);

  return { respond, ctx, ui };
}
