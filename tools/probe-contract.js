#!/usr/bin/env node
/**
 * 合同 / 转会 / 红牌 / 受伤 动态探测（批次 3c + 4）
 *   node tools/probe-contract.js
 * 每一项独立 try/catch，失败只记该项，不中断其余检查。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVE_PORT = 8796, CDP_PORT = 9339;
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
  const p = Game.player;
  if (!Game.season) {
    try { p.age = 18; p.stats.club = { name: '阿森纳', leagueKey: 'epl', league: '英超', level: 82, coach: '阿尔特塔' }; Game.season = null; ensureSeason(true); } catch (e) { R.errors.push('season ' + e.message); }
  }

  ck('C1', '合同剩 2 年不能谈续约', () => {
    p.contract = { club: '阿森纳', wage: 1000, years: 2, until: Game.date.year + 2, signingBonus: 0 };
    p.renewalOffer = null; ensureContractState(p);
    beginRenewal();
    return { ok: p.renewalOffer === null, detail: 'offer=' + (p.renewalOffer ? 'created' : 'null') };
  });

  ck('C2', '合同剩 1 年可以谈续约', () => {
    p.contract.until = Game.date.year + 1; p.renewalOffer = null;
    beginRenewal();
    return { ok: !!p.renewalOffer, detail: p.renewalOffer ? ('wage=' + p.renewalOffer.wage) : 'null' };
  });

  ck('C3', '接受续约后合同字段更新', () => {
    const o = p.renewalOffer;
    if (!o) return { ok: false, detail: 'no offer' };
    acceptRenewal();
    return { ok: p.weeklySalary === o.wage && p.contract.until === Game.date.year + o.years && p.renewalOffer === null,
      detail: 'wage=' + p.weeklySalary + ' until=' + p.contract.until };
  });

  ck('C4', '报价撤回后只能签降薪短约', () => {
    p.contract.until = Game.date.year + 1; p.renewalOffer = null;
    beginRenewal();
    if (!p.renewalOffer) return { ok: false, detail: 'no offer' };
    p.renewalOffer.withdrawn = true;
    const base = p.renewalOffer.wage;
    acceptRenewal(true);
    return { ok: p.contract.years === 1 && p.weeklySalary === Math.round((base * 0.9) / 100) * 100,
      detail: 'years=' + p.contract.years + ' wage=' + p.weeklySalary };
  });

  ck('C5', '拒绝续约置 renewalRefused 且不能立刻反悔', () => {
    p.contract.until = Game.date.year + 2; p.renewalOffer = null;
    refuseRenewal();
    const refused = !!(p.contract && p.contract.renewalRefused);
    beginRenewal();
    return { ok: refused && p.renewalOffer === null, detail: 'refused=' + refused };
  });

  ck('C6', '解约金：董事会信任低时被拒', () => {
    p.contract = { club: '阿森纳', wage: 1000, years: 1, until: Game.date.year + 1, signingBonus: 0, releaseClause: 0 };
    p.clubStory = p.clubStory || {}; p.clubStory.boardTrust = 40; p.reputation = 50;
    setReleaseClause();
    return { ok: (p.contract.releaseClause || 0) === 0, detail: 'clause=' + (p.contract.releaseClause || 0) };
  });

  ck('C7', '解约金：董事会信任足够时写入', () => {
    p.clubStory.boardTrust = 80;
    setReleaseClause();
    return { ok: (p.contract.releaseClause || 0) > 0, detail: 'clause=' + (p.contract.releaseClause || 0) };
  });

  ck('C8', '自由球员：生成 3 份报价', () => {
    startFreeAgency(p);
    const n = (p.freeAgentOffers || []).length;
    return { ok: p.freeAgent === true && n === 3, detail: 'offers=' + n };
  });

  ck('C9', '自由球员签约后合同完整', () => {
    const o = (p.freeAgentOffers || [])[0];
    if (!o) return { ok: false, detail: 'no offers' };
    signFreeAgent(0);
    const c = p.contract || {};
    return { ok: p.freeAgent === false && c.club === o.club.name && c.until === Game.date.year + o.years && p.weeklySalary === o.wage,
      detail: c.club + ' until=' + c.until };
  });

  ck('C10', '红牌：两黄变红会立即离场', () => {
    const m = { isHome: true, friendly: false, score: { home: 0, away: 0 }, playerGoals: 0, playerAssists: 0,
      yellowCards: 1, redCards: 0, scenes: [{ minute: 30 }], sceneIdx: 0, minute: 30, stats: {}, crowd: 50, oppStrength: 70 };
    Game.currentMatch = m;
    try { ensureMatchExtras(m); } catch (e) {}
    Game.currentScene = { scene: m.scenes[0], template: { options: [{ penalty: 'yellow', difficulty: 6, success: 'ok', fail: 'bad', successEff: {}, failEff: {} }] } };
    let got = false;
    for (let i = 0; i < 30 && !got; i++) {
      try { resolveScene(0, 'fail'); } catch (e) { return { ok: false, detail: 'EXC ' + String(e.message).slice(0, 60) }; }
      got = (m.redCards || 0) >= 1;
    }
    return { ok: got && m.sentOff === true && m.playerMinutes === m.minute,
      detail: 'red=' + (m.redCards || 0) + ' sentOff=' + m.sentOff + ' min=' + m.playerMinutes };
  });

  ck('C11', '受伤换人：离场并记伤停', () => {
    const m = { isHome: true, friendly: false, score: { home: 0, away: 0 }, playerGoals: 0, playerAssists: 0,
      yellowCards: 0, redCards: 0, scenes: [{ minute: 30 }, { minute: 60 }], sceneIdx: 0, minute: 30, stats: {}, crowd: 50, oppStrength: 70 };
    Game.currentMatch = m; p.injury = null;
    try { ensureMatchExtras(m); } catch (e) {}
    showMatchInjuryChoice();
    matchInjuryChoice('sub');
    return { ok: !!p.injury && m.subbedOff === true && m.playerMinutes === m.minute && m.sceneIdx === m.scenes.length,
      detail: 'inj=' + (p.injury && p.injury.type) + ' min=' + m.playerMinutes };
  });

  ck('C12', '受伤坚持：playThrough 会在赛后转正常伤停', () => {
    const m = { isHome: true, friendly: false, score: { home: 0, away: 0 }, playerGoals: 0, playerAssists: 0,
      yellowCards: 0, redCards: 0, scenes: [{ minute: 20 }, { minute: 70 }], sceneIdx: 0, minute: 20, stats: {}, crowd: 50, oppStrength: 70 };
    Game.currentMatch = m; p.injury = null;
    try { ensureMatchExtras(m); } catch (e) {}
    showMatchInjuryChoice();
    matchInjuryChoice('stay');
    const pt = !!(p.injury && p.injury.playThrough);
    try { endMatch(); } catch (e) { return { ok: false, detail: 'endMatch EXC ' + String(e.message).slice(0, 50) }; }
    const cleared = !(p.injury && p.injury.playThrough);
    return { ok: pt && cleared, detail: 'playThrough=' + pt + ' cleared=' + cleared };
  });

  R.pass = R.checks.filter(c => c.ok).length;
  R.total = R.checks.length;
  return JSON.stringify(R);
})()`;

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(SERVE_PORT)], { stdio: 'ignore' });
  const profile = path.join(os.tmpdir(), 'lvyin-contract-' + Date.now());
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
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, timeout: 90000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 300));
      return r.result && r.result.value;
    };
    for (let i = 0; i < 80; i++) { try { if (await evalJs('!!window.beginRenewal', false)) break; } catch (e) {} await sleep(250); }
    const out = JSON.parse(await evalJs(BATTERY, true));
    out.runtime = ver.Browser;
    console.log(JSON.stringify(out, null, 1));
    ws.close(); cleanup();
    process.exit(out.checks.some(c => !c.ok) ? 1 : 0);
  } catch (e) { cleanup(); console.error('PROBE_CONTRACT_FAILED: ' + (e && e.message || e)); process.exit(2); }
})();
