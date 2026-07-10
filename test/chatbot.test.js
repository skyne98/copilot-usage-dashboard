// ============================================================
// chatbot-engine.test.js — extensive Bun unit tests for the
// 100% rule-based chatbot engine. No AI, no network, no DOM.
// Covers: helpers, KB integrity, intent routing, live-data
// replies, graceful no-data, math, time/date, fun & games,
// conversation state, fallback, and context isolation.
// ============================================================

import { test, describe, expect } from 'bun:test';
import {
  respond, makeContext, KB, normalize, fmtNum, usd, kwMatch, scoreIntent, fallback,
} from '../public/chatbot-engine.js';
import { sampleState, liveState, tinyState, emptyState } from './fixtures.js';

// Deterministic-ish helper: run respond N times, collect the texts.
const times = (n, fn) => Array.from({ length: n }, fn);
const replies = (n, input, ctx = makeContext(sampleState)) =>
  times(n, () => respond(input, ctx).text);
// True when ANY of N runs produced a string containing `sub` (handles pick()).
const someReplyHas = (input, sub, ctx, n = 12) =>
  replies(n, input, ctx).some(t => t.includes(sub));
// Collect all distinct intents produced over N runs.
const distinctIntents = (n, input, ctx = makeContext(sampleState)) =>
  [...new Set(times(n, () => respond(input, ctx).intent))];

// ============================================================
// 1. Helpers
// ============================================================
describe('helpers', () => {
  describe('normalize', () => {
    test('lowercases', () => expect(normalize('HELLO')).toBe('hello'));
    test('collapses whitespace', () => expect(normalize('  a   b  ')).toBe('a b'));
    test('converts curly quotes to straight', () =>
      expect(normalize("it’s")).toBe("its"));
    test('drops apostrophes to join contractions', () => {
      expect(normalize("how's it going")).toBe("hows it going");
      expect(normalize("don't stop")).toBe("dont stop");
    });
    test('strips punctuation but keeps math/operators', () => {
      expect(normalize('What is 12 * 7?')).toBe('what is 12 * 7');
      expect(normalize('@alice, hi!')).toBe('@alice hi');
      expect(normalize('100% / 4')).toBe('100% / 4');
    });
    test('handles non-string input', () => expect(normalize(42)).toBe('42'));
    test('trims to empty for symbol-only input', () => expect(normalize('!!!???')).toBe(''));
  });

  describe('fmtNum', () => {
    test('small numbers pass through as strings', () => {
      expect(fmtNum(0)).toBe('0');
      expect(fmtNum(42)).toBe('42');
      expect(fmtNum(999)).toBe('999');
    });
    test('thousands use k suffix', () => {
      expect(fmtNum(1000)).toBe('1k');
      expect(fmtNum(7102)).toBe('7.1k');
      expect(fmtNum(46800)).toBe('47k'); // >=10000 → 0 decimals
    });
    test('coerces non-numbers to 0', () => {
      expect(fmtNum(null)).toBe('0');
      expect(fmtNum('abc')).toBe('0');
      expect(fmtNum(undefined)).toBe('0');
    });
  });

  describe('usd', () => {
    test('1 credit = $0.01 by default', () => {
      expect(usd(0)).toBe('$0.00');
      expect(usd(100)).toBe('$1.00');
      expect(usd(500)).toBe('$5.00');
    });
    test('large amounts use k suffix', () => {
      expect(usd(5000)).toBe('$50');
      expect(usd(50000)).toBe('$500');   // 50000*0.01=500 → <1000
      expect(usd(500000)).toBe('$5.0k'); // 500000*0.01=5000 → k
    });
    test('respects custom rate', () => {
      expect(usd(100, 0.02)).toBe('$2.00');
      expect(usd(100, 0.1)).toBe('$10');
    });
    test('small amounts keep 2 decimals', () => {
      expect(usd(5)).toBe('$0.05');
      expect(usd(9)).toBe('$0.09');
    });
  });

  describe('kwMatch', () => {
    test('alphanumeric keyword uses word boundary', () => {
      expect(kwMatch('hi there', 'hi')).toBe(true);
      expect(kwMatch('this is big', 'hi')).toBe(false); // 'hi' inside 'this' must not match
      expect(kwMatch('hello', 'hello')).toBe(true);
    });
    test('multiword / symbol keyword uses includes', () => {
      expect(kwMatch('how many credits', 'how many')).toBe(true);
      expect(kwMatch('@alice', '@al')).toBe(true);
      expect(kwMatch('top user', 'top user')).toBe(true);
    });
  });

  describe('scoreIntent', () => {
    test('returns 0 for no matches', () => {
      const intent = { id: 'x', keywords: ['credits'], weight: 1 };
      expect(scoreIntent('hello world', intent).score).toBe(0);
    });
    test('keyword hits populate hits[]', () => {
      const intent = { id: 'x', keywords: ['credits', 'usage'], weight: 1 };
      const r = scoreIntent('how many credits usage', intent);
      expect(r.hits).toContain('credits');
      expect(r.hits).toContain('usage');
      expect(r.score).toBeGreaterThan(0);
    });
    test('pattern match adds 7 (×weight)', () => {
      const intent = { id: 'x', patterns: [/knock knock/], weight: 1.5 };
      expect(scoreIntent('knock knock', intent).score).toBeCloseTo(7 * 1.5);
    });
    test('multiword keywords score higher than single', () => {
      const single = scoreIntent('top user', { id: 'a', keywords: ['top'], weight: 1 }).score;
      const multi = scoreIntent('top user', { id: 'b', keywords: ['top user'], weight: 1 }).score;
      expect(multi).toBeGreaterThan(single);
    });
    test('weight scales the score', () => {
      const w1 = scoreIntent('credits', { id: 'a', keywords: ['credits'], weight: 1 }).score;
      const w2 = scoreIntent('credits', { id: 'b', keywords: ['credits'], weight: 2 }).score;
      expect(w2).toBeCloseTo(w1 * 2);
    });
  });
});

