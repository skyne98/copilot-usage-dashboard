// ============================================================
// clippy-lfm.js — experimental: run LFM2.5-350M-ONNX fully
// in-browser, and stream its replies through Clippy's chat.
//
// No server, no API calls — the model weights load from
// HuggingFace and inference runs locally (WebGPU if available,
// else WASM/CPU). Falls back to the rule-based chatbot if the
// browser can't run the model.
//
// Uses Transformers.js v4.2.0 (the first release with a native
// `Lfm2ForCausalLM` model class) and its high-level `pipeline`
// API, which handles model data fetching + execution-provider
// selection automatically.
//
// Variant selection (verified in-browser):
//   • WebGPU → q4   (~276MB, GatherBlockQuantized embedding — WebGPU only)
//   • WASM   → fp16 (~725MB, plain FP16 Gather — the only variant the
//                    WASM EP can run; q4/q8/q4f32 all use GatherBlockQuantized,
//                    which has no WASM implementation)
// ============================================================

import { clippySpeak } from './clippy.js';

// Pinned: v4.2.0 is the first release shipping the Lfm2 model class.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
// onnx-community packages the ONNX exports for Transformers.js.
const MODEL_ID = 'onnx-community/LFM2.5-350M-ONNX';

// Generation parameters (from the model card's generation_config).
const GEN_OPTIONS = { do_sample: true, temperature: 0.1, top_k: 50, repetition_penalty: 1.05 };
const MAX_NEW_TOKENS = 96;

// Strong grounding for the tiny 350M model: it's Clippy, it knows THIS dashboard,
// and it should be brief. Small models wander without a firm system prompt.
const SYSTEM_PROMPT =
  'You are Clippy, a cheerful paperclip assistant for a GitHub Copilot usage dashboard. ' +
  'Answer briefly and helpfully about AI credits, agent sessions, and team usage. ' +
  'Keep replies to one or two sentences.';

let pipelineFn = null;     // the transformers.js generator
let TextStreamer = null;
let loading = null;         // shared loading promise
let loadStatus = 'idle';   // 'idle' | 'loading' | 'ready' | 'error'
let statusMsg = '';
let backend = null;        // 'webgpu' | 'wasm'

// ---------- capability check ----------
// WASM runs in every modern browser; WebGPU is a faster bonus.
export function lfmSupported() { return typeof WebAssembly !== 'undefined'; }

export function lfmStatus() {
  return { supported: lfmSupported(), status: loadStatus, msg: statusMsg, backend };
}

// Pick the best backend + the variant that runs on it.
async function pickBackend() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try { if (await navigator.gpu.requestAdapter()) return { name: 'webgpu', dtype: 'q4' }; } catch { /* fall through */ }
  }
  return { name: 'wasm', dtype: 'fp16' };
}

// ---------- load the model ----------
export async function loadLFM({ onProgress } = {}) {
  if (pipelineFn) return pipelineFn;
  if (loading) return loading;
  loading = (async () => {
    loadStatus = 'loading'; statusMsg = 'Picking backend…';
    onProgress?.(statusMsg);
    if (!lfmSupported()) {
      loadStatus = 'error'; statusMsg = 'WebAssembly unavailable — cannot run the model.';
      onProgress?.(statusMsg); loading = null;
      throw new Error(statusMsg);
    }
    const { name: backendName, dtype } = await pickBackend();
    backend = backendName;
    const sizeHint = backend === 'webgpu' ? '~276MB' : '~725MB';

    try {
      statusMsg = `Loading Transformers.js (${backend})…`; onProgress?.(statusMsg);
      const mod = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      TextStreamer = mod.TextStreamer;

      statusMsg = `Loading model (${sizeHint}, ${dtype}, first run downloads it)…`; onProgress?.(statusMsg);
      pipelineFn = await mod.pipeline('text-generation', MODEL_ID, {
        dtype, device: backend,
        progress_callback: p => {
          if (p.status === 'progress' && p.file?.includes('_data')) {
            const pct = Math.round(p.progress || 0);
            statusMsg = `Downloading model ${sizeHint}… ${pct}%`;
            onProgress?.(statusMsg);
          }
        },
      });

      loadStatus = 'ready'; statusMsg = `LFM2.5 ready — AI mode on (${backend}/${dtype}).`;
      onProgress?.(statusMsg);
      return pipelineFn;
    } catch (e) {
      loadStatus = 'error'; statusMsg = `Load failed: ${e.message}`;
      onProgress?.(statusMsg); loading = null;
      throw e;
    }
  })();
  return loading;
}

// ---------- generate + stream ----------
// Streams decoded text chunk-by-chunk to onToken(delta, full). Returns the full text.
export async function lfmGenerate(messages, { onToken, onDone } = {}) {
  if (!pipelineFn) throw new Error('LFM not loaded — call loadLFM() first');
  const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  let full = '';
  // TextStreamer calls back per decoded token-chunk; we emit the cumulative text.
  const streamer = new TextStreamer(pipelineFn.tokenizer, {
    skip_prompt: true,
    callback_function: (chunk) => {
      full += chunk;
      onToken?.(chunk, full);
    },
  });
  const output = await pipelineFn(fullMessages, { ...GEN_OPTIONS, max_new_tokens: MAX_NEW_TOKENS, streamer });
  // Fall back to the returned object if the streamer didn't fire (some paths).
  if (!full) {
    const last = output?.[0]?.generated_text?.at?.(-1);
    full = last?.content ?? (typeof last === 'string' ? last : '') ?? '';
    onToken?.(full, full);
  }
  onDone?.(full);
  return full;
}

// ---------- Clippy integration ----------
// Generate a reply and speak it through Clippy. Refreshes the balloon as tokens stream.
export async function clippyAskLFM(userMessage, { onToken } = {}) {
  if (loadStatus !== 'ready') return null;
  try {
    let spoken = '';
    await lfmGenerate([{ role: 'user', content: userMessage }], {
      onToken: (delta, full) => {
        spoken = full;
        onToken?.(delta, full);
        // Refresh Clippy's balloon periodically (not every token — DOM thrash).
        if (spoken.length % 16 < delta.length) clippySpeak(spoken);
      },
      onDone: (full) => { if (full) clippySpeak(full); },
    });
    return spoken;
  } catch (e) {
    console.warn('[lfm] generation failed:', e);
    return null;
  }
}
