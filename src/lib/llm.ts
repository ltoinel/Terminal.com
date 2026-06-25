/**
 * Central in-browser LLM manager — the SINGLE owner of the WebLLM engine.
 *
 * Every command that needs a local model (miaougpt, glaude, denree) goes through
 * here: this module is the only place that downloads weights, holds the resident
 * engine, runs generations and tallies tokens. Commands never touch the engine
 * directly — they call `ctx.llm` (terminal.ts), which wraps this manager and
 * supplies the in-terminal consent prompt + progress bar.
 *
 * State (current model, in/out token totals, load progress) lives on a single
 * `globalThis` slot and is broadcast to subscribers — the top-right `LlmWidget`
 * renders from it. By default NO model is loaded; `ensureModel` asks for consent
 * before the first download.
 *
 * The engine module (`/vendor/web-llm-<version>.js`) is self-hosted and loaded
 * with a `@vite-ignore` dynamic import so Vite never bundles the 6 MB file.
 * UI strings here stay French (terminal-facing); code/comments are English.
 */

export const WEBLLM_VERSION = '0.2.84';
const WEBLLM_URL = `/vendor/web-llm-${WEBLLM_VERSION}.js`;

/** A curated, browser-friendly chat model. `base` is the id up to the quant suffix. */
export interface RecModel {
  label: string;
  base: string;
  /** Rough download size (GB) for the q4f16 / q4f32 builds. */
  gb16: number;
  gb32: number;
}

/** Recommended chat models, smallest first (shared by `llm --list` and miaougpt). */
export const RECOMMENDED: RecModel[] = [
  { label: 'Qwen2.5 0.5B', base: 'Qwen2.5-0.5B-Instruct', gb16: 0.45, gb32: 0.95 },
  { label: 'Llama 3.2 1B', base: 'Llama-3.2-1B-Instruct', gb16: 0.7, gb32: 1.4 },
  { label: 'Qwen2.5 1.5B', base: 'Qwen2.5-1.5B-Instruct', gb16: 1.0, gb32: 1.9 },
  { label: 'SmolLM2 1.7B', base: 'SmolLM2-1.7B-Instruct', gb16: 1.1, gb32: 2.0 },
  { label: 'Gemma 2 2B', base: 'gemma-2-2b-it', gb16: 1.5, gb32: 2.8 },
  { label: 'Llama 3.2 3B', base: 'Llama-3.2-3B-Instruct', gb16: 1.8, gb32: 3.3 },
  { label: 'Phi-3.5 mini', base: 'Phi-3.5-mini-instruct', gb16: 2.1, gb32: 3.7 },
];

/* ------------------------------- types ------------------------------- */

/** Minimal OpenAI-style chat completion response (streamed or whole). */
interface ChatResponse {
  choices?: { message?: { content?: string }; delta?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    extra?: { decode_tokens_per_s?: number };
  };
}

/** The bits of a WebLLM engine instance the manager uses. */
interface Engine {
  chat: {
    completions: { create: (req: object) => Promise<ChatResponse | AsyncIterable<ChatResponse>> };
  };
  interruptGenerate?: () => void;
  unload: () => Promise<void>;
}

/** Minimal shape of the self-hosted WebLLM module (`/vendor/web-llm-*.js`). */
interface WebllmModule {
  prebuiltAppConfig?: { model_list?: { model_id: string }[] };
  CreateMLCEngine: (
    model: string,
    opts: { initProgressCallback?: (r: { progress?: number; text?: string }) => void },
  ) => Promise<Engine>;
  hasModelInCache?: (id: string, cfg: unknown) => Promise<boolean>;
  deleteModelAllInfoInCache?: (id: string, cfg: unknown) => Promise<void>;
}

/** Public snapshot of the manager state — what the widget renders. */
export interface LlmState {
  modelId: string | null;
  label: string | null;
  loading: boolean;
  progress: number;
  progressText: string;
  tokensIn: number;
  tokensOut: number;
  version: string;
}

/** A confirmation the manager asks before downloading/loading a model. */
export interface ConsentInfo {
  modelId: string;
  label: string;
  gb: number | null;
  reason?: string;
}

