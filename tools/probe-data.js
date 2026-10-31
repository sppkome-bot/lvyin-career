#!/usr/bin/env node
/**
 * 数据完整性探测（批次 2）：推进 N 天，然后对玩家对象做全字段扫描。
 *   node tools/probe-data.js [天数]      默认 400
 * 检查：NaN/Infinity、数值越界、弧进度孤儿引用、voices 字段缺失、线程/话题脏数据。
 * 退出码 0 = 无异常。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAYS = Number(process.argv[2] || 400);
const SERVE_PORT = 8788, CDP_PORT = 9335;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const battery = days => `(async () => {
  const R = { days: 0, advanceErrors: {}, nan: [], range: [], orphan: {}, threads: {}, voice: {}, opinion: {} };
  if (!Game.player) {
    quickStart(); Game.player.youth = Game.player.youth || {}; Game.player.youth.signed = true; startGame();
  }
  const SCENES = ['currentEvent','currentMatch','p2ArcScene','seasonStoryScene','immersiveScene','p2NpcScene',
    'p2ClubScene','p2PressEvent','p2VowScene','echoScene','fanScene','stageMoment','p2Press','wcBuild',
    'euroScene','familyScene','p2CoachNews','p2EndorseOffer','p2MediaScene','textLive','pendingScene'];

  for (let i = 0; i < ${days}; i++) {
    try { advanceDay(); R.days++; }
    catch (e) { const m = String(e && e.message || e).slice(0, 90); R.advanceErrors[m] = (R.advanceErrors[m] || 0) + 1; }
    SCENES.forEach(k => { try { if (Game[k]) Game[k] = null; } catch (e) {} });
    if (Game.pendingRenewal) Game.pendingRenewal = false;
    if (Game.pendingFreeAgent) Game.pendingFreeAgent = false;
    if (Game.pendingLoanBuyout) Game.pendingLoanBuyout = false;
  }

  const p = Game.player;
  if (!p) { R.fatal = 'no player after drive'; return JSON.stringify(R); }

  // 8) 灌入 60 场赛后声音（覆盖 VOX 语料与档案结构）
  R.unitErr = [];
  try {
    for (let i = 0; i < 60; i++) {
      const m = { isHome: i % 2 === 0, isNational: false, cup: null, important: i % 4 === 0,
        score: { home: 2 + (i % 3), away: 1 + (i % 2) }, playerGoals: i % 3, playerAssists: i % 2,
        opponent: '探测队' + i, minute: 90, redCards: 0 };
      addVoiceEntry('match', { m: m, rating: 6 + (i % 30) / 10, played: true });
    }
  } catch (e) { R.voiceErr = String(e && e.message || e).slice(0, 140); }

  // 9) 舆论打点 + 推进 20 周（覆盖话题衰减、级联、立场漂移）
  try {
    const keys = (typeof VOX_TOPICS !== 'undefined') ? Object.keys(VOX_TOPICS).slice(0, 12) : [];
    keys.forEach(k => topicBump(p, k, 20, 'probe'));
    for (let i = 0; i < 20; i++) {
      Game.date.day += 7;
      while (Game.date.day > 30) { Game.date.day -= 30; Game.date.month++; if (Game.date.month > 12) { Game.date.month = 1; Game.date.year++; } }
      opinionTick(p);
    }
  } catch (e) { R.opErr = String(e && e.message || e).slice(0, 140); }

  // 10) 强制触发全部剧情单元（覆盖 31 个单元的首屏渲染）
  try {
    const units = (typeof NARR_UNITS !== 'undefined') ? NARR_UNITS.slice(0, 40) : [];
    units.forEach(u => {
      try {
        const s = narrEnsure(p);
        s.current = null; s.lock = false;
        const r = __narrDev.trigger(u.id);
        if (String(r).indexOf('started') !== 0 && String(r).indexOf('blocked') < 0) R.unitErr.push(u.id + ':' + String(r).slice(0, 50));
      } catch (e) { R.unitErr.push(u.id + ':ERR ' + String(e && e.message || e).slice(0, 60)); }
    });
    const s2 = narrEnsure(p); s2.current = null; s2.lock = false;
  } catch (e) { R.unitErr.push('fatal ' + String(e && e.message || e).slice(0, 80)); }

  // 11) 逐个走完剧情单元（自动选第一个可见选项），覆盖选择结算 / 结局 / 伏笔
  R.walk = { done: 0, err: [], endings: 0, unresolved: [] };
  try {
    const units = (typeof NARR_UNITS !== 'undefined') ? NARR_UNITS.slice(0, 40) : [];
    units.forEach(u => {
      try {
        const s = narrEnsure(p);
        s.current = null; s.lock = false;
        Game.p2VowScene = null;
        narrEnsure(p).lastResult = null;
        const r = __narrDev.trigger(u.id);
        if (String(r).indexOf('started') !== 0) { R.walk.unresolved.push(u.id + ':' + String(r).slice(0, 30)); return; }
        let steps = 0;
        for (; steps < 8; steps++) {
          const cur = narrCurrent(p);
          if (!cur || !cur.scene) break;
          const vis = narrNodeChoices(p, cur.unit, cur.scene);
          if (!vis || !vis.length) { R.walk.unresolved.push(u.id + ':no-visible-choice@' + cur.scene.node); break; }
          narrChoose(0);
          const st = narrEnsure(p);
          if (st.lastResult && typeof narrDismissResult === 'function') narrDismissResult();
          Game.p2VowScene = null;
        }
        if (steps >= 8) R.walk.stepLimit = (R.walk.stepLimit || 0) + 1;
        R.walk.done++;
      } catch (e) { R.walk.err.push(u.id + ':' + String(e && e.message || e).slice(0, 70)); }
    });
    const s2 = narrEnsure(p);
    s2.current = null; s2.lock = false; s2.lastResult = null;
    R.walk.endings = (s2.stats && s2.stats.endings) || 0;
    R.walk.archive = (s2.archive || []).length;
  } catch (e) { R.walk.err.push('fatal ' + String(e && e.message || e).slice(0, 80)); }

  // 1) NaN / Infinity 深扫
  (function walk(o, path, depth) {
    if (R.nan.length > 25 || depth > 7 || o === null || o === undefined) return;
    const t = typeof o;
    if (t === 'number') { if (!isFinite(o)) R.nan.push({ path: path, val: String(o) }); return; }
    if (t !== 'object') return;
    if (Array.isArray(o)) { o.slice(0, 30).forEach((v, i) => walk(v, path + '[' + i + ']', depth + 1)); return; }
    Object.keys(o).slice(0, 60).forEach(k => walk(o[k], path + '.' + k, depth + 1));
  })(p, 'p', 0);

  // 2) 数值越界
  const put = (path, min, max) => {
    const v = fxGet(p, path);
    if (typeof v === 'number' && (v < min || v > max)) R.range.push({ path: path, v: v });
  };
  ['condition.fitness','condition.sharpness','condition.mood','condition.stress','condition.health','condition.morale',
   'relationships.coach','relationships.media','relationships.referee','relationships.teammates.general',
   'fanApproval','reputation','clubStory.boardTrust','social.sentiment','opinion.heat']
    .forEach(k => put(k, 0, 100));
  Object.keys(FX_SPEC || {}).forEach(k => { const s = FX_SPEC[k]; if (s) put(s[0], s[2], s[3]); });
  put('money', 0, Number.MAX_SAFE_INTEGER);
  Object.keys(p.personality || {}).forEach(k => put('personality.' + k, 1, 20));
  Object.keys(p.attrs || {}).forEach(k => put('attrs.' + k, 1, 20));
  (p.opinion && p.opinion.stance ? Object.keys(p.opinion.stance) : []).forEach(k => put('opinion.stance.' + k, 0, 100));

  // 3) 孤儿引用
  const arcIds = Object.keys(p.arcs || {}).filter(id => !(typeof STORY_ARCS !== 'undefined' && STORY_ARCS[id]));
  if (arcIds.length) R.orphan.arcs = arcIds.slice(0, 10);
  const treeBad = [];
  Object.keys(p.arcs || {}).forEach(id => {
    const a = p.arcs[id], tree = (typeof ARC_TREES !== 'undefined') ? ARC_TREES[id] : null;
    if (tree && a && a.node && !tree.nodes[a.node]) treeBad.push(id + ':' + a.node);
  });
  if (treeBad.length) R.orphan.treeNodes = treeBad.slice(0, 10);

  // 4) 线程 / 待办
  const st = p.p2Story || {};
  const th = st.threads || [];
  const ids = th.map(t => t.id);
  R.threads = { n: th.length, dup: ids.filter((x, i) => ids.indexOf(x) !== i).slice(0, 5),
    badState: th.filter(t => ['open','due','closed','failed'].indexOf(t.state) < 0).map(t => t.state).slice(0, 5),
    overdueOpen: th.filter(t => t.state === 'open' && t.due && daySerial(Game.date) - t.due > 60).length };
  R.threads.pendingN = (st.pending || []).length;

  // 5) 声音档案字段
  const arch = (p.voices && p.voices.archive) || [];
  R.voice = { n: arch.length, bad: arch.filter(e => !e || !e.id || !e.title || !Array.isArray(e.quotes) || !e.quotes.length).length };

  // 6) 舆论
  const op = p.opinion || {};
  const tp = op.topics || [];
  R.opinion = { heat: op.heat, frame: op.frame, topics: tp.length,
    topicDup: tp.map(t => t.key).filter((x, i, a) => a.indexOf(x) !== i).slice(0, 5),
    topicBad: tp.filter(t => !t || typeof t.heat !== 'number' || !isFinite(t.heat)).length,
    scars: (op.scars || []).length };

  // 7) 体积与日志
  try { R.saveKB = Math.round(JSON.stringify(p).length / 1024); } catch (e) {}
  R.logLen = (Game.log || []).length;
  R.age = p.age; R.retired = !!p.retired;
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-data-' + Date.now());
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
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(m.error.message)) : q.res(m.result); } };
    const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 120000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 300));
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.advanceDay', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(battery(DAYS), true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    const bad = (out.nan || []).length || (out.range || []).length ||
      Object.keys(out.orphan || {}).length || (out.threads && (out.threads.dup || []).length + (out.threads.badState || []).length) ||
      (out.voice && out.voice.bad) || (out.opinion && out.opinion.topicBad);
    ws.close(); cleanup();
    process.exit(bad ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_DATA_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
