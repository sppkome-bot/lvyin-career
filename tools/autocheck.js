#!/usr/bin/env node
/**
 * 无人值守自检（不需要人工游玩）
 *   node tools/autocheck.js
 *
 * 做四件事：
 *   1. 起本地静态服务 + 无头 Edge（无第三方依赖，用 Node 内置 WebSocket 直连 CDP）
 *   2. 跑 __regress.runAll()：15 条回归
 *   3. 伪造 60 场赛后声音，算「完全重复率 / 4-gram 近似重复率 / 引语重复率 / 渠道分布」
 *   4. 读语料规模（actor 骨架数、话题、剧情单元、选项、结局、伏笔）
 * 退出码 0 = 全绿。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8788;
const CDP_PORT = 9333;
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
});
async function waitJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { return JSON.parse(await get(url)); } catch (e) { await sleep(250); }
  }
  throw new Error('CDP 未就绪：' + url);
}

const BATTERY = `(async () => {
  const R = {};
  R.fxMode = (window.__fx && window.__fx.mode) || 'n/a';

  let reg = null;
  try { reg = window.__regress.runAll(); } catch (e) { reg = { error: String(e) }; }
  R.regress = (reg && reg.pass !== undefined)
    ? { pass: reg.pass, total: reg.total, ms: reg.ms,
        failed: (reg.cases || []).filter(c => !c.ok).map(c => ({
          id: c.id, checks: (c.checks || []).filter(x => !x.ok).map(x => (x.msg || '') + (x.err ? ' | ' + x.err : '')) })) }
    : reg;

  let voice = null;
  try {
    const p = Game.player;
    for (let i = 0; i < 60; i++) {
      const m = { isHome: i % 2 === 0, isNational: false, cup: null, important: i % 4 === 0,
        score: { home: 2 + (i % 3), away: 1 + (i % 2) }, playerGoals: i % 3, playerAssists: i % 2,
        opponent: '测试队' + i, minute: 90, redCards: 0 };
      addVoiceEntry('match', { m: m, rating: 6 + (i % 30) / 10, played: true });
    }
    const arch = (voiceEnsure(p).archive || []);
    const sig = e => (e.title || '') + '||' + (e.quotes || []).map(q => q.text).join('|');
    const sigs = arch.map(sig);
    const uniq = new Set(sigs).size;
    const g4 = s => { s = String(s).replace(/[\\s，。、；：！？“”"'…—]/g, ''); const o = []; for (let i = 0; i + 4 <= s.length; i++) o.push(s.substr(i, 4)); return o; };
    const grams = sigs.map(g4);
    let near = 0, pairs = 0;
    for (let i = 0; i < grams.length; i++) for (let j = i + 1; j < grams.length; j++) {
      const sb = new Set(grams[j]); let n = 0;
      for (const g of grams[i]) if (sb.has(g)) n++;
      pairs++; if (n / (grams[i].length + grams[j].length - n) > 0.55) near++;
    }
    const allQ = []; arch.forEach(e => (e.quotes || []).forEach(q => allQ.push(String(q.text || ''))));
    const ch = {}; arch.forEach(e => (e.quotes || []).forEach(q => { const k = q.channel || '(none)'; ch[k] = (ch[k] || 0) + 1; }));
    voice = { entries: arch.length, exactDupRate: +(1 - uniq / arch.length).toFixed(3),
      nearPairRate: +(near / Math.max(1, pairs)).toFixed(3),
      quotes: allQ.length, quoteDupRate: +(1 - new Set(allQ).size / Math.max(1, allQ.length)).toFixed(3),
      channels: ch };
  } catch (e) { voice = { error: String(e) }; }

  let lex = null;
  try {
    const A = (typeof VOX_ACTORS !== 'undefined') ? VOX_ACTORS : {};
    let frames = 0; const per = {};
    Object.keys(A).forEach(a => {
      let n = 0;
      const walk = o => { if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { n += o.length; return; }
        Object.keys(o).forEach(k => { const v = o[k]; if (Array.isArray(v)) n += v.length; else if (v && typeof v === 'object') walk(v); }); };
      walk(A[a].frames || A[a].lines || A[a]);
      per[a] = n; frames += n;
    });
    const cnt = x => (typeof x !== 'undefined' && x) ? Object.keys(x).length : null;
    const cov = (window.__narrDev && typeof __narrDev.coverage === 'function') ? __narrDev.coverage() : {};
    lex = { actors: Object.keys(A).length, frames: frames,
      minFramesPerActor: Object.keys(per).length ? Math.min.apply(null, Object.keys(per).map(k => per[k])) : null,
      topics: cnt(typeof VOX_TOPICS !== 'undefined' ? VOX_TOPICS : null),
      channels: cnt(typeof VOX_CHANNELS !== 'undefined' ? VOX_CHANNELS : null),
      nickGroups: cnt(typeof VOX_NICKS !== 'undefined' ? VOX_NICKS : null),
      narrUnits: (typeof NARR_UNITS !== 'undefined') ? NARR_UNITS.length : null,
      threads: cnt(typeof NARR_THREADS !== 'undefined' ? NARR_THREADS : null),
      verbs: cnt(typeof NARR_VERBS !== 'undefined' ? NARR_VERBS : null),
      coverage: cov };
  } catch (e) { lex = { error: String(e) }; }

  R.warns = (window.__fx && window.__fx.wins) || 0;
  R.diag = (Game.diag || []).slice(0, 4).map(d => (d.id || '') + ':' + String(d.detail || '').slice(0, 70));
  R.voice = voice; R.lex = lex;
  try { R.saveKB = Math.round(JSON.stringify(Game.player).length / 1024); } catch (e) {}
  return JSON.stringify(R);
})()`;

(async () => {
  const edge = EDGE_CANDIDATES.find(p => fs.existsSync(p));
  if (!edge) throw new Error('找不到 Edge/Chrome');

  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-autocheck-' + Date.now());
  const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + CDP_PORT,
    'http://127.0.0.1:' + SERVE_PORT + '/index.html?dev=1&assert=all&fx=new'], { stdio: 'ignore' });

  const cleanup = () => {
    try { browser.kill(); } catch (e) {}
    try {
      if (process.platform === 'win32' && browser.pid) {
        require('child_process').spawn('taskkill', ['/F', '/T', '/PID', String(browser.pid)], { stdio: 'ignore', detached: true }).unref();
      }
    } catch (e) {}
    try { server.kill(); } catch (e) {}
  };
  process.on('exit', cleanup);

  try {
    await sleep(600);
    const ver = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version');
    let list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
    for (let i = 0; i < 40 && !(list[0] && list[0].webSocketDebuggerUrl); i++) { await sleep(250); list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); }
    const target = list.find(t => (t.url || '').indexOf('index.html') >= 0) || list[0];
    if (!target) throw new Error('没有可用标签页');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('WS error')); });
    let seq = 0; const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    };
    const send = (method, params) => new Promise((res, rej) => {
      const id = ++seq; pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 200));
      return r.result && r.result.value;
    };

    // 等 __regress 挂载
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if (await evalJs('!!window.__regress', false)) { ready = true; break; } } catch (e) {}
      await sleep(250);
    }
    if (!ready) throw new Error('页面未就绪（__regress 未挂载）');

    const raw = await evalJs(BATTERY, true);
    const out = JSON.parse(raw);
    out.runtime = ver.Browser;

    console.log(JSON.stringify(out, null, 1));
    const ok = out.regress && out.regress.pass === out.regress.total && out.warns === 0;
    ws.close();
    cleanup();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    cleanup();
    console.error('AUTOCHECK_FAILED: ' + (e && e.message || e));
    process.exit(1);
  }
})();