/** Options for `ensureModel`. */
export interface EnsureOptions {
  /** A concrete model id (takes priority over `base`). */
  model?: string;
  /** A base name resolved to the q4f16/q4f32 build for this GPU. */
  base?: string;
  /** Human label for the consent prompt and widget (defaults to the id/base). */
  label?: string;
  /** Rough download size in GB, shown in the consent prompt. */
  gb?: number;
  /** Why the command needs the model (shown to the user). */
  reason?: string;
  /** Consent gate — return true to load. Omitted ⇒ auto-accept (programmatic use). */
  confirm?: (info: ConsentInfo) => Promise<boolean> | boolean;
  /** Download-progress callback (the widget also updates on its own). */
  onProgress?: (p: { progress: number; text: string }) => void;
}

/** A loaded-model handle returned by `ensureModel`. */
export interface Session {
  modelId: string;
  label: string;
  chat: (req: ChatRequest) => Promise<ChatResult>;
}

/** A generation request routed through the manager (so tokens are counted). */
export interface ChatRequest {
  messages: { role: string; content: string }[];
  /** JSON Schema ⇒ grammar-constrained JSON output. */
  schema?: object;
  /** Stream tokens (default true). */
  stream?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  /** Called with each streamed delta when `stream` is true. */
  onToken?: (delta: string, full: string) => void;
}

/** Result of a generation. */
export interface ChatResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number; tokPerSec?: number } | null;
}

/* ------------------------------ the slot ----------------------------- */

interface Slot {
  engine: Engine | null;
  modelId: string | null;
  label: string | null;
  loading: boolean;
  progress: number;
  progressText: string;
  tokensIn: number;
  tokensOut: number;
  listeners: Set<(s: LlmState) => void>;
}

const G = globalThis as Record<string, unknown>;
const slot: Slot =
  (G.__ltshLLM as Slot) ||
  (G.__ltshLLM = {
    engine: null,
    modelId: null,
    label: null,
    loading: false,
    progress: 0,
    progressText: '',
    tokensIn: 0,
    tokensOut: 0,
    listeners: new Set(),
  });

/** Snapshot of the manager state. */
export function getLlmState(): LlmState {
  return {
    modelId: slot.modelId,
    label: slot.label,
    loading: slot.loading,
    progress: slot.progress,
    progressText: slot.progressText,
    tokensIn: slot.tokensIn,
    tokensOut: slot.tokensOut,
    version: WEBLLM_VERSION,
  };
}

/** Subscribe to state changes (the widget). Returns an unsubscribe function. */
export function subscribeLlm(fn: (s: LlmState) => void): () => void {
  slot.listeners.add(fn);
  fn(getLlmState());
  return () => slot.listeners.delete(fn);
}

function emit(): void {
  const s = getLlmState();
  slot.listeners.forEach((fn) => {
    try {
      fn(s);
    } catch {
      /* a bad listener must not break the engine */
    }
  });
}

/* --------------------------- engine plumbing -------------------------- */

let webllmMod: Promise<WebllmModule> | null = null;
function loadWebllm(): Promise<WebllmModule> {
  if (!webllmMod) webllmMod = import(/* @vite-ignore */ WEBLLM_URL) as Promise<WebllmModule>;
  return webllmMod;
}

/** True when the browser exposes WebGPU (quick gate; adapter checked in load). */
export function gpuAvailable(): boolean {
  return 'gpu' in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu;
}

/** The quantization this GPU can run (q4f16 needs the shader-f16 feature). */
async function gpuQuant(): Promise<'q4f16_1' | 'q4f32_1'> {
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter: () => Promise<{ features?: { has: (f: string) => boolean } } | null>;
        };
      }
    ).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    return adapter && adapter.features && adapter.features.has('shader-f16')
      ? 'q4f16_1'
      : 'q4f32_1';
  } catch {
    return 'q4f32_1';
  }
}

/** Resolve a model id or base name to a concrete id this GPU can load. */
async function resolveModelId(wl: WebllmModule, want: string): Promise<string> {
  const ids: string[] = (wl.prebuiltAppConfig?.model_list || []).map((m) => m.model_id);
  if (ids.includes(want)) return want;
  const quant = await gpuQuant();
  const exact = ids.find((id) => id.includes(`${want}-${quant}`));
  if (exact) return exact;
  const hits = ids.filter((id) => id.toLowerCase().includes(want.toLowerCase()));
  if (hits.length)
    return (
      hits.find((id) => id.includes(quant)) || hits.find((id) => id.includes('q4f32')) || hits[0]
    );
  throw new Error(`modèle introuvable : ${want}`);
}

