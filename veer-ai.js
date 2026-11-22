#!/usr/bin/env node
// Veer AI v2 — OpenCode jaisa AI coding agent (Termux / Node 18+, koi dependency nahi)
// Chalao:  veer                (chat)          veer -c        (pichhli baat wapas)
//          veer run "..."      (ek kaam)       veer build     (APK banao, fail ho to AI fix kare)
//          veer models | login | config
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const cp = require('child_process');

const VERSION = '2.0.0';
const CFG_DIR = path.join(os.homedir(), '.veer-ai');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
const SESS_DIR = path.join(CFG_DIR, 'sessions');
const DEFAULTS = { baseURL: 'https://opencode.ai/zen/v1', apiKey: '', model: 'big-pickle', auto: false, buildCmd: './gradlew assembleDebug' };

// ─── Config ─────────────────────────────────────────────────────────
function loadCfg() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (_) {}
  const c = Object.assign({}, DEFAULTS, f);
  if (process.env.VEER_BASE_URL) c.baseURL = process.env.VEER_BASE_URL;
  if (process.env.VEER_API_KEY || process.env.OPENCODE_API_KEY) c.apiKey = process.env.VEER_API_KEY || process.env.OPENCODE_API_KEY;
  if (process.env.VEER_MODEL) c.model = process.env.VEER_MODEL;
  c.baseURL = c.baseURL.replace(/\/+$/, '');
  return c;
}
function saveCfg(patch) {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (_) {}
  Object.assign(f, patch);
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(f, null, 2), { mode: 0o600 });
}
let cfg = loadCfg();

// ─── Colours ────────────────────────────────────────────────────────
const tty = process.stdout.isTTY;
const col = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const dim = s => col(2, s), bold = s => col(1, s), red = s => col(31, s), green = s => col(32, s),
  yellow = s => col(33, s), cyan = s => col(36, s), purple = s => col(35, s);

