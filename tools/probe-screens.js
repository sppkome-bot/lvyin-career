#!/usr/bin/env node
/**
 * 界面断点探测：把每个 show* 界面都调用一遍，抓异常与空白页。
 *   node tools/probe-screens.js
 * 输出 JSON；退出码 0 = 没有界面抛错。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8788, CDP_PORT = 9334;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const BATTERY = `(async () => {
  const R = { total: 0, tested: 0, bad: [], needsContext: [], skipped: [] };
  // 需要上下文才能渲染的界面：已人工核对调用点，均由上一屏写入状态后再进入
  const CTX = {
    showTacticsScreen: '需要 Game.currentMatch（由比赛日/战术详情进入）',
    showTrialAim: '需要 Game.trialGame（由 showTrialRound 分发）',
    showTrialReact: '需要 Game.trialGame（由 showTrialRound 分发）',
    showTrialTiming: '需要 Game.trialGame（由 showTrialRound 分发）'
  };
  if (!Game.player) {
    quickStart();
    Game.player.youth = Game.player.youth || {};
    Game.player.youth.signed = true;
    startGame();
  }
  const snap = JSON.stringify(Game.player);
  const RESET = ['currentEvent','currentMatch','p2ArcScene','seasonStoryScene','immersiveScene','p2NpcScene',
    'p2ClubScene','p2PressEvent','p2VowScene','echoScene','fanScene','stageMoment','p2Press','wcBuild',
    'euroScene','familyScene','p2CoachNews','p2EndorseOffer','p2MediaScene','textLive','pendingScene'];
  const names = Object.keys(window).filter(k => /^show[A-Z]/.test(k) && typeof window[k] === 'function').sort();
  R.total = names.length;
  for (const n of names) {
    let fn;
    try { fn = window[n]; } catch (e) { continue; }
    if (typeof fn !== 'function') continue;
    if (fn.length > 0) { R.skipped.push(n + '(需参数)'); continue; }
    if (CTX[n]) {
      let realErr = null;
      try { Game.player = JSON.parse(snap); RESET.forEach(k => { Game[k] = null; }); fn.call(window); }
      catch (e) { realErr = String(e && e.message || e); }
      // 无上下文时报错属预期；若“有上下文也报错”需人工再核
      R.needsContext.push({ n: n, why: CTX[n], errWhenBare: realErr ? realErr.slice(0, 80) : null });
      continue;
    }
    let err = null, len = 0;
    try {
      Game.player = JSON.parse(snap);
      RESET.forEach(k => { Game[k] = null; });
      fn.call(window);
      const sc = document.getElementById('screenContainer');
      len = sc ? sc.innerHTML.length : 0;
    } catch (e) { err = String(e && e.message || e).slice(0, 180); }
    R.tested++;
    if (err) R.bad.push({ n: n, err: err });
    else if (len < 40) R.bad.push({ n: n, blank: len });
  }
  Game.player = JSON.parse(snap);
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-screens-' + Date.now());
  const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + CDP_PORT,
    'http://127.0.0.1:' + SERVE_PORT + '/index.html?dev=1&fx=new'], { stdio: 'ignore' });
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
    const t = list.find(x => (x.url || '').indexOf('index.html') >= 0) || list[0];
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); });
    let seq = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.showMain', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(BATTERY, true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.bad.length ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
