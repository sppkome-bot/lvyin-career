#!/usr/bin/env node
/**
 * 比赛流程探测（批次 3）：走「文字直播」完整链路，重复 N 场。
 *   node tools/probe-match.js [场数]     默认 12
 * 检查：每场都能创建→模拟→结算；赛季轮次推进；声音只写一次；不残留 currentMatch；首发/替补分钟合理。
 * 退出码 0 = 无异常。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const N = Number(process.argv[2] || 12);
const SERVE_PORT = 8792, CDP_PORT = 9337;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
async function waitJson(u, n = 60) { for (let i = 0; i < n; i++) { try { return JSON.parse(await get(u)); } catch (e) { await sleep(250); } } throw new Error('CDP 未就绪'); }

const battery = n => `(async () => {
  const R = { runs: 0, errors: [], matches: [], warnings: [] };
  if (!Game.player) { quickStart(); Game.player.youth = Game.player.youth || {}; Game.player.youth.signed = true; startGame(); }
  const p = Game.player;
  // 青训期没有联赛赛季（Game.season 为 null，所有比赛都是友谊赛）。
  // 为了让联赛链路可测，这里合成一个成年队环境（探针专用，不改游戏逻辑）。
  if (!Game.season) {
    try {
      p.age = 18;
      p.stats.club = { name: '阿森纳', leagueKey: 'epl', league: '英超', level: 82, coach: '阿尔特塔' };
      Game.season = null;
      ensureSeason(true);
    } catch (e) { R.errors.push('setup-season ' + String(e && e.message || e).slice(0, 60)); }
  }
  R.setup = { season: !!Game.season, league: Game.season && Game.season.leagueName,
    rounds: Game.season && Game.season.rounds ? Game.season.rounds.length : 0, age: p.age };
  const RESET = ['currentEvent','p2ArcScene','seasonStoryScene','immersiveScene','p2NpcScene','p2ClubScene',
    'p2PressEvent','p2VowScene','echoScene','fanScene','stageMoment','p2Press','wcBuild','euroScene',
    'familyScene','p2CoachNews','p2EndorseOffer','p2MediaScene','textLive','pendingScene','postMatchResult'];

  for (let i = 0; i < ${n}; i++) {
    const rec = { i: i };
    try {
      // 先把日期推到联赛比赛日，才能真正测到联赛链路（否则全是友谊赛）
      let guard = 0;
      while (typeof leagueMatchDue === 'function' && !leagueMatchDue() && guard++ < 40) {
        advanceDay();
        RESET.forEach(k => { try { Game[k] = null; } catch (e) {} });
        Game.currentMatch = null;
        if (Game.pendingRenewal) Game.pendingRenewal = false;
        if (Game.pendingFreeAgent) Game.pendingFreeAgent = false;
      }
      rec.daysAdvanced = guard;

      const roundBefore = (Game.season && Game.season.round) || 0;
      const archBefore = (p.voices && p.voices.archive ? p.voices.archive.length : 0);
      const appsBefore = (p.stats.season && p.stats.season.appearances) || 0;
      const tbl = Game.season && Game.season.table;
      const row0 = tbl && tbl[p.stats.club.name];
      const pts0 = row0 ? row0.pts : null;

      triggerMatch();
      const m = Game.currentMatch;
      if (!m) { R.errors.push('#' + i + ' triggerMatch 未创建比赛'); continue; }
      rec.importance = m.importance; rec.friendly = !!m.friendly;

      startTextLive();
      if (!Game.textLive) { R.errors.push('#' + i + ' 文字直播未启动'); continue; }
      textLiveSkip();
      finishTextLive();

      RESET.forEach(k => { try { Game[k] = null; } catch (e) {} });
      if (Game.currentMatch) { R.errors.push('#' + i + ' 结算后 currentMatch 未清空'); Game.currentMatch = null; }

      const roundAfter = (Game.season && Game.season.round) || 0;
      const archAfter = (p.voices && p.voices.archive ? p.voices.archive.length : 0);
      const appsAfter = (p.stats.season && p.stats.season.appearances) || 0;
      const row1 = tbl && tbl[p.stats.club.name];
      rec.ptsDelta = (pts0 !== null && row1) ? (row1.pts - pts0) : null;

      rec.score = m.score ? (m.score.home + '-' + m.score.away) : '?';
      rec.isHome = !!m.isHome;
      rec.opp = m.oppStrength;
      try { rec.my = playerClubStrength(p); } catch (e) {}
      rec.starter = !!m.isStarter;
      rec.minutes = m.playerMinutes;
      rec.archiveDelta = archAfter - archBefore;
      rec.appsDelta = appsAfter - appsBefore;
      rec.roundDelta = roundAfter - roundBefore;

      if (rec.minutes !== undefined && (rec.minutes < 0 || rec.minutes > 90)) R.warnings.push('#' + i + ' 分钟数异常 ' + rec.minutes);
      if (rec.starter === false && rec.minutes > 0 && rec.minutes < 5) R.warnings.push('#' + i + ' 替补登场分钟过短 ' + rec.minutes);
      if (rec.archiveDelta > 1) R.errors.push('#' + i + ' 单场写入多条声音（' + rec.archiveDelta + '）');
      R.matches.push(rec);
      R.runs++;
    } catch (e) {
      R.errors.push('#' + i + ' ' + String(e && e.message || e).slice(0, 120));
      try { Game.currentMatch = null; Game.textLive = null; } catch (x) {}
    }
  }
  R.seasonRound = Game.season && Game.season.round;
  R.appearances = p.stats.season && p.stats.season.appearances;
  R.goals = p.stats.season && p.stats.season.goals;
  R.archive = p.voices && p.voices.archive ? p.voices.archive.length : 0;
  R.saveKB = Math.round(JSON.stringify(p).length / 1024);
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-match-' + Date.now());
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
    const evalJs = async (expression, awaitPromise) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 120000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 300));
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.triggerMatch', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(battery(N), true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.errors.length ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_MATCH_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
