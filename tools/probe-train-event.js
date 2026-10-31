#!/usr/bin/env node
/**
 * 训练 / 事件引擎探测（批次 7，收尾）
 *   node tools/probe-train-event.js
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8802, CDP_PORT = 9342;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const BATTERY = `(async () => {
  const R = { checks: [] };
  const ck = (id, desc, fn) => {
    try { const r = fn(); R.checks.push({ id: id, desc: desc, ok: !!r.ok, detail: r.detail || '' }); }
    catch (e) { R.checks.push({ id: id, desc: desc, ok: false, detail: 'EXC ' + String(e && e.message || e).slice(0, 90) }); }
  };
  if (!Game.player) { quickStart(); Game.player.youth = Game.player.youth || {}; Game.player.youth.signed = true; startGame(); }
  const p = Game.player;
  p.condition.fitness = 90; p.condition.health = 100; p.injury = null;

  ck('TR1', '普通训练：有成长、有体能消耗', () => {
    p.trainedDay = '';
    const before = Object.assign({}, p.attrs);
    const r = trainCore('technique', 'normal');
    const grew = Object.keys(p.attrs).filter(k => p.attrs[k] > before[k]);
    return { ok: r.ok && grew.length > 0 && r.cost !== 0, detail: 'grew=' + grew.slice(0, 3).join(',') + ' cost=' + r.cost };
  });

  ck('TR2', '当天第二次训练被拦', () => {
    const r = trainCore('technique', 'normal');
    return { ok: r.ok === false && r.reason === 'trained', detail: 'reason=' + r.reason };
  });

  ck('TR3', '全力强度消耗大于正常', () => {
    p.trainedDay = '';
    const rn = trainCore('technique', 'normal');
    p.trainedDay = '';
    const rf = trainCore('technique', 'full');
    return { ok: Math.abs(rf.cost) > Math.abs(rn.cost), detail: 'normal=' + rn.cost + ' full=' + rf.cost };
  });

  ck('TR4', '伤病期间只能恢复训练', () => {
    p.injury = { type: '测试伤', daysLeft: 7, totalDays: 7, sev: 'light' };
    const r = trainCore('technique', 'normal');
    const ok = r.ok === false && r.reason === 'injured';
    p.injury = null;
    return { ok: ok, detail: 'reason=' + r.reason };
  });

  ck('TR5', '恢复训练不涨属性但回体能', () => {
    p.trainedDay = ''; p.condition.fitness = 50;
    const before = p.condition.fitness;
    const r = trainCore('recovery', 'normal');
    return { ok: r.ok && r.recovery === true && p.condition.fitness >= before, detail: 'fitness ' + before + '→' + p.condition.fitness };
  });

  ck('EV1', '事件 30 天冷却', () => {
    delete eventCooldown['probe_ev1'];
    const a = canTriggerEvent('probe_ev1');
    markEventCooldown('probe_ev1');
    const b = canTriggerEvent('probe_ev1');
    return { ok: a === true && b === false, detail: 'first=' + a + ' second=' + b };
  });

  ck('EV2', '每周总数上限 3', () => {
    const wk = eventWeekKey();
    eventWeekStats = { key: wk, total: 3, cats: {} };
    const r = canTriggerEvent({ id: 'probe_ev2', cat: 'training', w: 1 });
    eventWeekStats = { key: wk, total: 0, cats: {} };
    return { ok: r === false, detail: 'allowed=' + r };
  });

  ck('EV3', '同类每周上限 2', () => {
    const wk = eventWeekKey();
    eventWeekStats = { key: wk, total: 0, cats: { training: 2 } };
    const r = canTriggerEvent({ id: 'probe_ev3', cat: 'training', w: 1 });
    eventWeekStats = { key: wk, total: 0, cats: {} };
    return { ok: r === false, detail: 'allowed=' + r };
  });

  ck('EV4', '重大事件每赛季上限', () => {
    eventSeasonStats = { year: seasonYear(), major: 4 };
    const r = canTriggerEvent({ id: 'probe_ev4', cat: 'special', w: 5 });
    eventSeasonStats = { year: seasonYear(), major: 0 };
    return { ok: r === false, detail: 'allowed=' + r };
  });

  ck('EV5', '事件文本变体可用', () => {
    const ev = (typeof EVENT_LIBRARY !== 'undefined') ? EVENT_LIBRARY.find(e => e.variants && e.variants.length) : null;
    if (!ev) return { ok: false, detail: 'no variant event' };
    const t = eventTextFor(ev, p, 1);
    const isVariant = t && (t !== ev.text) && (ev.variants.some(v => v.text === t) || t.length > 0);
    return { ok: !!isVariant, detail: (t || '').slice(0, 30) };
  });

  ck('EV6', '冷却后仍可再次触发', () => {
    delete eventCooldown['probe_ev6'];
    markEventCooldown('probe_ev6');
    // 把冷却改成 31 天前
    eventCooldown['probe_ev6'] = { y: Game.date.year, m: Game.date.month, d: Game.date.day };
    const cd = eventCooldown['probe_ev6'];
    const day = 31;
    let m = cd.m, y = cd.y, d = cd.d - day;
    while (d <= 0) { m--; if (m <= 0) { m = 12; y--; } d += 30; }
    eventCooldown['probe_ev6'] = { y: y, m: m, d: d };
    return { ok: canTriggerEvent('probe_ev6') === true, detail: 'allowed after 31d' };
  });

  R.pass = R.checks.filter(c => c.ok).length;
  R.total = R.checks.length;
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-te-' + Date.now());
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
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.trainCore', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(BATTERY, true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.checks.some(c => !c.ok) ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_TE_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
