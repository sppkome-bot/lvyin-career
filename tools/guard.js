#!/usr/bin/env node
// 措施五 · AI 交接契约自检（提交/发布前 30 秒）
// 1) applyEffects 只能定义一次
// 2) 结算器数量不得增加
// 3) fanApproval / relationships.coach 直写不得增加（基线只降不升）
// 4) 源文件的 BUILD_ID 必须与 sw.js 的 BUILD 一致
// 5) 同一处不得连续两次调用 applyEffects（重复结算，曾导致 5 处效果翻倍）
// 用法：node tools/guard.js [源文件]  （默认 绿茵生涯.html＝唯一真源；index.html 是构建产物）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const srcPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '绿茵生涯.html');
const swPath = path.join(ROOT, 'sw.js');
const baselinePath = path.join(__dirname, 'guard-baseline.json');

const raw = fs.readFileSync(srcPath, 'utf8');
// 只统计活跃代码：legacy 实现（//#FX-LEGACY-START/END）与回归用例块（REGRESS BEGIN/END）不计入。
// 用等长空白遮罩而不是删除，保证行号与偏移不变（规则 5 的报错才能定位到真实行）。
function maskBlocks(src, startRe, endRe){
  const lines = src.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (!inBlock && startRe.test(lines[i])) { inBlock = true; continue; }
    if (inBlock && endRe.test(lines[i])) { inBlock = false; continue; }
    if (inBlock) lines[i] = lines[i].replace(/[^\n]/g, ' ');
  }
  return lines.join('\n');
}
const active = maskBlocks(
  maskBlocks(raw, /^\s*\/\/#FX-LEGACY-START/, /^\s*\/\/#FX-LEGACY-END/),
  /REGRESS BEGIN/, /REGRESS END/
);
const count = (re) => (active.match(re) || []).length;

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const now = {
  fanWrite: count(/p\.fanApproval\s*=\s*clamp/g),
  coachWrite: count(/p\.relationships\.coach\s*=\s*clamp/g),
  appliers: count(/function (applySceneEffects|p2ApplyArcEffects|p2PressApply|resolveEvent|applyImmEffect)\(/g),
  fxDefs: count(/function applyEffects\(/g)
};

const buildId = (raw.match(/const BUILD_ID = '([^']+)'/) || [])[1] || '';
const sw = fs.readFileSync(swPath, 'utf8');
const swBuild = (sw.match(/const BUILD = '([^']+)'/) || [])[1] || '';
const swCache = /const CACHE = 'lvyin-pwa-'\s*\+\s*BUILD/.test(sw);

let bad = 0;
function fail(msg) { console.error('✗ ' + msg); bad++; }
function pass(msg) { console.log('✓ ' + msg); }

if (now.fxDefs !== 1) fail('applyEffects 必须恰好定义 1 次（当前 ' + now.fxDefs + '）');
else pass('applyEffects 唯一（1 次）');

if (now.appliers > baseline.appliers) fail('新增了结算器（' + now.appliers + ' > ' + baseline.appliers + '）');
else pass('结算器数量未增加（' + now.appliers + '/' + baseline.appliers + '）');

if (now.fanWrite > baseline.fanWrite) fail('新增了 fanApproval 直写（' + now.fanWrite + ' > ' + baseline.fanWrite + '）');
else pass('fanApproval 直写未增加（' + now.fanWrite + '/' + baseline.fanWrite + '）');

if (now.coachWrite > baseline.coachWrite) fail('新增了 coach 直写（' + now.coachWrite + ' > ' + baseline.coachWrite + '）');
else pass('coach 直写未增加（' + now.coachWrite + '/' + baseline.coachWrite + '）');

if (!buildId) fail('源文件缺少 BUILD_ID');
else if (buildId !== swBuild) fail('BUILD_ID(' + buildId + ') 与 sw.js BUILD(' + swBuild + ') 不一致');
else pass('BUILD_ID 与 sw.js 一致（' + buildId + '）');

if (!swCache) fail('sw.js 未使用 lvyin-pwa-+BUILD 的缓存名');
else pass('sw.js 缓存名随 BUILD 升级');

// 规则 5：同一处连续两次 applyEffects（重复结算）
// 只匹配 applyEffects(p, ...)，不会命中 applyEffectsShadow(p, ...)
(function(){
  const reFx = /applyEffects\(\s*p\s*,/g;
  const idx = [];
  let m;
  while ((m = reFx.exec(active))) idx.push(m.index);
  const hits = [];
  for (let i = 1; i < idx.length; i++) {
    const gap = idx[i] - idx[i - 1];
    // 同一函数内重复调用：两次相隔 < 300 字符（中间通常只隔 1~4 行）
    if (gap < 300) {
      const line = active.slice(0, idx[i]).split('\n').length;
      hits.push(line);
    }
  }
  if (hits.length) fail('疑似重复结算：相邻两次 applyEffects 出现在第 ' + hits.join('、') + ' 行附近');
  else pass('无重复结算（相邻 applyEffects 调用）');
})();

console.log('基线', JSON.stringify(baseline), '实测', JSON.stringify(now));
console.log(bad ? '守卫失败（' + bad + ' 项）' : '守卫通过');
process.exit(bad ? 1 : 0);