// ─── Helpers ────────────────────────────────────────────────────────
const MAX_OUT = 30000;
const SKIP = new Set(['node_modules', '.git', 'build', '.gradle', '.idea']);
const clip = (s, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + `\n...[${s.length - n} akshar kaate gaye]` : s);
const abs = p => path.resolve(process.cwd(), String(p || '.').replace(/^~(?=$|\/)/, os.homedir()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inProject = p => { const r = path.relative(process.cwd(), p); return !r.startsWith('..') && !path.isAbsolute(r); };

function globToRe(g) {
  let r = '^';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') { if (g[i + 1] === '*') { r += '.*'; i++; if (g[i + 1] === '/') i++; } else r += '[^/]*'; }
    else if (ch === '?') r += '[^/]';
    else r += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(r + '$');
}
function walk(dir, base, out, limit) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const d of ents) {
    if (out.length >= limit) return;
    if (SKIP.has(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, base, out, limit); else out.push(path.relative(base, full));
  }
}
function htmlToText(h) {
  return h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

// ─── Undo (har turn ki file changes yaad rakho) ─────────────────────
const undoStack = [];
function snapshot(p) {
  const turn = undoStack[undoStack.length - 1];
  if (!turn || turn.some(s => s.p === p)) return;
  const existed = fs.existsSync(p);
  turn.push({ p, existed, data: existed ? fs.readFileSync(p) : null });
}
function undoLast() {
  while (undoStack.length && !undoStack[undoStack.length - 1].length) undoStack.pop();
  const turn = undoStack.pop();
  if (!turn) return console.log(yellow('Undo karne ko kuch nahi.'));
  for (const s of turn.reverse()) {
    try { if (s.existed) fs.writeFileSync(s.p, s.data); else fs.rmSync(s.p, { force: true }); console.log(green('  wapas: ') + s.p); }
    catch (e) { console.log(red('  fail: ' + s.p + ' — ' + e.message)); }
  }
}

// ─── Tools ──────────────────────────────────────────────────────────
const TOOLS = [
  { name: 'read_file', description: 'File padho (line numbers ke saath).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'Shuru ki line (1 se)' }, limit: { type: 'integer', description: 'Kitni lines' } }, required: ['path'] } },
  { name: 'write_file', description: 'Nayi file banao ya poori file overwrite karo. Folder khud ban jaate hain.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'File me old_string ko new_string se badlo. old_string file me ek hi baar aana chahiye (ya replace_all true do).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'] } },
  { name: 'list_dir', description: 'Folder ki files dikhao.',
    parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'glob', description: 'Naam se files dhundo, jaise "**/*.kt" ya "AndroidManifest.xml".',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'grep', description: 'Files ke andar text/regex dhundo (recursive).',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'web_fetch', description: 'Kisi webpage / docs ka text laao (sirf http/https).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'bash', description: 'Shell command chalao (Termux). Build, install, git, sab.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, timeout_seconds: { type: 'integer' } }, required: ['command'] } },
];
const NEEDS_OK = new Set(['write_file', 'edit_file', 'bash']);

async function runTool(name, a) {
  switch (name) {
    case 'read_file': {
      const p = abs(a.path);
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      const off = Math.max(1, a.offset || 1), lim = a.limit || 2000;
      const out = lines.slice(off - 1, off - 1 + lim).map((l, i) => `${String(off + i).padStart(5)}  ${l}`).join('\n');
      return clip(out || '(khali file)');
    }
    case 'write_file': {
      const p = abs(a.path);
      snapshot(p);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, a.content);
      return `Likh diya: ${p} (${a.content.split('\n').length} lines)`;
    }
    case 'edit_file': {
      const p = abs(a.path);
      const src = fs.readFileSync(p, 'utf8');
      if (!a.old_string) throw new Error('old_string khali hai');
      const n = src.split(a.old_string).length - 1;
      if (n === 0) throw new Error('old_string file me mila hi nahi. Pehle read_file se exact text dekho.');
      if (n > 1 && !a.replace_all) throw new Error(`old_string ${n} baar mila. Zyada context do ya replace_all=true.`);
      snapshot(p);
      fs.writeFileSync(p, a.replace_all ? src.split(a.old_string).join(a.new_string) : src.replace(a.old_string, () => a.new_string));
      return `Edit ho gaya: ${p} (${a.replace_all ? n : 1} jagah)`;
    }
    case 'list_dir': {
      const items = fs.readdirSync(abs(a.path), { withFileTypes: true })
        .filter(d => !SKIP.has(d.name)).map(d => (d.isDirectory() ? d.name + '/' : d.name)).sort();
      return items.join('\n') || '(khali folder)';
    }
    case 'glob': {
      const base = abs(a.path), all = [];
      walk(base, base, all, 20000);
      const re = globToRe(a.pattern), hasSlash = a.pattern.includes('/');
      const hit = all.filter(f => re.test(hasSlash ? f : path.basename(f))).sort();
      return hit.slice(0, 200).join('\n') + (hit.length > 200 ? `\n...[${hit.length - 200} aur]` : '') || 'Kuch nahi mila';
    }
    case 'grep': {
      const r = cp.spawnSync('grep', ['-rnIE', ...[...SKIP].map(d => '--exclude-dir=' + d), '-e', a.pattern, abs(a.path)],
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      if (r.error) throw r.error;
      return clip(r.stdout.trim() || 'Kuch nahi mila');
    }
    case 'web_fetch': {
      if (!/^https?:\/\//i.test(a.url)) throw new Error('Sirf http/https URL');
      const res = await fetch(a.url, { headers: { 'User-Agent': 'VeerAI/' + VERSION }, signal: AbortSignal.timeout(20000) });
      const t = await res.text();
      const ct = res.headers.get('content-type') || '';
      return clip(`[HTTP ${res.status}]\n` + (/html/i.test(ct) ? htmlToText(t) : t), 20000);
    }
    case 'bash': {
      const t = Math.min(Math.max(a.timeout_seconds || 120, 1), 900) * 1000;
      const r = cp.spawnSync('sh', ['-c', a.command], { cwd: process.cwd(), encoding: 'utf8', timeout: t, maxBuffer: 20 * 1024 * 1024 });
      let out = (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '');
      if (r.error && r.error.code === 'ETIMEDOUT') out += `\n[timeout: ${t / 1000}s me band kiya]`;
      return clip(out.trim() || '(koi output nahi)') + `\n[exit code: ${r.status}]`;
    }
    default: throw new Error('Unknown tool: ' + name);
  }
}

// ─── Model call (streaming, OpenAI-compatible, retry ke saath) ──────
async function chat(messages, signal, opt = {}) {
  const body = { model: cfg.model, messages, stream: true };
  if (!opt.noTools) body.tools = TOOLS.map(t => ({ type: 'function', function: t }));
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(cfg.baseURL + '/chat/completions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}) },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e.name === 'AbortError' || attempt >= 2) throw e;
      console.log(dim(`  net dikkat, dobara try (${attempt + 1}/2)...`)); await sleep(1500 * 2 ** attempt); continue;
    }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
      console.log(dim(`  server busy (${res.status}), dobara try (${attempt + 1}/2)...`)); await sleep(1500 * 2 ** attempt); continue;
    }
    break;
  }
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 400);
    let hint = '';
    if (res.status === 401 || res.status === 403) hint = '\n  → API key check karo: veer login';
    if (res.status === 404 || res.status === 400) hint = '\n  → Model naam galat ho sakta hai: veer models';
    if (res.status === 429) hint = '\n  → Limit lag gayi. Thoda ruko ya dusra model chuno: /models';
    throw new Error(`HTTP ${res.status}: ${txt}${hint}`);
  }
  let text = '', buf = '';
  const calls = [];
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch (_) { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (!d) continue;
      if (d.content) { text += d.content; if (!opt.quiet) process.stdout.write(d.content); }
      for (const tc of d.tool_calls || []) {
        const k = tc.index == null ? 0 : tc.index;
        const cur = calls[k] || (calls[k] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function && tc.function.name) cur.function.name += tc.function.name;
        if (tc.function && tc.function.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }
  if (text && !opt.quiet) process.stdout.write('\n');
  return { text, calls: calls.filter(Boolean).map((t, n) => ({ ...t, id: t.id || 'call_' + Date.now() + '_' + n })) };
}

// ─── Context: purane tool output chhote karo ────────────────────────
function trimOld(messages) {
  const idx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
  for (const i of idx.slice(0, -8)) {
    const m = messages[i];
    if (m.content.length > 1200) m.content = m.content.slice(0, 600) + '\n...[purana output chhota kiya]';
  }
}
const approxTokens = messages => Math.round(messages.reduce((n, m) => n + (m.content || '').length + JSON.stringify(m.tool_calls || '').length, 0) / 4);

// ─── Session ────────────────────────────────────────────────────────
const sessFile = () => path.join(SESS_DIR, crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12) + '.json');
function saveSession(messages) {
  try { fs.mkdirSync(SESS_DIR, { recursive: true }); fs.writeFileSync(sessFile(), JSON.stringify({ cwd: process.cwd(), messages }), { mode: 0o600 }); } catch (_) {}
}
function loadSession() {
  try { return JSON.parse(fs.readFileSync(sessFile(), 'utf8')).messages; } catch (_) { return null; }
}