/** Every known model id (no WebGPU needed). */
export async function llmModels(): Promise<string[]> {
  const wl = await loadWebllm();
  return (wl.prebuiltAppConfig?.model_list || []).map((m) => m.model_id);
}

/** The recommended list resolved to concrete ids + sizes for this GPU. */
export async function recommendedModels(): Promise<{ label: string; id: string; gb: number }[]> {
  const wl = await loadWebllm();
  const ids: string[] = (wl.prebuiltAppConfig?.model_list || []).map((m) => m.model_id);
  const quant = await gpuQuant();
  const f16 = quant === 'q4f16_1';
  const pick = (base: string): string | undefined => {
    const here = ids.find((id) => id.includes(`${base}-${quant}`));
    if (here) return here;
    if (f16) return ids.find((id) => id.includes(`${base}-q4f32_1`));
    return undefined;
  };
  return RECOMMENDED.map((r) => ({
    label: r.label,
    id: pick(r.base) as string,
    gb: f16 ? r.gb16 : r.gb32,
  })).filter((r) => r.id);
}

/* ----------------------------- cache ops ----------------------------- */

/** Model ids currently stored in the browser cache. */
export async function cacheList(): Promise<string[]> {
  const wl = await loadWebllm();
  if (!wl.hasModelInCache) return [];
  const cfg = wl.prebuiltAppConfig;
  const ids: string[] = (cfg?.model_list || []).map((m) => m.model_id);
  const flags = await Promise.all(
    ids.map(async (id) => {
      try {
        return (await wl.hasModelInCache!(id, cfg)) ? id : null;
      } catch {
        return null;
      }
    }),
  );
  return flags.filter((x): x is string => !!x);
}

/** Resolve a cache id or unique substring; throws on ambiguity / no match. */
async function resolveCached(arg: string): Promise<string> {
  const cached = await cacheList();
  if (cached.includes(arg)) return arg;
  const hits = cached.filter((id) => id.toLowerCase().includes(arg.toLowerCase()));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1)
    throw new Error(`ambigu — ${hits.length} modèles correspondent à « ${arg} »`);
  throw new Error(`aucun modèle en cache ne correspond à « ${arg} »`);
}

/** Delete one cached model (id or unique substring). Returns the id removed. */
export async function cacheRemove(arg: string): Promise<string> {
  const wl = await loadWebllm();
  const id = await resolveCached(arg);
  if (slot.modelId === id) await unloadModel();
  if (wl.deleteModelAllInfoInCache) await wl.deleteModelAllInfoInCache(id, wl.prebuiltAppConfig);
  return id;
}

/** Delete every cached model. Returns how many were removed. */
export async function cacheRemoveAll(): Promise<number> {
  const wl = await loadWebllm();
  const cached = await cacheList();
  if (cached.length) await unloadModel();
  let n = 0;
  for (const id of cached) {
    try {
      if (wl.deleteModelAllInfoInCache)
        await wl.deleteModelAllInfoInCache(id, wl.prebuiltAppConfig);
      n++;
    } catch {
      /* skip a stubborn entry */
    }
  }
  return n;
}

/* ------------------------- load / unload / chat ---------------------- */

/** Frees the resident model from GPU memory. Returns true if one was loaded. */
export async function unloadModel(): Promise<boolean> {
  if (!slot.engine) return false;
  try {
    await slot.engine.unload();
  } catch {
    /* ignore */
  }
  slot.engine = null;
  slot.modelId = null;
  slot.label = null;
  slot.tokensIn = 0;
  slot.tokensOut = 0;
  slot.loading = false;
  slot.progress = 0;
  slot.progressText = '';
  emit();
  return true;
}

/**
 * Ensures a model is loaded, asking for consent before a fresh download/load.
 * Returns a session handle, or null when the user declines. Reusing the resident
 * model needs no consent.
 */
