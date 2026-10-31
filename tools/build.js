#!/usr/bin/env node
// 构建脚本（措施四）：绿茵生涯.html（唯一真源） + 内联模块 → 产物
// 产物：index.html / 绿茵生涯_单文件版.html / dist/index.html / dist/绿茵生涯.html + dist/build.json
// 用法：node tools/build.js
//
// 【内容放哪里】VOX/NARRA 的语料与剧情单元目前直接写在源文件里（约 6.9k 行）。
// 若将来语料膨胀到需要拆分：把语料移到独立 js，在源文件里写同样的 <script src="xxx.js"></script> 占位，
// 再在下面的 INLINES 里加一行即可——构建会自动内联，产物仍然是单文件。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '绿茵生涯.html');
const HEADER = '<!-- AUTO-GENERATED FROM 绿茵生涯.html — DO NOT EDIT -->';

const INLINES = [
  { tag: '<script src="绿茵生涯_球员数据库.js"></script>', file: '绿茵生涯_球员数据库.js' }
];

let src = fs.readFileSync(SRC, 'utf8');
for (const it of INLINES) {
  if (src.indexOf(it.tag) < 0) throw new Error('源文件缺少内联占位：' + it.tag);
  const code = fs.readFileSync(path.join(ROOT, it.file), 'utf8');
  src = src.split(it.tag).join('<script>\n' + code + '\n</script>');
}

// 安全检查：产物里不能再残留本地 <script src="*.js">，否则 dist 只有一个 html，会 404
const leftover = src.match(/<script[^>]+src="(?!https?:)[^"]+\.js"[^>]*>/gi);
if (leftover) throw new Error('存在未内联的本地脚本，产物会 404：' + leftover.join(' , '));

const product = HEADER + '\n' + src;
const sha = crypto.createHash('sha256').update(product, 'utf8').digest('hex');

const outs = [
  path.join(ROOT, 'index.html'),
  path.join(ROOT, '绿茵生涯_单文件版.html'),
  path.join(ROOT, 'dist', 'index.html'),
  path.join(ROOT, 'dist', '绿茵生涯.html')
];
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
outs.forEach(p => fs.writeFileSync(p, product, 'utf8'));

const meta = {
  BUILD_ID: (fs.readFileSync(SRC, 'utf8').match(/const BUILD_ID = '([^']+)'/) || [])[1] || '',
  source: '绿茵生涯.html',
  sourceBytes: Buffer.byteLength(fs.readFileSync(SRC, 'utf8'), 'utf8'),
  productBytes: Buffer.byteLength(product, 'utf8'),
  inlines: INLINES.map(x => x.file),
  sha256: sha,
  builtAt: new Date().toISOString(),
  sourceMtime: fs.statSync(SRC).mtime.toISOString()
};
fs.writeFileSync(path.join(ROOT, 'dist', 'build.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

console.log('构建完成 BUILD=' + meta.BUILD_ID + '  product=' + meta.productBytes + ' bytes  sha=' + sha.slice(0, 12));