// ─── Agent loop ─────────────────────────────────────────────────────
function systemPrompt() {
  let extra = '';
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    try { extra = `\n\nProject ke rules (${f}):\n` + fs.readFileSync(path.join(process.cwd(), f), 'utf8').slice(0, 8000); break; } catch (_) {}
  }
  return `Tum Veer AI ho — Android phone ke Termux me chalne wala coding agent (OpenCode jaisa).
Folder: ${process.cwd()}
Tools se kaam karo: pehle files padho/dhundo (glob, grep, read_file), phir edit/write karo, phir bash se chala ke check karo.
Chhote, seedhe jawab do. User jis bhasha me likhe (Hindi/Hinglish/English) usi me jawab do.
Android app: Kotlin + Gradle, build ./gradlew assembleDebug (gradlew na ho to 'addwrapper' chalao). APK: app/build/outputs/apk/debug/app-debug.apk
Termux me sudo/apt nahi, pkg install use hota hai. Naye bade dependency tabhi jodo jab zaroori ho.
Kuch na pata ho (library/API) to web_fetch se docs dekho, andaaza mat lagao.${extra}`;
}

let rl = null;
let child = null;
const ask = (q, dflt = 'n') => (rl && process.stdin.isTTY ? new Promise(r => rl.question(q, r)) : Promise.resolve(dflt));