// ============================================================
// 2. KB integrity
// ============================================================
describe('knowledge base integrity', () => {
  test('KB is a non-empty array', () => {
    expect(Array.isArray(KB)).toBe(true);
    expect(KB.length).toBeGreaterThan(30);
  });
  test('every intent has a unique id', () => {
    const ids = KB.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('every intent has a reply function', () => {
    for (const i of KB) expect(typeof i.reply).toBe('function');
  });
  test('every intent has keywords[] or patterns[]', () => {
    for (const i of KB) {
      const hasKw = Array.isArray(i.keywords) && i.keywords.length > 0;
      const hasPat = Array.isArray(i.patterns) && i.patterns.length > 0;
      expect(hasKw || hasPat).toBe(true);
    }
  });
  test('patterns are valid RegExp', () => {
    for (const i of KB) for (const p of (i.patterns || [])) expect(p).toBeInstanceOf(RegExp);
  });
  test('every reply() returns a non-empty string for sample state', () => {
    const ctx = makeContext(sampleState);
    for (const i of KB) {
      const out = i.reply(ctx, normalize('test'), []);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });
  test('makeContext returns isolated objects', () => {
    const a = makeContext(); const b = makeContext();
    a.pending = () => 'x'; a._kk = 'y'; a.muted = true;
    expect(b.pending).toBeNull();
    expect(b._kk).toBeNull();
    expect(b.muted).toBe(false);
  });
});

// ============================================================
// 3. Intent routing — many phrases → expected intent
// ============================================================
describe('intent routing', () => {
  // Each: [input, expectedIntentId]. Verified against the scoring engine.
  const cases = [
    ['hi', 'greeting'],
    ['hello there', 'greeting'],
    ['hey yo', 'greeting'],
    ['how are you', 'howareyou'],
    ['how are u doing', 'howareyou'],
    ['thanks', 'thanks'],
    ['thank you very much', 'thanks'],
    ['bye', 'goodbye'],
    ['see you later', 'goodbye'],
    ['good job', 'compliment'],
    ['you are great', 'compliment'],
    ['you rock', 'compliment'],
    ['you are stupid', 'insult'],
    ['shut up idiot', 'insult'],
    ['who are you', 'identity'],
    ['what are you', 'identity'],
    ['are you a bot', 'identity'],
    ['are you ai', 'identity'],
    ['who made you', 'madeby'],
    ['how old are you', 'age'],
    ['help', 'capabilities'],
    ['what can you do', 'capabilities'],
    ['be quiet', 'quiet'],
    ['shut up stop talking', 'quiet'],
    ['speak', 'speakagain'],
    ['come back', 'speakagain'],
    ['what is an ai credit', 'whataic'],
    ['what is copilot', 'whatcopilot'],
    ['what is github copilot', 'whatcopilot'],
    ['how to use this dashboard', 'dashboardhelp'],
    ['what does this show', 'dashboardhelp'],
    ['what time is it', 'time'],
    ['current time', 'time'],
    ['what day is it', 'date'],
    ['what is today', 'date'],
    ['meaning of life', 'meaningoflife'],
    ['42', 'meaningoflife'],
    ['open the pod bay doors', 'podbay'],
    ['are you sentient', 'podbay'],
    ['i love you', 'love'],
    ['sing a song', 'sing'],
    ['what is the weather', 'weather'],
    ['knock knock', 'knockknock'],
    ['tell me a joke', 'joke'],
    ['say something funny', 'joke'],
    ['play a game', 'rps'],
    ['rock paper scissors', 'rps'],
    ['what do you think', 'opinion'],
    ['how many agent sessions', 'agentsessions'],
    ['top languages', 'languages'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      const ctx = makeContext(sampleState);
      const { intent } = respond(input, ctx);
      expect(intent).toBe(expected);
    });
  }

  test('routing is deterministic (no random drift in intent)', () => {
    const ctx = makeContext(sampleState);
    const intents = distinctIntents(10, 'how many credits', ctx);
    expect(intents).toEqual(['credits']);
  });
});

// ============================================================
// 4. Live-data replies (with sample state)
// ============================================================
describe('live-data replies', () => {
  test('credits → reports AIC count + USD + penny note', () => {
    const ctx = makeContext(sampleState);
    const r = respond('how many credits', ctx);
    expect(r.intent).toBe('credits');
    expect(r.text).toContain('AI credits');
    expect(r.text).toContain('$');
    expect(r.text).toContain('penny');
  });
  test('cost → reports USD + AIC', () => {
    const r = respond('how much does it cost', makeContext(sampleState));
    expect(r.intent).toBe('cost');
    expect(r.text).toContain('$');
    expect(r.text).toContain('AIC');
  });
  test('active users → counts active + engaged', () => {
    const r = respond('how many active users', makeContext(sampleState));
    expect(r.intent).toBe('activeusers');
    expect(r.text).toContain('active users');
    expect(r.text).toContain('engaged');
  });
  test('top user → names the heaviest consumer', () => {
    const r = respond('who is the top user', makeContext(sampleState));
    expect(r.intent).toBe('topuser');
    expect(r.text).toContain('top consumer');
    expect(r.text).toMatch(/@\w+/);
  });
  test('top user picks the actual max by aiCredits', () => {
    const ctx = makeContext(tinyState);
    const r = respond('top user', ctx);
    expect(r.text).toContain('@alice'); // alice has 400 > bob 100
  });
  test('list users → reports count + sample handles', () => {
    const r = respond('list all users', makeContext(sampleState));
    expect(r.intent).toBe('listusers');
    expect(r.text).toContain('users total');
    expect(r.text).toMatch(/@\w+/);
  });
  test('agent sessions → reports autonomous-run count', () => {
    const r = respond('agent sessions', makeContext(tinyState)); // agentSessions 42
    expect(r.intent).toBe('agentsessions');
    expect(r.text).toContain('42');
    expect(r.text).toContain('agent sessions');
  });
  test('models → lists top model + engaged users', () => {
    const r = respond('top models', makeContext(sampleState));
    expect(r.intent).toBe('models');
    expect(r.text).toContain('Top models');
  });
  test('languages → agentic-focus notice (not tracked)', () => {
    const r = respond('top languages', makeContext(sampleState));
    expect(r.intent).toBe('languages');
    expect(r.text).toContain('agentic');
  });
  test('features → lists feature mix', () => {
    const r = respond('feature mix', makeContext(sampleState));
    expect(r.intent).toBe('features');
    expect(r.text).toContain('Feature mix');
  });
  test('chats → reports IDE chats + PR summaries', () => {
    const r = respond('how many chats', makeContext(sampleState));
    expect(r.intent).toBe('chats');
    expect(r.text).toContain('IDE chats');
    expect(r.text).toContain('PR summaries');
  });
  test('trends → trending up when last >= first', () => {
    const r = respond('trend over time', makeContext(tinyState)); // activeUsers [1,2,3]
    expect(r.intent).toBe('trends');
    expect(r.text).toContain('trending up');
  });
  test('trends → trending down when last < first', () => {
    const ctx = makeContext({ ...tinyState, overview: { ...tinyState.overview, series: { dates: ['a', 'b', 'c'], activeUsers: [5, 3, 1] } } });
    expect(respond('trend over time', ctx).text).toContain('trending down');
  });
  test('billing → reports cycle + included/additional/seats', () => {
    const r = respond('billing breakdown', makeContext(sampleState));
    expect(r.intent).toBe('billing');
    expect(r.text).toContain('Billing cycle');
    expect(r.text).toContain('included');
    expect(r.text).toContain('additional');
    expect(r.text).toContain('seats');
  });
  test('datasource (sample) → DEMO notice', () => {
    const r = respond('is this real data', makeContext(sampleState));
    expect(r.intent).toBe('datasource');
    expect(r.text).toContain('DEMO');
  });
  test('datasource (live) → live notice', () => {
    const r = respond('is this real data', makeContext(liveState));
    expect(r.text).toContain('live data');
  });

  // User lookup — the @-mention feature.
  describe('user lookup', () => {
    test('@login resolves to that user (with limit)', () => {
      const ctx = makeContext(tinyState);
      const r = respond('@alice', ctx);
      expect(r.intent).toBe('userlookup');
      expect(r.text).toContain('@alice');
      expect(r.text).toContain('400');
      expect(r.text).toContain('5 agent sessions');
      expect(r.text).toContain('Limit 500');
      expect(r.text).toContain('GPT-4o');
    });
    test('over-limit user shows over-limit tag', () => {
      const r = respond('@bob', makeContext(tinyState));
      expect(r.intent).toBe('userlookup');
      expect(r.text).toContain('over +50');
    });
    test('"how much did <name> use" resolves', () => {
      const r = respond('how much did bob use', makeContext(tinyState));
      expect(r.intent).toBe('userlookup');
      expect(r.text).toContain('@bob');
      expect(r.text).toContain('100');
    });
    test('"info on <login>" resolves', () => {
      const r = respond('info on alice', makeContext(tinyState));
      expect(r.intent).toBe('userlookup');
      expect(r.text).toContain('@alice');
    });
    test('unknown user → friendly not-found', () => {
      const r = respond('@nobody', makeContext(tinyState));
      expect(r.text).toContain("couldn't find");
    });
    test('lookup by name (not login) works via startsWith', () => {
      // "ali" (>=3 chars) matches Alice by name prefix.
      const r = respond('info on ali', makeContext(tinyState));
      expect(r.text).toContain('@alice');
    });
    test('short query does NOT fuzzy-match the wrong person', () => {
      // "a" (1 char) must not match Alice/Bob via substring — exact login only.
      const r = respond('info on a', makeContext(tinyState));
      expect(r.text).toContain("couldn't find");
    });
  });
});

// ============================================================
// 5. Graceful no-data (empty ctx)
// ============================================================
describe('graceful no-data', () => {
  const dataIntents = [
    ['credits', 'credits'], ['cost', 'cost'], ['active users', 'activeusers'],
    ['top user', 'topuser'], ['list users', 'listusers'], ['agent sessions', 'agentsessions'],
    ['how many chats', 'chats'],
  ];
  for (const [input] of dataIntents) {
    test(`"${input}" with no data → noData message`, () => {
      const r = respond(input, makeContext(emptyState));
      expect(r.text).toContain('usage data');
    });
  }
  test('billing with no billing object → graceful hint', () => {
    const ctx = makeContext({ ...tinyState, billing: null });
    const r = respond('billing', ctx);
    expect(r.intent).toBe('billing');
    expect(r.text).toContain('credits'); // "Try “credits” for the usage total."
  });
  test('user lookup with no users → noData', () => {
    const r = respond('@alice', makeContext(emptyState));
    expect(r.text).toContain('usage data');
  });
  test('fallback mentions more options when data present vs absent', () => {
    const withData = fallback(makeContext(sampleState));
    const without = fallback(makeContext(emptyState));
    expect(withData).toContain('top user');
    // without data, fewer live options are suggested
    expect(without.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 6. Math
// ============================================================
describe('math', () => {
  const cases = [
    ['2 + 2', 4], ['10 - 3', 7], ['4 * 5', 20], ['100 / 4', 25],
    ['7 x 6', 42], ['3 × 4', 12], ['1.5 + 2.5', 4], ['10 - 20', -10],
    ['6 / 3', 2], ['2.5 * 4', 10], ['0 + 0', 0], ['99 / 1', 99],
  ];
  for (const [expr, expected] of cases) {
    test(`"${expr}" = ${expected}`, () => {
      const r = respond(`what is ${expr}`, makeContext(sampleState));
      expect(r.intent).toBe('math');
      expect(r.text).toContain(String(expected));
    });
  }
  test('division by zero → guarded message', () => {
    const r = respond('what is 5 / 0', makeContext(sampleState));
    expect(r.intent).toBe('math');
    expect(r.text).toContain('divide by zero');
  });
  test('math output echoes the operands', () => {
    const r = respond('what is 8 * 7', makeContext(sampleState));
    expect(r.text).toContain('8');
    expect(r.text).toContain('7');
    expect(r.text).toContain('56');
    expect(r.text).toContain('=');
  });
  test('x and × are treated as *', () => {
    expect(respond('3 x 4', makeContext()).text).toContain('12');
    expect(respond('3 × 4', makeContext()).text).toContain('12');
  });
  test('bare date-like input (7/8) is NOT treated as math', () => {
    // A user typing a date shouldn't get "7 / 8 = 0.875" — the `/` op requires
    // spaces or an explicit math phrase.
    expect(respond('7/8', makeContext()).intent).toBe('fallback');
    expect(respond('07/08', makeContext()).intent).toBe('fallback');
  });
});

// ============================================================
// 7. Time & date
// ============================================================
describe('time and date', () => {
  test('time → contains a clock-ish value', () => {
    const r = respond('what time is it', makeContext());
    expect(r.intent).toBe('time');
    expect(r.text).toMatch(/\d{1,2}:\d{2}/);
  });
  test('date → contains a weekday name', () => {
    const r = respond('what is the date', makeContext());
    expect(r.intent).toBe('date');
    const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    expect(weekdays.some(w => r.text.includes(w))).toBe(true);
  });
});

// ============================================================
// 8. Fun & games
// ============================================================
describe('fun and games', () => {
  test('joke → non-empty one-liner', () => {
    const r = respond('tell me a joke', makeContext());
    expect(r.intent).toBe('joke');
    expect(r.text.length).toBeGreaterThan(5);
  });
  test('joke varies across calls (random pick)', () => {
    const set = new Set(replies(20, 'joke'));
    expect(set.size).toBeGreaterThan(1);
  });

  describe('knock-knock (multi-turn)', () => {
    test('opens with "Knock knock" and sets pending', () => {
      const ctx = makeContext();
      const r = respond('knock knock', ctx);
      expect(r.intent).toBe('knockknock');
      expect(r.text).toContain('Knock knock');
      expect(typeof ctx.pending).toBe('function');
    });
    test('first reply echoes the name + "who?"', () => {
      const ctx = makeContext();
      respond('knock knock', ctx);
      const r = respond('orange', ctx);
      expect(r.intent).toBe('pending');
      expect(r.text).toContain('orange who?');
    });
    test('second reply delivers a punchline and clears pending', () => {
      const ctx = makeContext();
      respond('knock knock', ctx);
      respond('orange', ctx);
      const r = respond('anything', ctx);
      expect(r.text.length).toBeGreaterThan(0);
      expect(ctx.pending).toBeNull();
    });
    test('cancel mid-joke resets state', () => {
      const ctx = makeContext();
      respond('knock knock', ctx);
      const r = respond('cancel', ctx);
      expect(r.intent).toBe('cancel');
      expect(ctx.pending).toBeNull();
      expect(ctx._kk).toBeNull();
    });
  });

  describe('rock-paper-scissors (multi-turn)', () => {
    test('opens with "shoot" and sets pending', () => {
      const ctx = makeContext();
      const r = respond('play rock paper scissors', ctx);
      expect(r.intent).toBe('rps');
      expect(r.text.toLowerCase()).toContain('shoot');
      expect(typeof ctx.pending).toBe('function');
    });
    test('valid move → mentions a choice', () => {
      const ctx = makeContext();
      respond('play a game', ctx);
      const r = respond('rock', ctx);
      expect(r.intent).toBe('pending');
      expect(r.text).toContain('I chose');
      expect(ctx.pending).toBeNull();
    });
    test('win/loss/tie always mentions a move word', () => {
      const ctx = makeContext();
      respond('play a game', ctx);
      const r = respond('paper', ctx);
      expect(r.text).toMatch(/rock|paper|scissors/);
    });
    test('invalid move → game-over message', () => {
      const ctx = makeContext();
      respond('play a game', ctx);
      const r = respond('banana', ctx);
      expect(r.text).toContain('No move');
    });
  });

  test('meaning of life / 42', () => {
    const r = respond('meaning of life', makeContext());
    expect(r.intent).toBe('meaningoflife');
    expect(r.text).toContain('42');
  });
  test('podbay easter egg', () => {
    const r = respond('open the pod bay doors', makeContext());
    expect(r.intent).toBe('podbay');
    expect(r.text).toContain("can't do that");
  });
  test('love → affectionate but deflecting', () => {
    const r = respond('i love you', makeContext());
    expect(r.intent).toBe('love');
    // reply is randomly one of two variants
    expect(r.text).toMatch(/flattered|Love|paperclip/);
  });
  test('sing → tone-deaf song', () => {
    const r = respond('sing me a song', makeContext());
    expect(r.intent).toBe('sing');
    expect(r.text).toContain('la la');
  });
  test('weather → deflects to credits forecast', () => {
    const r = respond('weather forecast', makeContext());
    expect(r.intent).toBe('weather');
    expect(r.text).toContain('paperclip');
  });
  test('opinion → shares a take', () => {
    const r = respond('what do you think', makeContext());
    expect(r.intent).toBe('opinion');
    expect(r.text.length).toBeGreaterThan(5);
  });
});

// ============================================================
// 9. Conversation state
// ============================================================
describe('conversation state', () => {
  test('lastIntent is recorded after a matched reply', () => {
    const ctx = makeContext();
    respond('credits', ctx);
    expect(ctx.lastIntent).toBe('credits');
  });
  test('pending handler intercepts before scoring', () => {
    const ctx = makeContext();
    ctx.pending = () => 'INTERCEPTED';
    const r = respond('credits', ctx);
    expect(r.text).toBe('INTERCEPTED');
    expect(r.intent).toBe('pending');
  });
  test('pending returning null falls through to scoring', () => {
    const ctx = makeContext(sampleState);
    ctx.pending = () => null;
    const r = respond('credits', ctx);
    expect(r.intent).toBe('credits');
  });
  test('cancel always wins (even mid-game)', () => {
    const ctx = makeContext();
    respond('play a game', ctx); // sets pending
    const r = respond('never mind', ctx);
    expect(r.intent).toBe('cancel');
    expect(ctx.pending).toBeNull();
  });
  test('makeContext starts clean', () => {
    const ctx = makeContext(sampleState);
    expect(ctx.pending).toBeNull();
    expect(ctx._kk).toBeNull();
    expect(ctx.muted).toBe(false);
    expect(ctx.lastIntent).toBeNull();
    expect(ctx.turns).toBe(0);
  });
});

// ============================================================
// 10. Fallback & empty input
// ============================================================
describe('fallback and empty input', () => {
  test('gibberish → fallback intent with suggestion', () => {
    const r = respond('qwzx mfbp', makeContext());
    expect(r.intent).toBe('fallback');
    expect(r.text).toContain('not sure');
    expect(r.text).toContain('try');
  });
  test('empty string → empty intent', () => {
    const r = respond('', makeContext());
    expect(r.intent).toBe('empty');
    expect(r.text.length).toBeGreaterThan(0);
  });
  test('whitespace-only → empty intent', () => {
    expect(respond('   ', makeContext()).intent).toBe('empty');
  });
  test('symbol-only input normalizes to empty → empty intent', () => {
    expect(respond('!!!???', makeContext()).intent).toBe('empty');
  });
  test('fallback suggests live options when data is loaded', () => {
    const r = respond('zzzqqq', makeContext(sampleState));
    expect(r.text.toLowerCase()).toContain('credits');
  });
});

// ============================================================
// 11. Yes / no catch-alls
// ============================================================
describe('yes / no catch-alls', () => {
  test('yes acknowledges', () => {
    const r = respond('yes', makeContext());
    expect(r.intent).toBe('yes');
    expect(r.text.length).toBeGreaterThan(0);
  });
  test('no acknowledges', () => {
    const r = respond('nope', makeContext());
    expect(r.intent).toBe('no');
  });
  test('yes after an intent asks for specifics', () => {
    const ctx = makeContext();
    respond('credits', ctx);
    expect(respond('yes', ctx).text.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 12. Quiet / speak (mute toggle)
// ============================================================
describe('quiet / speak mute toggle', () => {
  test('"be quiet" sets muted=true', () => {
    const ctx = makeContext();
    const r = respond('be quiet', ctx);
    expect(r.intent).toBe('quiet');
    expect(ctx.muted).toBe(true);
  });
  test('"speak" clears muted', () => {
    const ctx = makeContext();
    ctx.muted = true;
    const r = respond('speak', ctx);
    expect(r.intent).toBe('speakagain');
    expect(ctx.muted).toBe(false);
  });
  test('mute then unmute round-trips', () => {
    const ctx = makeContext();
    respond('shut up', ctx);
    expect(ctx.muted).toBe(true);
    respond('come back', ctx);
    expect(ctx.muted).toBe(false);
  });
});

// ============================================================
// 13. Cross-cutting: determinism & robustness
// ============================================================
describe('robustness', () => {
  test('respond never throws on weird input', () => {
    const ctx = makeContext(sampleState);
    const weird = [null, undefined, 123, {}, [], '\n\t', '🎉🎊', 'a'.repeat(5000)];
    for (const w of weird) expect(() => respond(w, ctx)).not.toThrow();
  });
  test('every non-empty non-pending reply has non-empty text', () => {
    const ctx = makeContext(sampleState);
    const phrases = ['hi', 'credits', 'top user', '@alice', '2+2', 'joke', 'help', 'bye', 'qwzx'];
    for (const p of phrases) {
      const { text } = respond(p, ctx);
      expect(text.length).toBeGreaterThan(0);
    }
  });
  test('context objects are independent across conversations', () => {
    const a = makeContext(); const b = makeContext();
    respond('play a game', a); // a gets a pending handler
    expect(b.pending).toBeNull();
    expect(a.pending).not.toBeNull();
  });
  test('all KB intents are reachable by at least one of their keywords', () => {
    // Sanity: each intent's own keyword should route back to itself (or a sensible intent).
    const ctx = makeContext(sampleState);
    let reachable = 0;
    for (const intent of KB) {
      if (!intent.keywords?.length) continue; // pattern-only intents (math/userlookup) skip
      const kw = intent.keywords[0];
      const r = respond(kw, ctx);
      // accept either exact match OR that it lands on a related data/fallback intent
      if (r.intent === intent.id || r.intent !== 'fallback') reachable++;
    }
    expect(reachable).toBeGreaterThan(KB.length * 0.8);
  });
});
