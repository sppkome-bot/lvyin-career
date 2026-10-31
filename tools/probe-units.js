#!/usr/bin/env node
/**
 * 剧情单元死循环定位（批次 2 补充）
 *   node tools/probe-units.js [起始索引] [个数]
 * 每个单元单独一页、每步单独一次 evaluate（3 秒超时）；超时即 Runtime.terminateExecution 并换页。
 * 输出 JSON：{hang:[], stepLimit:[], ok:[]}
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8790, CDP_PORT = 9336;
const STEP_TIMEOUT = 3000, MAX_STEPS = 8;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-units-' + Date.now());
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
    await sleep(700);
    const ver = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version');
    let list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
    for (let i = 0; i < 40 && !(list[0] && list[0].webSocketDebuggerUrl); i++) { await sleep(250); list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); }
    const t = list.find(x => (x.url || '').indexOf('index.html') >= 0) || list[0];

    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); });
    let seq = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(m.error.message)) : q.res(m.result); } };
    const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

    async function evalWithTimeout(expr, ms) {
      const p = send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('__TIMEOUT__')), ms); });
      try { return await Promise.race([p, timeout]); }
      finally { clearTimeout(timer); }
    }

    async function freshPage() {
      await send('Page.navigate', { url: 'http://127.0.0.1:' + SERVE_PORT + '/index.html?dev=1&fx=new' });
      for (let i = 0; i < 80; i++) {
        try { const r = await evalWithTimeout('!!window.__regress', 2000); if (r.result && r.result.value) return; } catch (e) {}
        await sleep(200);
      }
      throw new Error('页面未就绪');
    }

    const unitIds = await (async () => {
      await freshPage();
      const r = await evalWithTimeout('JSON.stringify((typeof NARR_UNITS!=="undefined"?NARR_UNITS:[]).map(u=>u.id))', 5000);
      return JSON.parse(r.result.value);
    })();

    const start = Number(process.argv[2] || 0), count = Number(process.argv[3] || unitIds.length);
    const slice = unitIds.slice(start, start + count);
    const out = { total: unitIds.length, range: [start, start + slice.length], hang: [], stepLimit: [], ok: [], errors: [] };

    for (const id of slice) {
      await freshPage();
      // 建号
      try {
        await evalWithTimeout('(function(){if(!Game.player){quickStart();Game.player.youth=Game.player.youth||{};Game.player.youth.signed=true;startGame();}return "ok";})()', 8000);
      } catch (e) { out.errors.push(id + ':setup'); continue; }

      let hangAt = -1, steps = 0, lastNode = null, same = 0;
      try {
        const r = await evalWithTimeout(`(function(){var s=narrEnsure(Game.player);s.current=null;s.lock=false;return String(__narrDev.trigger(${JSON.stringify(id)}));})()`, STEP_TIMEOUT);
        const st = r.result && r.result.value;
        if (!st || String(st).indexOf('started') !== 0) { out.errors.push(id + ':' + String(st).slice(0, 40)); continue; }
      } catch (e) {
        if (e.message === '__TIMEOUT__') { try { await send('Runtime.terminateExecution', {}); } catch (x) {} out.hang.push({ id: id, at: 'trigger' }); continue; }
        out.errors.push(id + ':trigger ' + e.message.slice(0, 40)); continue;
      }

      for (let i = 0; i < MAX_STEPS; i++) {
        let node = null;
        try {
          const r = await evalWithTimeout(
            `(function(){var p=Game.player,c=narrCurrent(p);if(!c||!c.scene)return 'END';var v=narrNodeChoices(p,c.unit,c.scene);if(!v||!v.length)return 'NOVIS:'+c.scene.node;return c.scene.node+'|'+v.length;})()`,
            STEP_TIMEOUT);
          const s = r.result && r.result.value;
          if (!s || s === 'END') break;
          if (String(s).indexOf('NOVIS:') === 0) { out.errors.push(id + ':' + s); break; }
          node = String(s).split('|')[0];
        } catch (e) {
          if (e.message === '__TIMEOUT__') { hangAt = i; try { await send('Runtime.terminateExecution', {}); } catch (x) {} }
          else out.errors.push(id + ':read ' + e.message.slice(0, 40));
          break;
        }
        if (node && node === lastNode) { same++; if (same >= 2) { out.errors.push(id + ':stuck-node ' + node); break; } } else same = 0;
        lastNode = node;
        try {
          await evalWithTimeout('narrChoose(0)', STEP_TIMEOUT);
          steps++;
        } catch (e) {
          if (e.message === '__TIMEOUT__') { hangAt = i; try { await send('Runtime.terminateExecution', {}); } catch (x) {} }
          else out.errors.push(id + ':choose ' + e.message.slice(0, 40));
          break;
        }
      }
      if (hangAt >= 0) out.hang.push({ id: id, at: 'step' + hangAt, node: lastNode });
      else if (steps >= MAX_STEPS) out.stepLimit.push({ id: id, node: lastNode });
      else out.ok.push(id);
    }

    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.hang.length ? 1 : 0);
  } catch (e) { cleanup(); console.error('UNITS_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