export async function ensureModel(opts: EnsureOptions): Promise<Session | null> {
  if (!gpuAvailable()) {
    throw new Error(
      'WebGPU indisponible — un navigateur compatible est requis (Chrome/Edge ≥ 113 ou Safari 18+).',
    );
  }
  const wl = await loadWebllm();
  const want = opts.model || opts.base;
  if (!want) throw new Error('ensureModel: aucun modèle demandé (model/base manquant).');
  const modelId = await resolveModelId(wl, want);
  const label = opts.label || modelId;

  // Already resident → reuse, no consent.
  if (slot.engine && slot.modelId === modelId) {
    return { modelId, label: slot.label || label, chat: llmChat };
  }

  // Consent before a (re)load. No confirm callback ⇒ programmatic auto-accept.
  const gb = opts.gb ?? null;
  const accepted = opts.confirm
    ? await opts.confirm({ modelId, label, gb, reason: opts.reason })
    : true;
  if (!accepted) return null;

  // Swap out any other resident model first.
  if (slot.engine) {
    try {
      await slot.engine.unload();
    } catch {
      /* ignore */
    }
    slot.engine = null;
    slot.modelId = null;
  }

  slot.loading = true;
  slot.progress = 0;
  slot.progressText = '';
  slot.label = label;
  slot.modelId = modelId;
  slot.tokensIn = 0;
  slot.tokensOut = 0;
  emit();

  try {
    const engine = await wl.CreateMLCEngine(modelId, {
      initProgressCallback: (r) => {
        slot.progress = r.progress || 0;
        slot.progressText = r.text || '';
        emit();
        opts.onProgress?.({ progress: slot.progress, text: slot.progressText });
      },
    });
    slot.engine = engine;
    slot.loading = false;
    slot.progress = 1;
    emit();
    return { modelId, label, chat: llmChat };
  } catch (e) {
    // Some GPUs advertise shader-f16 but fail to compile f16 shaders — retry q4f32.
    const msg = String((e as Error)?.message || e);
    const shaderIssue =
      /ShaderModule|shader-f16|f16|compute stage|createShaderModule|previous error/i.test(msg);
    const f32 = modelId.replace(/q4f16/g, 'q4f32');
    if (shaderIssue && /q4f16/.test(modelId) && f32 !== modelId) {
      try {
        const engine = await wl.CreateMLCEngine(f32, {
          initProgressCallback: (r) => {
            slot.progress = r.progress || 0;
            slot.progressText = r.text || '';
            emit();
            opts.onProgress?.({ progress: slot.progress, text: slot.progressText });
          },
        });
        slot.engine = engine;
        slot.modelId = f32;
        slot.loading = false;
        slot.progress = 1;
        emit();
        return { modelId: f32, label, chat: llmChat };
      } catch {
        /* fall through to the reset below */
      }
    }
    slot.loading = false;
    slot.modelId = null;
    slot.label = null;
    emit();
    throw e;
  }
}

/** Type guard: a streamed response is async-iterable. */
function isStream(x: ChatResponse | AsyncIterable<ChatResponse>): x is AsyncIterable<ChatResponse> {
  return typeof (x as AsyncIterable<ChatResponse>)[Symbol.asyncIterator] === 'function';
}

/** Runs a generation through the resident engine, tallying in/out tokens. */
export async function llmChat(req: ChatRequest): Promise<ChatResult> {
  if (!slot.engine) throw new Error("aucun modèle chargé — charge-en un d'abord.");
  const stream = req.stream !== false;
  const body: Record<string, unknown> = {
    messages: req.messages,
    temperature: req.temperature ?? (req.schema ? 0 : 0.7),
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (req.schema)
    body.response_format = { type: 'json_object', schema: JSON.stringify(req.schema) };

  let content = '';
  let usage: ChatResponse['usage'] | undefined;

  const res = await slot.engine.chat.completions.create(body);
  if (stream && isStream(res)) {
    for await (const chunk of res) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        content += delta;
        req.onToken?.(delta, content);
      }
      if (chunk.usage) usage = chunk.usage;
      if (req.signal?.aborted) break;
    }
  } else {
    const whole = res as ChatResponse;
    content = whole.choices?.[0]?.message?.content || '';
    usage = whole.usage;
  }

  let out: ChatResult['usage'] = null;
  if (usage) {
    slot.tokensIn += usage.prompt_tokens || 0;
    slot.tokensOut += usage.completion_tokens || 0;
    emit();
    out = {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      tokPerSec: usage.extra?.decode_tokens_per_s,
    };
  }
  return { content, usage: out };
}

/** Interrupts a running generation (Ctrl+C). */
export function interruptLlm(): void {
  try {
    slot.engine?.interruptGenerate?.();
  } catch {
    /* ignore */
  }
}
