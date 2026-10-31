#!/usr/bin/env node
/**
 * 截取主界面「自动推进」卡片（折叠 + 展开各一张）
 *   node tools/shot-auto-card.js
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8806, CDP_PORT = 9344;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-card-' + Date.now());
  const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--window-size=430,932',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + CDP_PORT,
    'http://127.0.0.1:' + SERVE_PORT + '/index.html'], { stdio: 'ignore' });
  const cleanup = () => {
    try { browser.kill(); } catch (e) {}
    try { if (process.platform === 'win32' && browser.pid) require('child_process').spawn('taskkill', ['/F', '/T', '/PID', String(browser.pid)], { stdio: 'ignore', detached: true }).unref(); } catch (e) {}
    try { server.kill(); } catch (e) {}
  };
  process.on('exit', cleanup);
  try {
    await sleep(700);
    await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version');
    let list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
    for (let i = 0; i < 40 && !(list[0] && list[0].webSocketDebuggerUrl); i++) { await sleep(250); list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); }
    const t = list.find(x => (x.url || '').indexOf('index.html') >= 0) || list[0];
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); });
    let seq = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(m.error.message)) : q.res(m.result); } };
    const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 60000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 200));
      return r.result && r.result.value;
    };
    const shot = async name => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const p = path.join(ROOT, name);
      fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
      return p;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.showMain', false)) break; } catch (e) {} await sleep(250); }
    const found = await evalJs(`(function(){
      if(!Game.player){ quickStart(); Game.player.youth=Game.player.youth||{}; Game.player.youth.signed=true; startGame(); }
      const cards=[...document.querySelectorAll('#screenContainer .card')];
      const c=cards.find(x=>x.textContent.indexOf('自动推进')>=0);
      if(!c) return {ok:false,cards:cards.length};
      c.scrollIntoView({block:'center'});
      return {ok:true, text:c.textContent.replace(/\\s+/g,' ').slice(0,120), hasPlan:!!c.querySelector('.btn-grid'), hasFold:!!c.querySelector('details')};
    })()`, false);
    await sleep(500);
    const p1 = await shot('main-ui-auto-collapsed.png');
    const opened = await evalJs(`(function(){
      const c=[...document.querySelectorAll('#screenContainer .card')].find(x=>x.textContent.indexOf('自动推进')>=0);
      if(!c) return 'no card';
      const d=c.querySelector('details'); if(!d) return 'no details';
      d.open=true; c.scrollIntoView({block:'center'});
      return 'opened';
    })()`, false);
    await sleep(500);
    const p2 = await shot('main-ui-auto-expanded.png');
    console.log(JSON.stringify({ found: found, opened: opened, collapsed: p1, expanded: p2 }));
    ws.close(); cleanup();
    process.exit(found && found.ok ? 0 : 1);
  } catch (e) { cleanup(); console.error('SHOT_CARD_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
