#!/usr/bin/env node
/**
 * 剧情 / 舆论边界探测（批次 5）
 *   node tools/probe-narr-edges.js
 * 检查：pending 只触发一次、threads 超期不卡 open、31 单元能出结局、舆论级联四态可进可出。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8798, CDP_PORT = 9340;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const BATTERY = `(async () => {
  const R = { checks: [], walk: { tried: 0, finished: 0, noEnding: [], err: [] } };
  const ck = (id, desc, fn) => {
    try { const r = fn(); R.checks.push({ id: id, desc: desc, ok: !!r.ok, detail: r.detail || '' }); }
    catch (e) { R.checks.push({ id: id, desc: desc, ok: false, detail: 'EXC ' + String(e && e.message || e).slice(0, 90) }); }
  };
  if (!Game.player) { quickStart(); Game.player.youth = Game.player.youth || {}; Game.player.youth.signed = true; startGame(); }
  const p = Game.player;
  if (!Game.season) {
    try { p.age = 18; p.stats.club = { name: '阿森纳', leagueKey: 'epl', league: '英超', level: 82, coach: '阿尔特塔' }; Game.season = null; ensureSeason(true); } catch (e) {}
  }
  const s = narrEnsure(p);

  ck('N1', '延迟后果到期只结算一次', () => {
    s.pending = [{ id: 'pc_probe', due: daySerial(Game.date), unit: '', kind: 'normal', text: '探针：一条延迟后果', eff: { mood: 5 } }];
    const before = p.condition.mood;
    narrTickPending(p);
    const mid = p.condition.mood;
    narrTickPending(p);
    const after = p.condition.mood;
    return { ok: mid !== before && after === mid && s.pending.length === 0,
      detail: 'mood ' + before + '→' + mid + '→' + after + ' pending=' + s.pending.length };
  });

  ck('N2', '伏笔超期不会卡在 open', () => {
    s.threads = [{ id: 't_probe', title: '探针伏笔', src: 'probe', opened: daySerial(Game.date) - 100, due: daySerial(Game.date) - 10, state: 'open' }];
    narrThreadsTick(p);
    const st = s.threads[0] && s.threads[0].state;
    return { ok: st === 'failed', detail: 'state=' + st };
  });

  ck('N3', '伏笔到期前会标记 due', () => {
    s.threads = [{ id: 't_probe2', title: '探针伏笔2', src: 'probe', opened: daySerial(Game.date) - 30, due: daySerial(Game.date) + 3, state: 'open' }];
    narrThreadsTick(p);
    const st = s.threads[0] && s.threads[0].state;
    return { ok: st === 'due', detail: 'state=' + st };
  });

  ck('N4', '舆论级联：idle → murmur', () => {
    const op = opinionEnsure(p);
    op.heat = 50; op.stance.media = 40; op.cascade = { stage: 'idle', since: 0, strikes: 0 };
    voxCascade(p, op);
    return { ok: op.cascade.stage === 'murmur', detail: op.cascade.stage };
  });

  ck('N5', '级联：murmur → pressure', () => {
    const op = opinionEnsure(p);
    op.cascade = { stage: 'murmur', since: daySerial(Game.date) - 20, strikes: 0 };
    op.heat = 55; op.stance.media = 40;
    voxCascade(p, op);
    return { ok: op.cascade.stage === 'pressure', detail: op.cascade.stage };
  });

  ck('N6', '级联：pressure → crisis', () => {
    const op = opinionEnsure(p);
    op.cascade = { stage: 'pressure', since: daySerial(Game.date) - 1, strikes: 0 };
    op.heat = 80; op.stance.media = 40;
    voxCascade(p, op);
    return { ok: op.cascade.stage === 'crisis', detail: op.cascade.stage };
  });

  ck('N7', '级联：crisis 放任后会自我收束', () => {
    const op = opinionEnsure(p);
    const scars0 = (op.scars || []).length;
    op.cascade = { stage: 'crisis', since: daySerial(Game.date) - 30, strikes: 0 };
    op.heat = 80; op.stance.media = 40;
    voxCascade(p, op);
    return { ok: op.cascade.stage === 'idle' || op.cascade.stage === 'resolved',
      detail: 'stage=' + op.cascade.stage + ' scars ' + scars0 + '→' + (op.scars || []).length };
  });

  // 走完全部剧情单元，统计结局
  try {
    const units = (typeof NARR_UNITS !== 'undefined') ? NARR_UNITS : [];
    const endBefore = (s.stats && s.stats.endings) ? Object.keys(s.stats.endings).length : 0;
    units.forEach(u => {
      R.walk.tried++;
      try {
        s.current = null; s.lock = false; s.lastResult = null;
        Game.p2VowScene = null;
        const r = __narrDev.trigger(u.id);
        if (String(r).indexOf('started') !== 0) { R.walk.err.push(u.id + ':start ' + String(r).slice(0, 24)); return; }
        let steps = 0;
        for (; steps < 10; steps++) {
          const cur = narrCurrent(p);
          if (!cur || !cur.scene) break;
          const vis = narrNodeChoices(p, cur.unit, cur.scene);
          if (!vis || !vis.length) break;
          narrChoose(0);
          const st2 = narrEnsure(p);
          if (st2.lastResult && typeof narrDismissResult === 'function') narrDismissResult();
          Game.p2VowScene = null;
        }
        if (!narrCurrent(p)) R.walk.finished++;
        else R.walk.noEnding.push(u.id + '@' + steps);
      } catch (e) { R.walk.err.push(u.id + ':EXC ' + String(e && e.message || e).slice(0, 50)); }
    });
    const endAfter = (s.stats && s.stats.endings) ? Object.keys(s.stats.endings).length : 0;
    R.walk.endingsBefore = endBefore; R.walk.endingsAfter = endAfter;
    s.current = null; s.lock = false; s.lastResult = null;
  } catch (e) { R.walk.err.push('fatal ' + String(e && e.message || e).slice(0, 60)); }

  R.pass = R.checks.filter(c => c.ok).length;
  R.total = R.checks.length;
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-narr-' + Date.now());
  const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + CDP_PORT,
    'http://127.0.0.1:' + SERVE_PORT + '/index.html?dev=1&fx=new'], { stdio: 'ignore' });
  const cleanup = () => {
    try { browser.kill(); } catch (e) {}
    try { if (process.platform === 'win32' && browser.pid) require('child_process').spawn('taskkill', ['/F', '/T', '/PID', String(browser.pid)], { stdio: 'ignore', detached: true }).unref(); } catch (e) {}
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
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 120000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 300));
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.narrEnsure', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(BATTERY, true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.checks.some(c => !c.ok) ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_NARR_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
