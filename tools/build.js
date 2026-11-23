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
const zlib = require('zlib');

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

// Round 75：构建时把英超 20 队徽章图集（webp → base64）与坐标/主色注入单文件
// R148：图集从「源文件里一行 1.2MB base64」改为「构建期压缩后注入」。
//   - 源文件只留空占位 { img:'' }，源码可读、git diff 干净、直接打开源文件也能跑；
//   - 产物的图集文本 gzip + base64 后约 0.9MB，运行期同步解压一次（约 10ms），
//     省下的是首屏下载体积与浏览器解析 CJK/Latin 大字符串的开销。
let atlasStats = { raw: 0, packed: 0, gz: false };
(function injectBadges() {
  const dir = path.join(ROOT, 'assets', 'badges');
  const atlasPath = path.join(dir, 'badges.json');
  if (!fs.existsSync(atlasPath)) return;
  const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
  const teams = JSON.parse(fs.readFileSync(path.join(dir, 'teams.json'), 'utf8')).teams || [];
  const map = {}, colors = {};
  // Round 77：alias[id] → 母队 id，取坐标先查 alias 再查主表（青年队不再整批落兜底）
  const resolve = id => {
    const direct = atlas.badges && atlas.badges[id];
    if (direct && !(atlas.fallback && atlas.fallback[id])) return direct;
    const parent = atlas.alias && atlas.alias[id];
    const up = parent && atlas.badges && atlas.badges[parent];
    if (up && !(atlas.fallback && atlas.fallback[parent])) return up;
    return null;
  };
  teams.forEach(t => {
    const c = resolve(t.id);
    // 全量图集里 fallback[id]=true 是占位格，不能算真徽章：留给 CSS 兜底色块
    if (c) { map[t.nameZh] = c; if (t.primaryColor) colors[t.nameZh] = t.primaryColor; }
  });
  console.error('[badges] teams=' + teams.length + ' mapped=' + Object.keys(map).length + ' alias=' + Object.keys(atlas.alias || {}).length);
  const img = 'data:image/webp;base64,' + fs.readFileSync(path.join(dir, atlas.image || 'badges.webp')).toString('base64');
  const data = JSON.stringify({ cell: atlas.cell, cols: atlas.cols, rows: atlas.rows || 1, img, teams: map, colors });
  // R148：只压「坐标表 + 主色表」（JSON/中文，压缩率高），base64 图片本身已是压缩数据，
  // 再 gzip 只会因为 base64 的 6bit 熵而变成 1:1，白付一次解压开销（实测 893886 → 893704）。
  const meta = JSON.stringify({ cell: atlas.cell, cols: atlas.cols, rows: atlas.rows || 1, teams: map, colors });
  const gz = zlib.gzipSync(Buffer.from(meta, 'utf8'), { level: 9 });
  const packed = gz.toString('base64');
  const plainImg = img;
  atlasStats = { raw: data.length, packed: plainImg.length + packed.length, metaRaw: meta.length, metaPacked: packed.length, gz: true };
  const loader = '/*BADGE_ATLAS_START*/{cell:' + atlas.cell + ',cols:' + atlas.cols + ',rows:' + (atlas.rows || 1) +
    ',img:"' + plainImg + '",teams:{},colors:{},__metaGz:"' + packed + '"}/*BADGE_ATLAS_END*/';
  const re = /\/\*BADGE_ATLAS_START\*\/[\s\S]*?\/\*BADGE_ATLAS_END\*\//;
  if (!re.test(src)) throw new Error('源文件缺少徽章图集占位');
  src = src.replace(re, () => loader);
  console.error('[badges] meta ' + meta.length + ' → ' + packed.length + ' bytes (gzip+base64)');
})();

// 安全检查：产物里不能再残留本地 <script src="*.js">，否则 dist 只有一个 html，会 404
const leftover = src.match(/<script[^>]+src="(?!https?:|\/_vercel\/)[^"]+\.js"[^>]*>/gi);
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