function preview(name, a) {
  if (name === 'edit_file') {
    const cut = s => String(s).split('\n').slice(0, 6);
    cut(a.old_string).forEach(l => console.log(red('  - ' + l)));
    cut(a.new_string).forEach(l => console.log(green('  + ' + l)));
  } else if (name === 'write_file') {
    console.log(dim(`  ${fs.existsSync(abs(a.path)) ? 'overwrite' : 'nayi file'}, ${String(a.content).split('\n').length} lines`));
  }
}
async function approve(name, a) {
  if (cfg.auto) return true;
  const what = name === 'bash' ? a.command : a.path;
  const out = name !== 'bash' && !inProject(abs(a.path)) ? red(' (PROJECT KE BAHAR!)') : '';
  preview(name, a);
  const ans = (await ask(yellow(`  ${name}: `) + clip(String(what), 300) + out + dim('  [Enter=haan, n=nahi, a=sab auto] '))).trim().toLowerCase();
  if (ans === 'a') { cfg.auto = true; console.log(dim('  auto mode ON (band: /auto)')); return true; }
  return ans === '' || ans === 'y' || ans === 'h' || ans === 'yes';
}

let abortCtl = null;
async function turn(messages, userText) {
  messages.push({ role: 'user', content: userText });
  undoStack.push([]);
  abortCtl = new AbortController();
  try {
    for (let step = 0; step < 40; step++) {
      trimOld(messages);
      const { text, calls } = await chat(messages, abortCtl.signal);
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      messages.push(msg);
      if (!calls.length) return saveSession(messages);
      for (const tc of calls) {
        const name = tc.function.name;
        let args = {}, result;
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { result = 'Error: tool arguments valid JSON nahi the'; }
        const label = name === 'bash' ? args.command : (args.path || args.pattern || args.url || '');
        console.log(cyan('▸ ' + name) + ' ' + dim(clip(String(label || ''), 120)));
        if (result === undefined) {
          if (NEEDS_OK.has(name) && !(await approve(name, args))) result = 'User ne mana kar diya. Dusra tareeka socho ya poochho.';
          else { try { result = await runTool(name, args); } catch (e) { result = 'Error: ' + e.message; } }
        }
        if (/^Error/.test(result)) console.log(red('  ' + result.split('\n')[0]));
        else console.log(dim('  ' + result.split('\n')[0].slice(0, 100)));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
    console.log(yellow('40 step ho gaye, ruk raha hoon. "continue" likho agar aage badhana hai.'));
    saveSession(messages);
  } catch (e) {
    if (e.name === 'AbortError') console.log(yellow('\n⏹ Roka gaya.'));
    else console.log(red('\n✗ ' + e.message + (e.cause && e.cause.code ? ' (' + e.cause.code + ') — internet check karo' : '')));
    // adhoora turn history se hata do taaki agli baar API na toote
    while (messages.length && messages[messages.length - 1].role !== 'user') messages.pop();
    if (messages.length) messages.pop();
  } finally { abortCtl = null; }
}

// ─── @file mentions ─────────────────────────────────────────────────
function expandMentions(text) {
  const added = [];
  for (const m of text.matchAll(/(?:^|\s)@([\w./\-]+)/g)) {
    const p = abs(m[1]);
    try {
      if (fs.statSync(p).isFile() && !added.includes(p)) added.push(p);
    } catch (_) {}
  }
  if (!added.length) return text;
  return text + added.map(p => `\n\n[file: ${path.relative(process.cwd(), p)}]\n\`\`\`\n${clip(fs.readFileSync(p, 'utf8'), 20000)}\n\`\`\``).join('');
}

// ─── /build ─────────────────────────────────────────────────────────
function findApk() {
  const dir = path.join(process.cwd(), 'app/build/outputs/apk/debug');
  try { const f = fs.readdirSync(dir).find(n => n.endsWith('.apk')); return f ? path.join(dir, f) : null; } catch (_) { return null; }
}
async function build(messages) {
  const cmd = cfg.buildCmd;
  if (cmd.startsWith('./gradlew') && !fs.existsSync(path.join(process.cwd(), 'gradlew'))) {
    return console.log(red('gradlew nahi mila. Project folder me jao ya pehle chalao: addwrapper'));
  }
  console.log(cyan('▸ build: ') + cmd + dim('  (pehli baar 3-5 min lagte hain)'));
  let tail = '';
  const code = await new Promise(res => {
    child = cp.spawn('sh', ['-c', cmd], { cwd: process.cwd() });
    const on = d => { const s = d.toString(); process.stdout.write(dim(s)); tail = (tail + s).slice(-6000); };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('close', c => { child = null; res(c); });
    child.on('error', e => { child = null; tail += e.message; res(1); });
  });
  if (code === 0) {
    const apk = findApk();
    if (!apk) return console.log(green('✓ Build ho gaya') + dim(' (APK file nahi mili, build.gradle check karo)'));
    console.log(green('✓ APK bana: ') + apk);
    try {
      const out = '/sdcard/Download/' + path.basename(process.cwd()) + '-debug.apk';
      fs.copyFileSync(apk, out); console.log(green('✓ Copy: ') + out + dim('  → Files app se install karo'));
    } catch (_) { console.log(dim('  (/sdcard me copy nahi hua — termux-setup-storage chalao)')); }
    return;
  }
  console.log(red(`✗ Build fail (code ${code})`));
  const a = cfg.auto ? 'y' : (await ask('AI se fix karwao? [Enter=haan, n=nahi] ', 'n')).trim().toLowerCase();
  if (a === '' || a === 'y' || a === 'h') {
    await turn(messages, `${cmd} fail hua. Aakhri output:\n${tail}\n\nError dhundo, code theek karo, phir bash me "${cmd}" chala ke check karo ki ban raha hai.`);
  }
}

// ─── Commands ───────────────────────────────────────────────────────
async function fetchModels() {
  const res = await fetch(cfg.baseURL + '/models', { headers: cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status} (models list nahi mili)`);
  const j = await res.json();
  return (j.data || j.models || []).map(m => m.id || m).filter(Boolean).sort();
}
async function pickModel() {
  const ids = await fetchModels();
  ids.forEach((id, i) => console.log(`${String(i + 1).padStart(3)}. ${id}${/free|big-pickle/.test(id) ? green('  (free)') : ''}`));
  const a = (await ask('Number ya naam (Enter = wahi rahe): ', '')).trim();
  if (!a) return;
  const m = /^\d+$/.test(a) ? ids[+a - 1] : a;
  if (!m) return console.log(red('Galat number'));
  cfg.model = m; saveCfg({ model: m });
  console.log(green('Model: ' + m));
}

function userName() {
  for (const f of ['.veer_name', '.hunter_name']) { try { return fs.readFileSync(path.join(os.homedir(), f), 'utf8').trim() || 'Veer'; } catch (_) {} }
  return 'Veer';
}
function banner(resumed) {
  console.log('\n' + purple(bold(` ◆ Veer AI v${VERSION}`)) + dim(`  — ${userName()} ka coding agent`));
  console.log(dim(` model: ${cfg.model}  |  ${process.cwd()}`));
  console.log(dim(resumed ? ` pichhli baat wapas (${resumed} messages). Nayi: /clear` : ' /help likho. Ctrl+C = roko.') + '\n');
  if (!cfg.apiKey) console.log(yellow(' ⚠ API key set nahi. Free model ke liye bhi chahiye ho sakti hai: veer login\n'));
}
const HELP = `Commands:
  /build         APK banao (fail ho to AI se fix karwao) → Download me copy
  /undo          AI ne jo files badli, pichhla turn wapas karo
  /init          AGENTS.md banwao (project ke rules)
  /compact       lambi baat ka summary (context bachao)
  /context       kitna context bhar gaya
  /models        model list dekho aur chuno
  /model <naam>  seedha model badlo
  /auto          har tool ko bina poochhe chalao (on/off)
  /clear         nayi baat shuru
  /key           API key badlo
  /exit          band
Tips: @file.kt likho to wo file AI ko saath me mil jaati hai.
      Lambi line ke liye line ke aakhir me \\ lagao.
      AGENTS.md project folder me rakho — Veer AI use padhta hai.`;

async function slash(line, messages) {
  const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ');
  if (cmd === 'help') console.log(HELP);
  else if (cmd === 'exit' || cmd === 'quit') process.exit(0);
  else if (cmd === 'clear') { messages.length = 1; undoStack.length = 0; saveSession(messages); console.log(dim('Saaf.')); }
  else if (cmd === 'auto') { cfg.auto = !cfg.auto; console.log('auto: ' + (cfg.auto ? green('ON') : 'off')); }
  else if (cmd === 'undo') undoLast();
  else if (cmd === 'build' || cmd === 'apk') await build(messages);
  else if (cmd === 'init') await turn(messages, 'Is project ko dekho (files padho) aur AGENTS.md banao: structure, build/run commands, coding rules. Chhota aur kaam ka rakho.');
  else if (cmd === 'context') console.log(`${messages.length - 1} messages, lagbhag ${approxTokens(messages)} tokens`);
  else if (cmd === 'compact') await compact(messages);
  else if (cmd === 'model' && arg) { cfg.model = arg; saveCfg({ model: arg }); console.log(green('Model: ' + arg)); }
  else if (cmd === 'model' || cmd === 'models') { try { await pickModel(); } catch (e) { console.log(red(e.message)); } }
  else if (cmd === 'key') await login();
  else console.log(red('Pata nahi: /' + cmd) + '  — /help');
}

async function compact(messages) {
  if (messages.length < 4) return console.log(dim('Abhi chhota hai, compact ki zaroorat nahi.'));
  abortCtl = new AbortController();
  try {
    const before = approxTokens(messages);
    const { text } = await chat([...messages, { role: 'user', content: 'Ab tak ki poori baat ka chhota summary likho: user ne kya maanga, kaun si files banee/badli, kya ho chuka, kya baaki hai. Tool mat chalao.' }],
      abortCtl.signal, { noTools: true, quiet: true });
    if (!text) return console.log(red('Summary nahi mila.'));
    messages.length = 1;
    messages.push({ role: 'user', content: 'Pichhli baat ka summary:\n' + text }, { role: 'assistant', content: 'Samajh gaya, aage badhte hain.' });
    saveSession(messages);
    console.log(green(`✓ Compact: ~${before} → ~${approxTokens(messages)} tokens`));
  } catch (e) { console.log(red('✗ ' + e.message)); }
  finally { abortCtl = null; }
}

async function login() {
  const k = (await ask('API key paste karo (opencode.ai/auth se): ', '')).trim();
  if (k) { cfg.apiKey = k; saveCfg({ apiKey: k }); console.log(green('Key save ho gayi.')); }
}

async function main() {
  const argv = process.argv.slice(2), rest = [];
  let cont = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') cfg.auto = true;
    else if (a === '--continue' || a === '-c') cont = true;
    else if (a === '--model' || a === '-m') cfg.model = argv[++i] || cfg.model;
    else rest.push(a);
  }
  if (rest[0] === '-v' || rest[0] === '--version') return console.log(VERSION);
  if (rest[0] === 'config') return console.log(JSON.stringify({ ...cfg, apiKey: cfg.apiKey ? '***' : '' }, null, 2) + '\nfile: ' + CFG_FILE);

  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  rl.on('SIGINT', () => { if (abortCtl) abortCtl.abort(); else if (child) child.kill('SIGINT'); else { console.log(); process.exit(0); } });

  if (rest[0] === 'login') { await login(); return rl.close(); }
  if (rest[0] === 'models') { try { await pickModel(); } catch (e) { console.log(red(e.message)); } return rl.close(); }

  let messages = [{ role: 'system', content: systemPrompt() }];
  let resumed = 0;
  if (cont) {
    const old = loadSession();
    if (old && old.length > 1) { messages = old; messages[0] = { role: 'system', content: systemPrompt() }; resumed = old.length - 1; }
  }
  if (rest[0] === 'build') { await build(messages); return rl.close(); }
  if (rest[0] === 'run') {
    const prompt = rest.slice(1).join(' ').trim();
    if (!prompt) { console.log('Use: veer run "kya karna hai"'); return rl.close(); }
    await turn(messages, expandMentions(prompt));
    return rl.close();
  }

  banner(resumed);
  const PROMPT = purple('❯ ');
  rl.setPrompt(PROMPT);
  const queue = [];
  let busy = false, pending = '';
  const drain = async () => {
    if (busy) return; busy = true;
    while (queue.length) {
      const line = queue.shift().trim();
      if (!line) continue;
      if (line.startsWith('/')) await slash(line, messages); else await turn(messages, expandMentions(line));
    }
    busy = false; rl.setPrompt(PROMPT); rl.prompt();
  };
  rl.on('line', l => {
    if (l.endsWith('\\')) { pending += l.slice(0, -1) + '\n'; rl.setPrompt(dim('… ')); rl.prompt(); return; }
    queue.push(pending + l); pending = ''; drain();
  });
  rl.on('close', () => { const w = setInterval(() => { if (!busy) { clearInterval(w); process.exit(0); } }, 100); });
  rl.prompt();
}

main().catch(e => { console.error(red(e.stack || e.message)); process.exit(1); });
