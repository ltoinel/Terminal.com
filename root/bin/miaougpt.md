---
name: miaougpt
desc: chat with a local AI cat (WebGPU, fully in-browser) — e.g. miaougpt
alias: chat
man: |
  # MIAOUGPT(1)

  ## NAME
  miaougpt — a chat assistant powered by an LLM that runs entirely in your
  browser

  ## SYNOPSIS
  miaougpt
  miaougpt <model-id>

  ## DESCRIPTION
  miaougpt is a simple chat: you type, the (feline) assistant replies, streamed
  token by token. The model runs fully client-side via WebGPU — no server, no
  network call for inference.

  Model loading, its cache and GPU memory are handled by the central LLM module
  (see the `llm` command and the top-right widget, which shows the loaded model
  and the tokens consumed). By default no model is loaded: on first launch
  miaougpt proposes a model and asks you to **confirm** its download.

  With no argument, miaougpt proposes a small default chat model. You can also
  name a specific model (full id or a unique substring); `llm --list` shows the
  recommended models.

  If a model is already loaded (by `llm`, `glaude` or `denree`), miaougpt reuses
  it instantly, with no re-download.

  ## CHAT COMMANDS
  /exit /quit /bye  close the chat
  /reset /clear     forget the context (keep the model)
  /model            show the loaded model
  /voice [on|off]   read replies aloud (Web Speech API)
  /voice <lang>     read aloud in a language, e.g. /voice fr-FR
  /help             list these commands

  ## EXAMPLES
  miaougpt
  miaougpt Qwen2.5-1.5B
  miaougpt Llama-3.2-3B-Instruct

  ## SEE ALSO
  llm, glaude, denree
