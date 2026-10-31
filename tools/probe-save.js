#!/usr/bin/env node
/**
 * 存档兼容探测（批次 6）
 *   node tools/probe-save.js
 * 检查：旧档缺字段自愈、中途场景读档恢复、保存/读取往返一致、容量上限、体积。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8800, CDP_PORT = 9341;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const BATTERY = `(async () => {
  const R = { checks: [], errors: [] };
  const ck = (id, desc, fn) => {
    try { const r = fn(); R.checks.push({ id: id, desc: desc, ok: !!r.ok, detail: r.detail || '' }); }
    catch (e) { R.checks.push({ id: id, desc: desc, ok: false, detail: 'EXC ' + String(e && e.message || e).slice(0, 90) }); }
  };
  if (!Game.player) { quickStart(); Game.player.youth = Game.player.youth || {}; Game.player.youth.signed = true; startGame(); }
  let p = Game.player;

  ck('S1', '旧档缺 opinion/p2Story/voices.seen 能自愈', () => {
    delete p.opinion; delete p.p2Story; delete p.voices.seen;
    let threw = null;
    try { p2Ensure(p); } catch (e) { threw = String(e && e.message || e); }
    return { ok: !threw && !!p.opinion && !!p.p2Story && !!p.voices.seen,
      detail: threw ? ('EXC ' + threw.slice(0, 60)) : ('opinion=' + !!p.opinion + ' p2Story=' + !!p.p2Story + ' seen=' + !!p.voices.seen) };
  });

  ck('S2', '存档写入后可被 JSON 解析且含玩家名', () => {
    const slot = '__probe_save';
    saveGame(slot, true, true);
    const raw = localStorage.getItem(saveKey(slot));
    const d = raw ? JSON.parse(raw) : null;
    return { ok: !!d && !!d.player && !!d.player.name && !!d.date,
      detail: d ? ('name=' + d.player.name + ' date=' + JSON.stringify(d.date)) : 'no raw' };
  });

  ck('S3', '旧弧停在剧情场景时读档能恢复', () => {
    const slot = '__probe_save';
    Game.p2ArcScene = { id: 'injury_redemption', stage: 1, kind: 'linear' };
    saveGame(slot, true, true);
    Game.p2ArcScene = null;
    loadFromSlot(slot);
    p = Game.player;
    const dom = (document.getElementById('screenContainer') || {}).innerHTML || '';
    const ok = (!!Game.p2ArcScene && Game.p2ArcScene.id === 'injury_redemption') || dom.indexOf('剧情') >= 0 || dom.indexOf('伤病') >= 0;
    return { ok: ok, detail: ok ? 'restored' : ('scene=' + JSON.stringify(Game.p2ArcScene) + ' dom=' + dom.slice(0, 30)) };
  });

  ck('S3b', 'NARR 单元停在中间时读档能恢复', () => {
    const slot = '__probe_save';
    const s = narrEnsure(p);
    s.current = null; s.lock = false;
    const r = __narrDev.trigger('case_agent_gift');
    if (String(r).indexOf('started') !== 0) return { ok: false, detail: 'trigger=' + String(r).slice(0, 40) };
    if (!narrCurrent(p)) return { ok: false, detail: 'no current after trigger' };
    saveGame(slot, true, true);
    narrEnsure(p).current = null;
    loadFromSlot(slot);
    p = Game.player;
    const cur = narrCurrent(p);
    const dom = (document.getElementById('screenContainer') || {}).innerHTML || '';
    const ok = !!cur || dom.indexOf('调查') >= 0 || dom.indexOf('剧情') >= 0;
    return { ok: ok, detail: ok ? ('unit=' + (cur && cur.unit && cur.unit.id)) : 'no restore' };
  });

  ck('S4', '保存→读取往返后关键字段一致', () => {
    const slot = '__probe_save';
    const name = p.name, age = p.age, club = p.stats.club.name;
    const rep = Math.round(Number(p.reputation) || 0);
    saveGame(slot, true, true);
    loadGame(slot);
    p = Game.player;
    return { ok: p.name === name && p.age === age && p.stats.club.name === club && Math.round(Number(p.reputation) || 0) === rep,
      detail: name + '/' + age + '/' + club };
  });

  ck('S5', '数组上限不被突破', () => {
    const s = narrEnsure(p), op = opinionEnsure(p), v = voiceEnsure(p);
    const bad = [];
    if ((s.pending || []).length > 12) bad.push('pending=' + s.pending.length);
    if ((s.threads || []).length > 12) bad.push('threads=' + s.threads.length);
    if ((op.topics || []).length > 6) bad.push('topics=' + op.topics.length);
    if ((op.scars || []).length > 8) bad.push('scars=' + op.scars.length);
    if ((v.archive || []).length > 60) bad.push('archive=' + v.archive.length);
    return { ok: bad.length === 0, detail: bad.length ? bad.join(',') : 'all within caps' };
  });

  // 推进 120 天，看体积与自愈是否稳定
  const SCENES = ['currentEvent','currentMatch','p2ArcScene','seasonStoryScene','immersiveScene','p2NpcScene',
    'p2ClubScene','p2PressEvent','p2VowScene','echoScene','fanScene','stageMoment','p2Press','wcBuild',
    'euroScene','familyScene','p2CoachNews','p2EndorseOffer','p2MediaScene','textLive','pendingScene'];
  for (let i = 0; i < 120; i++) {
    try { advanceDay(); } catch (e) { const m = String(e && e.message || e).slice(0, 60); R.errors.push(m); if (R.errors.length > 5) break; }
    SCENES.forEach(k => { try { if (Game[k]) Game[k] = null; } catch (e) {} });
    if (Game.pendingRenewal) Game.pendingRenewal = false;
    if (Game.pendingFreeAgent) Game.pendingFreeAgent = false;
  }
  R.sizeKB = Math.round(JSON.stringify(Game.player).length / 1024);
  R.nan = [];
  (function walk(o, path, d) { if (d > 6 || o === null || o === undefined || R.nan.length > 8) return;
    if (typeof o === 'number') { if (!isFinite(o)) R.nan.push(path); return; }
    if (typeof o !== 'object') return;
    if (Array.isArray(o)) { o.slice(0, 25).forEach((v, i) => walk(v, path + '[' + i + ']', d + 1)); return; }
    Object.keys(o).slice(0, 50).forEach(k => walk(o[k], path + '.' + k, d + 1)); })(Game.player, 'p', 0);

  ck('S6', '推进 120 天后存档 < 1MB', () => ({ ok: R.sizeKB > 0 && R.sizeKB < 1024, detail: R.sizeKB + ' KB' }));
  ck('S7', '推进后无 NaN', () => ({ ok: R.nan.length === 0, detail: R.nan.slice(0, 4).join(',') || 'clean' }));

  R.pass = R.checks.filter(c => c.ok).length;
  R.total = R.checks.length;
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-save-' + Date.now());
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
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 150000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 300));
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.saveGame', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(BATTERY, true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.checks.some(c => !c.ok) ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_SAVE_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
