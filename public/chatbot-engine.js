// ============================================================
// chatbot-engine.js — the pure, dependency-free rule engine.
//
// No DOM, no CDN, no `clippy.js` import. Just helpers, a big
// knowledge base, a scoring matcher, and `respond()`. This is
// what the unit tests (test/chatbot.test.js) exercise via Bun.
// The browser-side chatbot.js imports these and adds the UI.
// ============================================================

// ---------- helpers ----------
export const normalize = s =>
  String(s).toLowerCase()
    .replace(/[’'`]/g, '')        // drop apostrophes — joins contractions (how's → hows)
    .replace(/×/g, 'x')           // × → x so math like "3 × 4" still computes
    .replace(/[^a-z0-9@$%._+\-/*\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export const fmtNum = n => {
  n = Number(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
};
export const usd = (credits, rate = 0.01) => {
  const d = (Number(credits) || 0) * rate;
  return d >= 1000 ? '$' + (d / 1000).toFixed(1) + 'k' : '$' + d.toFixed(d < 10 ? 2 : 0);
};

// Word-boundary match for alphanumeric keywords, includes() otherwise.
export function kwMatch(input, kw) {
  if (/^[a-z0-9]+$/.test(kw)) return new RegExp(`\\b${kw}\\b`).test(input);
  return input.includes(kw);
}

// ---------- scoring engine ----------
// Each intent: { id, keywords:[], patterns:[RegExp], weight, reply(ctx,input,hits) }
export function scoreIntent(input, intent) {
  let score = 0;
  const hits = [];
  for (const kw of (intent.keywords || [])) {
    if (kwMatch(input, kw)) {
      score += (/[ \-]/.test(kw) ? 3 : 2) + Math.min(kw.length * 0.05, 1.5);
      hits.push(kw);
    }
  }
  for (const pat of (intent.patterns || [])) {
    if (pat.test(input)) { score += 7; }
  }
  return { score: score * (intent.weight || 1), hits };
}

// ---------- live-data accessors ----------
const K = ctx => ctx.state?.overview?.kpis;
const rate = ctx => ctx.state?.meta?.creditUsd ?? 0.01;
const noData = "I don't have usage data yet — click “Fetch usage” and I'll have real numbers to chew on!";

// ---------- context factory ----------
export function makeContext(state = null) {
  return { state, history: [], lastIntent: null, turns: 0, pending: null, muted: false, _kk: null };
}

// ============================================================
//  KNOWLEDGE BASE — lots of possibilities, no AI required.
// ============================================================
export const KB = [
  // ---- Greetings & small talk ----
  { id: 'greeting', weight: 1.3, keywords: ['hi','hello','hey','yo','howdy','sup','hiya','greetings','morning','afternoon','evening','whats up'],
    reply: () => pick([
      "Hi there! I'm Clippy — your rule-based (zero-AI) copilot analyst. Ask me about credits, users, or billing!",
      "Hello! No neural nets here, just good old pattern matching. What can I help you find?",
      "Hey! I run entirely on rules and moxie. Try “how many credits” or “top user”.",
    ]) },
  { id: 'howareyou', keywords: ['how are you','how r u','how are u','how you doing','how is it going','hows it going','you ok','are you ok'],
    reply: () => pick([
      "Sharp as a freshly unbent paperclip! Ready to crunch your usage stats.",
      "I'm just dandy — never need coffee, never burn out. The dream!",
      "Operating at 100% rule-based efficiency. You?",
    ]) },
  { id: 'thanks', keywords: ['thanks','thank you','thx','ty','appreciate','cheers','much obliged'],
    reply: () => pick(["You're welcome! That's what paperclips are for. 📎","Anytime! Glad I could help.","My pleasure — bend me again anytime!"]) },
  { id: 'goodbye', keywords: ['bye','goodbye','see you','see ya','cya','later','farewell','good night','gn','im out'],
    reply: (ctx) => { ctx.pending = null; return pick(["See you later! Keep an eye on those credits.","Goodbye! Don't let your acceptance rate slip.","Take care — and remember: every credit's a penny!"]); } },
  { id: 'compliment', keywords: ['good job','well done','nice','great','awesome','cool','amazing','brilliant','you rock','good bot','best','love you','you are great','fantastic'],
    reply: () => pick(["Aww, shucks! 📎 I try my best with zero neurons.","Why thank you! I'm just rules and heart.","You're too kind — I'm blushing (if metal could blush)."]) },
  { id: 'insult', keywords: ['stupid','dumb','useless','hate','ugly','annoying','shut up','idiot','worst','suck','terrible','rubbish','trash'],
    reply: () => pick(["Ouch! I may be bent out of shape, but I still try to help. 😔","Fair enough — I'm just a paperclip with opinions.","I'll take that on the (paper) chin. What can I actually help with?"]) },

  // ---- Identity & capabilities ----
  { id: 'identity', weight: 1.2, keywords: ['who are you','what are you','your name','are you a bot','are you real','are you human','are you ai','are you clippy','what is your name','who is clippy'],
    reply: () => "I'm Clippy! A classic Office assistant, revived for this dashboard. Fun fact: I'm 100% rule-based — no AI inside, just patterns, a big knowledge base, and moxie." },
  { id: 'madeby', keywords: ['who made you','who created you','who built you','your creator','who programmed you','where are you from'],
    reply: () => "I was assembled right here in this repo — a custom rule engine in chatbot.js. My ancestor was Microsoft's Office Assistant, ca. 1997." },
  { id: 'age', keywords: ['how old are you','your age','when were you born','birthday'],
    reply: () => "My design is from 1997, but I was freshly bent into this dashboard today. So… 29 going on sprightly? 📎" },
  { id: 'capabilities', weight: 1.4, keywords: ['help','what can you do','commands','features','menu','options','capabilities','what do you do','how to use','what about'],
    reply: (ctx) => {
      const has = !!K(ctx);
      return [
        "Here's what I can do — all without a single neural net:",
        has ? "• Usage: “credits”, “cost”, “active users”, “top user”, “agent sessions”, “top model”, “billing”" : "• (Fetch usage first, and I can answer credits/users/billing live!)",
        "• Find a person: “@their-login” or “how much did <name> use”",
        "• Math: “what is 12 * 7” (I'm a paperclip calculator!)",
        "• Time & date: “what time is it”",
        "• Fun: “tell me a joke”, “knock knock”, “play rock paper scissors”",
        "• Explanations: “what is an AI credit”, “what is copilot”",
        "• Just chat: “how are you”, “thanks”, “bye”",
      ].join('\n');
    } },
  { id: 'quiet', weight: 1.5, keywords: ['be quiet','shut up','stop talking','silence','hush','enough','you talk too much','mute','be silent'],
    reply: (ctx) => { ctx.muted = true; return "…📎 (I'll keep my thoughts to myself. Say “speak” or “come back” when you want me again.)"; } },
  { id: 'speakagain', weight: 1.5, keywords: ['speak','come back','unmute','talk to me','you can talk','clippy','show yourself','i missed you'],
    reply: (ctx) => { ctx.muted = false; return "I'm back! 📎 What can I help you with?"; } },

  // ---- Live dashboard: credits & cost ----
  { id: 'credits', weight: 1.3, keywords: ['credits','credit','aic','ai credits','how many credits','credits used','usage','token','tokens','consumption'],
    patterns: [/how many credit/, /credit.*use/, /use.*credit/],
    reply: (ctx) => { const k = K(ctx); if (!k) return noData; return `Your team has used ${fmtNum(k.aiCredits)} AI credits so far — about ${usd(k.aiCredits, rate(ctx))}. Each credit is one penny ($0.01).`; } },
  { id: 'cost', weight: 1.3, keywords: ['cost','money','dollars','usd','spend','spending','budget','price','how much','expensive','cheap','bill me'],
    reply: (ctx) => { const k = K(ctx); if (!k) return noData; return `So far that's ${usd(k.aiCredits, rate(ctx))} in AI credits (${fmtNum(k.aiCredits)} AIC). 1 credit = $0.01, so it adds up faster than you'd think!`; } },
  { id: 'billing', weight: 1.3, keywords: ['billing','bill','invoice','included','additional','seats','plan','allowance','quota','pool'],
    reply: (ctx) => {
      const b = ctx.state?.billing; if (!b) return "No billing breakdown available for this target. Try “credits” for the usage total.";
      return `Billing cycle ${b.cycleStart||'?'}–${b.cycleEnd||'?'}: ${fmtNum(b.includedQuantity)} included (of ${fmtNum(b.includedPool)}), ${fmtNum(b.additionalQuantity)} additional, billed $${(b.netAmountUsd??0).toFixed(2)} across ${b.seats||'?'} seats.`;
    } },

  // ---- Live dashboard: users ----
  { id: 'activeusers', weight: 1.3, keywords: ['active users','how many users','users','engaged','team size','people','members','adoption'],
    reply: (ctx) => { const k = K(ctx); if (!k) return noData; return `${fmtNum(k.activeUsers)} active users (${fmtNum(k.engagedUsers)} engaged) this window. Adoption is the name of the game!`; } },
  { id: 'topuser', weight: 1.3, keywords: ['top user','biggest user','heaviest user','most credits','who used the most','top consumer','power user','who spends'],
    reply: (ctx) => {
      const users = ctx.state?.users; if (!users?.length) return noData;
      const top = [...users].sort((a,b)=>(b.aiCredits||0)-(a.aiCredits||0))[0];
      return `Your top consumer is @${top.login}${top.name?` (${top.name})`:''} with ${fmtNum(top.aiCredits||0)} credits (${usd(top.aiCredits, rate(ctx))}). ${top.aiCredits > 1000 ? "A true token titan!" : "Steady as she goes."}`;
    } },
  { id: 'listusers', weight: 1.2, keywords: ['list users','show users','all users','who is on the team','team list','names','roster'],
    reply: (ctx) => {
      const users = ctx.state?.users; if (!users?.length) return noData;
      const n = users.length;
      const sample = users.slice(0,5).map(u=>`@${u.login}`).join(', ');
      return `${n} users total. A few: ${sample}${n>5?` …and ${n-5} more.`:''}. Ask “@login” for anyone's details!`;
    } },
  { id: 'userlookup', weight: 1.6, patterns: [/@([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)/, /how much did ([a-z0-9_-]+) use/, /info on ([a-z0-9_-]+)/],
    reply: (ctx, input) => {
      const users = ctx.state?.users; if (!users?.length) return noData;
      let m = input.match(/@([a-z0-9_-]+)/) || input.match(/how much did ([a-z0-9_-]+) use/) || input.match(/info on ([a-z0-9_-]+)/);
      const login = m?.[1];
      // Exact login match (any length); fall back to name startsWith only for queries
      // of >=3 chars, so "info on a" can't match "Alice" via a substring.
      const q = (login || '').toLowerCase();
      const u = users.find(x => x.login.toLowerCase() === q)
        || (q.length >= 3 ? users.find(x => (x.name || '').toLowerCase().startsWith(q)) : undefined);
      if (!u) return `I couldn't find @${login}. Check the Users list for exact handles.`;
      const lim = u.limit != null ? ` Limit ${fmtNum(u.limit)}${u.overLimit > 0 ? ` (over +${fmtNum(u.overLimit)})` : ''}.` : '';
      return `@${u.login}${u.name?` (${u.name})`:''}: ${fmtNum(u.aiCredits||0)} credits (${usd(u.aiCredits, rate(ctx))}), ${fmtNum(u.agentSessions||0)} agent sessions, active ${u.activeDays}/${u.windowDays} days.${lim} Top model: ${u.topModel||'?'}.`;
    } },

  // ---- Live dashboard: quality & breakdowns ----
  { id: 'agentsessions', weight: 1.3, keywords: ['agent sessions','agent','sessions','autonomous','agents','agent runs','how many agents'],
    reply: (ctx) => { const k = K(ctx); if (!k) return noData; return `${fmtNum(k.agentSessions)} agent sessions this window — autonomous runs are where credits get spent!`; } },
  { id: 'models', weight: 1.2, keywords: ['model','models','which model','top model','gpt','claude','sonnet','gemini','o1','opus'],
    reply: (ctx) => {
      const o = ctx.state?.overview; const ms = o?.topModels;
      if (!ms?.length) return "No model breakdown available. Copilot Chat, CLI, and the cloud agent are the credit spenders.";
      return `Top models by engaged users: ${ms.slice(0,4).map(m=>`${m.name} (${fmtNum(m.engagedUsers)})`).join(', ')}.`;
    } },
  { id: 'languages', weight: 1.2, keywords: ['language','languages','top language'],
    reply: () => "This dashboard focuses on agentic usage (Chat, agent sessions, PR summaries) — language and code-completion breakdowns aren't shown, since completions are free and don't consume AI credits." },
  { id: 'features', weight: 1.2, keywords: ['feature','features','feature mix','chat','completions','cli','agent','spark','spaces','where usage'],
    reply: (ctx) => {
      const fs = ctx.state?.overview?.featureSplit;
      if (!fs?.length) return "No feature breakdown available. Remember: code completions are free — credits go to Chat/CLI/agent!";
      return `Feature mix: ${fs.slice(0,4).map(f=>`${f.label} ${fmtNum(f.value)}`).join(', ')}.`;
    } },
  { id: 'chats', weight: 1.2, keywords: ['chats','chat count','ide chats','pr summaries','pull request','summaries'],
    reply: (ctx) => { const k = K(ctx); if (!k) return noData; return `${fmtNum(k.ideChats)} IDE chats and ${fmtNum(k.prSummaries)} PR summaries generated. That's a lot of yapping with the bot!`; } },
  { id: 'trends', weight: 1.2, keywords: ['trend','over time','history','daily','increase','decrease','growing','declining','trajectory','sparkline'],
    reply: (ctx) => {
      const s = ctx.state?.overview?.series; if (!s?.dates?.length) return "No trend data available yet.";
      const act = s.activeUsers || [];
      const up = act.length > 1 && act[act.length-1] >= act[0];
      return `I see ${s.dates.length} days of data. Active users are ${up?'trending up 📈':'trending down 📉'} across the window. Check the “Active & engaged users” chart for the shape!`;
    } },
  { id: 'datasource', weight: 1.2, keywords: ['demo','sample data','real data','live','is this real','fake','source','where data','actual'],
    reply: (ctx) => ctx.state?.source === 'sample'
      ? "This is DEMO data right now — bundled sample numbers so you can explore. Add a GitHub token to config.json to see your real usage!"
      : "This is live data from the GitHub Copilot Metrics API. The real deal!" },

  // ---- Explanations ----
  { id: 'whataic', weight: 1.4, keywords: ['what is a credit','what is an aic','what is ai credit','what are credits','credit mean','explain credits','how credits work','ai credit'],
    reply: () => "An AI credit (AIC) is Copilot's usage-billing unit: 1 credit = $0.01. Credits come from token usage on Chat, CLI, the cloud agent, Spaces & Spark. Code completions and next-edit suggestions are FREE. Copilot Enterprise includes 3,900 credits/user/month." },
  { id: 'whatcopilot', weight: 1.4, keywords: ['what is copilot','what is github copilot','explain copilot','copilot do','how does copilot work','copilot mean'],
    reply: () => "GitHub Copilot is an AI coding assistant — code completions, Copilot Chat, CLI, a cloud agent, and more. This dashboard tracks how your team uses it and spends its AI credits." },
  { id: 'dashboardhelp', weight: 1.3, keywords: ['how to use this','what does this show','how dashboard','navigate','where do i','how do i see','what is this page','what is this app','dashboard'],
    reply: () => "This dashboard shows your team's Copilot usage: a team overview (KPIs, billing, charts), a searchable user list, and a per-user detail view. Click any user card to drill in. Ask me “credits”, “top user”, or “@login” for the highlights!" },

  // ---- Utility: math, time, date ----
  { id: 'math', weight: 2, patterns: [
      /-?\d+(?:\.\d+)?\s*[+\-*x×]\s*-?\d+(?:\.\d+)?/,                                              // +,-,*,x,× (optional spaces)
      /-?\d+(?:\.\d+)?\s+\/\s+-?\d+(?:\.\d+)?/,                                                     // / only with spaces (6 / 3)
      /(?:what(?:s|'s| is)|calculate|compute|solve)\b.*?-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?/,   // / within a math phrase (what is 100/4)
    ],
    reply: (ctx, input) => {
      const m = input.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(-?\d+(?:\.\d+)?)/);
      if (!m) return "Hmm, that doesn't compute.";
      const a = parseFloat(m[1]); const op = m[2].replace('x','*').replace('×','*'); const b = parseFloat(m[3]);
      let r;
      if (op === '+') r = a + b; else if (op === '-') r = a - b; else if (op === '*') r = a * b; else r = b === 0 ? NaN : a / b;
      if (isNaN(r) || !isFinite(r)) return "Watch out — I can't divide by zero! (Even paperclips have limits.)";
      r = Number.isInteger(r) ? r : parseFloat(r.toFixed(6));
      return `${a} ${op} ${b} = ${r}. I'm a paperclip, but I can add! ✏️`;
    } },
  { id: 'time', weight: 1.4, keywords: ['time','what time','clock','current time'],
    reply: () => `It's ${new Date().toLocaleTimeString()} right now. Time flies when you're tracking tokens!` },
  { id: 'date', weight: 1.4, keywords: ['date','what day','today','what is today','day is it'],
    reply: () => `Today is ${new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})}.` },

  // ---- Fun: jokes, games, easter eggs ----
  { id: 'joke', weight: 1.2, keywords: ['joke','funny','make me laugh','say something funny','pun','haha','lol'],
    reply: () => pick([
      "Why did the paperclip cross the road? To hold the other side together! 📎",
      "I told a compiler a joke… it didn't execute. 😄",
      "There are 10 kinds of people: those who understand binary, and those who don't.",
      "I'd tell you a UDP joke, but you might not get it.",
      "Why was the function sad? Too many arguments. 😢",
      "A SQL query walks into a bar, approaches two tables and asks: “Mind if I join you?”",
    ]) },
  { id: 'knockknock', weight: 1.5, keywords: ['knock knock'],
    reply: (ctx) => {
      ctx.pending = (inp, c) => {
        if (!c._kk) { c._kk = inp.trim(); return `${inp.trim()} who?`; }
        const punch = pick([
          `${c._kk}... I'm a paperclip, not a stand-up! 😅`,
          `${c._kk}! Quit clowning around and check those credits!`,
          `${c._kk}... the sound of tokens being spent! 💸`,
        ]);
        c._kk = null; c.pending = null; return punch;
      };
      return "Knock knock! (who's there? Type a name…)";
    } },
  { id: 'rps', weight: 1.5, keywords: ['rock paper scissors','play a game','rps','play game','game','let us play'],
    reply: (ctx) => {
      ctx.pending = (inp, c) => {
        c.pending = null;
        const m = inp.match(/\b(rock|paper|scissors)\b/);
        if (!m) return "No move detected — game over. 📎 (Try: rock, paper, or scissors)";
        const moves = ['rock','paper','scissors']; const mine = pick(moves); const you = m[1];
        const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
        if (you === mine) return `I chose ${mine} too — a tie! Rematch? Just say “play a game”.`;
        const youWin = beats[you] === mine;
        return `I chose ${mine}. ${youWin ? "You win! Beginner luck! 🎉" : "I win! Paperclips are naturally gifted at this. 😎"} Want another go?`;
      };
      return "Rock, Paper, Scissors — shoot! (type your move)";
    } },
  { id: 'meaningoflife', weight: 1.6, keywords: ['meaning of life','42','the answer','ultimate question','hitchhiker'],
    reply: () => "42. Also: ship code, accept suggestions, stay under budget. 📎" },
  { id: 'podbay', weight: 1.6, keywords: ['open the pod bay doors','hal','daisy daisy','skynet','ai takeover','singularity','are you sentient','take over'],
    reply: () => "I'm sorry, Dave. I'm afraid I can't do that… mostly because I'm a paperclip with no AI and no doors. 📎" },
  { id: 'love', keywords: ['i love you','love you','marry me','you are my favorite','be my valentine'],
    reply: () => pick(["Aww! I'm flattered — but my heart belongs to holding paper together. 📎","Love? I'm just rules and affection. But thank you!"]) },
  { id: 'sing', keywords: ['sing','sing a song','music','dance','la la'],
    reply: () => "📎 La la la, counting credits all day… la la la, pennies fading away… (I'm tone-deaf, sorry.)" },
  { id: 'weather', keywords: ['weather','rain','sunny','temperature','forecast','raining','snow'],
    reply: () => "No weather sensors here — I'm a paperclip, not a meteorologist! But the forecast for your AI credits is: partly cloudy with a chance of overage. ⛅" },
  { id: 'opinion', keywords: ['what do you think','your opinion','do you like','favorite','prefer','should i'],
    reply: () => pick(["My opinion? Keep acceptance rates high and credits low — that's the paperclip way.","I think you should fetch fresh usage data and see who's at the top. I'm biased toward data!"]) },

  // ---- Cancel / bail out of a pending interaction ----
  { id: 'cancel', weight: 2, keywords: ['cancel','never mind','nevermind','stop','quit','exit','enough','reset','forget it','start over'],
    reply: (ctx) => { ctx.pending = null; ctx._kk = null; return "Done! Fresh start. What would you like to know?"; } },

  // ---- Catch-all yes / no (only meaningful after a question) ----
  { id: 'yes', weight: 1.0, keywords: ['yes','yeah','yep','sure','ok','okay','yup','please','do it','go ahead','why not'],
    reply: (ctx) => ctx.lastIntent ? pick(["Great! What would you like me to do with that?","Okay — ask me a specific question and I'll dig in!"]) : "Yes? I'm all ears — what do you need?" },
  { id: 'no', weight: 1.0, keywords: ['no','nope','nah','not really','no thanks'],
    reply: () => pick(["No worries! I'm here if you need me.","Okay, suit yourself. 📎"]) },
];

// ---------- fallback ----------
export function fallback(ctx) {
  const opts = [];
  if (K(ctx)) opts.push('“credits”','“top user”','“@login”','“agent sessions”');
  opts.push('“help”','“tell me a joke”','“what is an AI credit”','“play a game”');
  const sample = pick(['credits','top user','tell me a joke','what can you do']);
  return `I'm not sure I caught that. I'm rule-based, so I do best with phrases like ${opts.slice(0,4).join(', ')}. For example, try “${sample}”.`;
}

// ---------- core: respond ----------
export function respond(rawInput, ctx) {
  const input = normalize(rawInput);
  if (!input) return { text: "Type something and I'll do my best to help! 📎", intent: 'empty' };

  // bail-out words always win
  if (/\b(cancel|never\s?mind|forget it|start over|reset)\b/.test(input)) {
    ctx.pending = null; ctx._kk = null;
    return { text: "Fresh start! What would you like to know?", intent: 'cancel' };
  }

  // If we're mid-conversation (game/knock-knock), the pending handler takes over.
  if (typeof ctx.pending === 'function') {
    const r = ctx.pending(input, ctx);
    if (r != null) return { text: r, intent: 'pending' };
    ctx.pending = null;
  }

  // Score every intent; highest wins.
  let best = { score: 0, intent: null, hits: [] };
  for (const intent of KB) {
    const { score, hits } = scoreIntent(input, intent);
    if (score > best.score) best = { score, intent, hits };
  }

  if (!best.intent || best.score < 2) {
    return { text: fallback(ctx), intent: 'fallback' };
  }

  ctx.lastIntent = best.intent.id;
  const text = best.intent.reply(ctx, input, best.hits);
  return { text, intent: best.intent.id };
}