js: |
  // miaougpt — pure chat on top of the central LLM module (ctx.llm). All the
  // loading/consent/cache lives in src/lib/llm.ts; this command just proposes a
  // model, asks for confirmation, then streams the conversation. Token counting
  // and the widget are handled by the manager.
  const E = ctx.escape;
  const args = ctx.args.slice();
  const first = args[0];

  // Default chat model (proposed when nothing is already loaded).
  const DEFAULT = { base: 'Qwen2.5-1.5B-Instruct', label: 'Qwen2.5 1.5B', gb: 1.0 };

  // Scroll anchor to stay pinned to the bottom while streaming.
  const anchor = ctx.append('<div class="ln comment">miaougpt — local AI chat (WebGPU)</div>');
  const scroller = anchor.closest('.ssh-body');
  const toBottom = () => { if (scroller) scroller.scrollTop = scroller.scrollHeight; };

  // ---- make sure a model is loaded (consent via ctx.llm.ensure) ----
  let session;
  try {
    if (first && !first.startsWith('-')) {
      // A specific model was requested (id or substring).
      session = await ctx.llm.ensure({ base: first, label: first, reason: 'chat with miaougpt' });
    } else {
      // Reuse the already-loaded model, otherwise propose the default.
      const st = ctx.llm.state();
      if (st && st.modelId) session = { modelId: st.modelId, label: st.label };
      else session = await ctx.llm.ensure({ base: DEFAULT.base, label: DEFAULT.label, gb: DEFAULT.gb, reason: 'chat with miaougpt' });
    }
  } catch (e) {
    ctx.error('miaougpt: ' + ((e && (e.message || e.name)) || e));
    ctx.line('miaougpt needs WebGPU (Chrome/Edge ≥ 113 or Safari 18+).');
    return;
  }
  if (!session) { ctx.line('miaougpt: cancelled — no model loaded.'); return; }

  // ---- chat session ----
  ctx.line('');
  ctx.append('<div class="ln"><span class="accent text-glow">🐱 miaougpt ready</span> <span class="comment">— ' + E(session.label || session.modelId) + '</span></div>');
  ctx.line('Type a message and press Enter. Commands: /exit · /reset · /model · /voice · /help');
  ctx.line('');

  const SYSTEM = {
    role: 'system',
    content:
      'You are miaougpt, a friendly and concise chat assistant with a cat ' +
      'personality (you slip in the occasional quiet "meow"). You run entirely ' +
      'in the user\'s browser via WebLLM, with no server. Reply in the user\'s ' +
      'language, helpfully and naturally.',
  };
  let messages = [SYSTEM];

  // ---- voice (Web Speech API, optional) ----
  const tts = ('speechSynthesis' in window) ? window.speechSynthesis : null;
  let voice = false;
  let voiceLang = '';
  const speak = (text) => {
    if (!tts || !text || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    if (voiceLang) u.lang = voiceLang;
    try { tts.speak(u); } catch (e) { /* ignore */ }
  };
  const stopSpeaking = () => { if (tts) { try { tts.cancel(); } catch (e) { /* ignore */ } } };

  // Ctrl+C interrupts the running generation and closes the session.
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => { ctx.llm.interrupt(); stopSpeaking(); }, { once: true });
  }

  while (true) {
    if (ctx.signal && ctx.signal.aborted) break;
    const raw = await ctx.ask('you›');
    const q = (raw || '').trim();
    if (!q) continue;

    ctx.append('<div class="ln"><span class="prompt">you›</span> <span class="cmd">' + E(q) + '</span></div>');

    const low = q.toLowerCase();
    if (low === '/exit' || low === '/quit' || low === '/bye') { stopSpeaking(); ctx.line('see you 🐾'); break; }
    if (low === '/help') { ctx.line('/exit  quit · /reset  forget context · /model · /voice  read aloud'); continue; }
    if (low === '/model') { ctx.line('model: ' + (session.label || session.modelId)); continue; }
    if (low === '/reset' || low === '/clear') { messages = [SYSTEM]; stopSpeaking(); ctx.line('context cleared.'); continue; }
    if (low === '/voice' || low.startsWith('/voice ')) {
      if (!tts) { ctx.error('voice: speech synthesis is not available in this browser.'); continue; }
      const arg = (q.split(/\s+/)[1] || '').toLowerCase();
      if (arg === 'off' || (arg === '' && voice)) { voice = false; stopSpeaking(); ctx.line('voice: off'); }
      else if (arg === 'on' || arg === '') { voice = true; ctx.line('voice: on' + (voiceLang ? ' (' + voiceLang + ')' : '')); }
      else if (/^[a-z]{2}(-[a-z]{2})?$/.test(arg)) { voiceLang = arg; voice = true; ctx.line('voice: on (' + voiceLang + ')'); }
      else { ctx.line('usage: /voice [on|off|<lang>]   e.g. /voice fr-FR'); }
      continue;
    }

    messages.push({ role: 'user', content: q });

    // Stream the reply into a single growing line (textContent — never HTML).
    const row = ctx.append('<div class="ln out" style="white-space:pre-wrap"><span class="accent">🐱› </span><span class="reply comment">…</span></div>');
    const replyEl = row.querySelector('.reply');
    let spoken = 0;
    const flushSpeech = (full, force) => {
      if (!voice || !tts) return;
      const rest = full.slice(spoken);
      if (force) { if (rest.trim()) { speak(rest); spoken = full.length; } return; }
      const m = rest.match(/^[\s\S]*[.!?…\n]/);
      if (m) { speak(m[0]); spoken += m[0].length; }
    };

    let result;
    try {
      result = await ctx.llm.chat({
        messages,
        stream: true,
        signal: ctx.signal,
        onToken: (delta, full) => {
          replyEl.classList.remove('comment');
          replyEl.textContent = full;
          flushSpeech(full, false);
          toBottom();
        },
      });
    } catch (e) {
      if (!(ctx.signal && ctx.signal.aborted)) ctx.error('miaougpt: generation failed — ' + (e.message || e.name));
    }

    const reply = (result && result.content) || replyEl.textContent || '';
    if (!(ctx.signal && ctx.signal.aborted)) flushSpeech(reply, true);
    if (!reply) replyEl.textContent = '(no reply)';
    messages.push({ role: 'assistant', content: reply });

    spoken = 0;
    if (result && result.usage && typeof result.usage.tokPerSec === 'number') {
      ctx.append('<div class="ln comment">' + E(result.usage.completionTokens + ' tokens · ' + result.usage.tokPerSec.toFixed(1) + ' tok/s') + '</div>');
    }

    if (ctx.signal && ctx.signal.aborted) break;
  }

  ctx.line('miaougpt: chat closed (the model stays loaded — `llm --unload` to free it).');
---
