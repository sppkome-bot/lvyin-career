#!/usr/bin/env node
/**
 * 手打场景链路探测（批次 3b）：直接驱动 triggerMatchScene → resolveScene → endMatch。
 *   node tools/probe-scene-flow.js [场数]    默认 4
 * 绕过半场/换人/场边演出，只验证「场景模板 → 成功率 → 结算 → 终场数据」这条主链。
 * 点球与受伤场景改成普通场景（它们各自有独立小游戏，另测）。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const N = Number(process.argv[2] || 4);
const SERVE_PORT = 8794, CDP_PORT = 9338;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const battery = (n, strong) => `(async () => {
  const R = { runs: 0, errors: [], matches: [], warnings: [] };
  if (!Game.player) { quickStart(); Game.player.youth = Game.player.youth || {}; Game.player.youth.signed = true; startGame(); }
  const p = Game.player;
  if (${strong}) {
    try {
      Object.keys(p.attrs || {}).forEach(k => { p.attrs[k] = 18; });
      p.condition.sharpness = 92; p.condition.fitness = 92; p.condition.morale = 92; p.condition.stress = 10;
    } catch (e) {}
  }
  if (!Game.season) {
    try { p.age = 18; p.stats.club = { name: '阿森纳', leagueKey: 'epl', league: '英超', level: 82, coach: '阿尔特塔' }; Game.season = null; ensureSeason(true); }
    catch (e) { R.errors.push('setup-season ' + String(e && e.message || e).slice(0, 60)); }
  }
  const RESET = ['currentEvent','p2ArcScene','seasonStoryScene','immersiveScene','p2NpcScene','p2ClubScene',
    'p2PressEvent','p2VowScene','echoScene','fanScene','stageMoment','p2Press','wcBuild','euroScene',
    'familyScene','p2CoachNews','p2EndorseOffer','p2MediaScene','textLive','pendingScene','postMatchResult','currentScene','lastEffects'];

  for (let i = 0; i < ${n}; i++) {
    const rec = { i: i };
    try {
      let guard = 0;
      while (typeof leagueMatchDue === 'function' && !leagueMatchDue() && guard++ < 40) {
        advanceDay();
        RESET.forEach(k => { try { Game[k] = null; } catch (e) {} });
        Game.currentMatch = null;
        if (Game.pendingRenewal) Game.pendingRenewal = false;
      }
      triggerMatch();
      const m = Game.currentMatch;
      if (!m) { R.errors.push('#' + i + ' 未创建比赛'); continue; }

      const appsBefore = (p.stats.season && p.stats.season.appearances) || 0;
      m.scenes = [];
      buildMatchScenes();
      const total = m.scenes.length;
      rec.scenes = total;
      rec.friendly = !!m.friendly;

      for (const sc of m.scenes) {
        m.minute = sc.minute;
        if (sc.type === 'penalty' || sc.type === 'injury' || !sc.type) sc.type = 'attack';
        Game.currentScene = { scene: sc };
        triggerMatchScene(sc);
        if (Game.currentScene && Game.currentScene.template) resolveScene(0);
      }
      endMatch();
      RESET.forEach(k => { try { Game[k] = null; } catch (e) {} });

      const appsAfter = (p.stats.season && p.stats.season.appearances) || 0;
      const myGoals = m.isHome ? m.score.home : m.score.away;
      rec.score = m.score.home + '-' + m.score.away;
      rec.isHome = !!m.isHome;
      rec.playerGoals = m.playerGoals; rec.playerAssists = m.playerAssists;
      rec.minutes = m.playerMinutes; rec.red = m.redCards || 0; rec.yellow = m.yellowCards || 0;
      rec.appsDelta = appsAfter - appsBefore;
      rec.over = !!m.over;

      if (!Number.isFinite(m.score.home) || !Number.isFinite(m.score.away)) R.errors.push('#' + i + ' 比分非数字');
      if (m.score.home < 0 || m.score.away < 0) R.errors.push('#' + i + ' 比分为负');
      if (m.playerGoals > myGoals) R.errors.push('#' + i + ' 个人进球(' + m.playerGoals + ')超过全队(' + myGoals + ')');
      if (!m.over) R.warnings.push('#' + i + ' endMatch 未置 over');
      if (m.friendly && rec.appsDelta !== 0) R.errors.push('#' + i + ' 友谊赛计入出场');
      if (!m.friendly && rec.minutes > 0 && rec.appsDelta !== 1) R.errors.push('#' + i + ' 联赛出场数异常 ' + rec.appsDelta);

      R.matches.push(rec); R.runs++;
      Game.currentMatch = null;
    } catch (e) {
      R.errors.push('#' + i + ' ' + String(e && e.message || e).slice(0, 140));
      try { Game.currentMatch = null; } catch (x) {}
    }
  }
  R.seasonRound = Game.season && Game.season.round;
  R.appearances = p.stats.season && p.stats.season.appearances;
  R.nan = [];
  (function walk(o, path, d) { if (d > 5 || o === null || o === undefined || R.nan.length > 10) return;
    if (typeof o === 'number') { if (!isFinite(o)) R.nan.push(path); return; }
    if (typeof o !== 'object') return;
    if (Array.isArray(o)) { o.slice(0, 20).forEach((v, i) => walk(v, path + '[' + i + ']', d + 1)); return; }
    Object.keys(o).slice(0, 40).forEach(k => walk(o[k], path + '.' + k, d + 1)); })(p, 'p', 0);
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-scene-' + Date.now());
  const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + CDP_PORT,
    'http://127.0.0.1:' + SERVE_PORT + '/index.html?dev=1&fx=new'], { stdio: 'ignore' });
  const cleanup = () => {
    try { browser.kill(); } catch (e) {}
    // Windows 下只 kill 父进程会留下渲染子进程，累积多了会把机器拖慢；按进程树强制清理
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
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 120000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 300));
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.triggerMatch', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(battery(N, process.argv[3] === 'strong'), true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.errors.length ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_SCENE_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
