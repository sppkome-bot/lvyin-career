#!/usr/bin/env node
/**
 * 静态审计：找出“点了没反应 / 静默吞错 / 重复定义 / DOM 断链”这类断点。
 *   node tools/audit.js [源文件]   默认 绿茵生涯.html
 * 退出码 0 = 未发现 P0/P1；1 = 有发现。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '绿茵生涯.html');
const src = fs.readFileSync(file, 'utf8');
const lineOf = idx => src.slice(0, idx).split('\n').length;

const findings = [];
const add = (level, code, msg, line, extra) => findings.push({ level, code, msg, line, extra: extra || null });

// ---------- 1) 重复的顶层函数定义（后者静默覆盖前者）----------
{
  const defs = new Map();
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const n = m[1];
    if (!defs.has(n)) defs.set(n, []);
    defs.get(n).push(lineOf(m.index));
  }
  defs.forEach((lines, n) => {
    if (lines.length > 1) add('P0', 'DUP_FN', '函数重复定义：' + n + '（第 ' + lines.join('、') + ' 行，后者覆盖前者）', lines[1]);
  });
}

// ---------- 2) 内联事件处理器是否指向已定义的函数 ----------
{
  const defined = new Set();
  const reFn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m; while ((m = reFn.exec(src))) defined.add(m[1]);
  const reVar = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = reVar.exec(src))) defined.add(m[1]);
  const reWin = /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = reWin.exec(src))) defined.add(m[1]);
  // 对象方法名也收集一下（避免误报 obj.method 形式）
  const reMethod = /^\s{2}([A-Za-z_$][\w$]*)\s*[:(]/gm;
  while ((m = reMethod.exec(src))) defined.add(m[1]);

  const seen = new Set();
  const reH = /\bon(?:click|change|input|submit|blur|focus|mousedown|touchstart|keydown)\s*=\s*"([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = reH.exec(src))) {
    const n = m[1];
    const key = n + '@' + lineOf(m.index);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!defined.has(n)) add('P0', 'DEAD_HANDLER', '内联事件指向未定义的函数：' + n + '()', lineOf(m.index));
  }
}

// ---------- 3) 空 catch（只做汇总：绝大多数是有意的静默兜底）----------
{
  const re = /catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*\}/g;
  let m, total = 0;
  while ((m = re.exec(src))) total++;
  if (total) add('P3', 'EMPTY_CATCH_SUM', '空 catch 共 ' + total + ' 处（多为 localStorage/音频/Toast 的兜底，仅在追查具体 bug 时逐个看）', 0);
}

// ---------- 4) 重复的 DOM id ----------
{
  const ids = new Map();
  const note = (id, line) => { if (!ids.has(id)) ids.set(id, []); ids.get(id).push(line); };
  let m;
  const reStatic = /\bid="([^"${]+)"/g;
  while ((m = reStatic.exec(src))) note(m[1], lineOf(m.index));
  // 运行期动态创建的 id 也算存在：el.id='x' / el.id = "x"
  const reDynamic = /\.id\s*=\s*['"]([^'"${]+)['"]/g;
  while ((m = reDynamic.exec(src))) note(m[1], lineOf(m.index));
  ids.forEach((lines, id) => {
    if (lines.length > 1) add('P1', 'DUP_ID', 'DOM id 重复：#' + id + '（' + lines.slice(0, 4).join('、') + '）', lines[1]);
  });
  global.__IDS = ids;
}

// ---------- 5) $('id') / getElementById 指向不存在的 id ----------
{
  const ids = global.__IDS || new Map();
  const missing = new Map();
  const reA = /\$\('([^'${]+)'\)/g;
  const reB = /getElementById\('([^'${]+)'\)/g;
  const scan = (re, tag) => {
    let m;
    while ((m = re.exec(src))) {
      const id = m[1];
      if (!id || ids.has(id)) continue;
      if (!missing.has(id)) missing.set(id, { tag, line: lineOf(m.index), n: 0 });
      missing.get(id).n++;
    }
  };
  scan(reA, "$()");
  scan(reB, 'getElementById');
  [...missing.entries()].slice(0, 20).forEach(([id, v]) => {
    add('P1', 'MISSING_ID', '引用了不存在的 id：#' + id + '（' + v.tag + '，首次第 ' + v.line + ' 行，共 ' + v.n + ' 处）', v.line);
  });
  if (missing.size > 20) add('P1', 'MISSING_ID_SUM', '共 ' + missing.size + ' 个悬空 id', 0);
}

// ---------- 6) TODO / FIXME ----------
{
  const re = /\b(TODO|FIXME|XXX|HACK)\b/g;
  let m, n = 0;
  while ((m = re.exec(src))) { n++; if (n <= 8) add('P3', 'TODO', m[1] + ' 标记', lineOf(m.index)); }
  if (n > 8) add('P3', 'TODO_SUM', '待办标记共 ' + n + ' 处', 0);
}

// ---------- 汇总 ----------
const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
findings.sort((a, b) => (order[a.level] - order[b.level]) || (a.line - b.line));
const byLevel = findings.reduce((o, f) => { o[f.level] = (o[f.level] || 0) + 1; return o; }, {});

console.log('审计文件：' + path.basename(file) + '（' + src.split('\n').length + ' 行）');
console.log('统计：' + JSON.stringify(byLevel));
console.log('---');
findings.forEach(f => console.log('[' + f.level + '][' + f.code + '] ' + (f.line ? 'L' + f.line + ' ' : '') + f.msg));

const bad = findings.filter(f => f.level === 'P0' || f.level === 'P1').length;
console.log('---');
console.log(bad ? '发现 P0/P1 共 ' + bad + ' 项' : '未发现 P0/P1');
process.exit(bad ? 1 : 0);
