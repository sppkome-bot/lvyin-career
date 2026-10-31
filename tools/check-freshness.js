#!/usr/bin/env node
// 措施四 · 产物新鲜度检查：dist/build.json 必须对应当前源文件
const fs=require('fs');
const crypto=require('crypto');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const src=path.join(ROOT,'绿茵生涯.html');
const metaPath=path.join(ROOT,'dist','build.json');
if(!fs.existsSync(metaPath)){ console.error('✗ dist/build.json 不存在，请先运行构建'); process.exit(1); }
const meta=JSON.parse(fs.readFileSync(metaPath,'utf8'));
const now=fs.statSync(src).mtime.toISOString();
const buildId=(fs.readFileSync(src,'utf8').match(/const BUILD_ID = '([^']+)'/)||[])[1]||'';
let bad=0;
if(meta.sourceMtime!==now){ console.error('✗ 源文件已修改（'+now+' > '+meta.sourceMtime+'），产物过期'); bad++; }
if(meta.BUILD_ID!==buildId){ console.error('✗ BUILD_ID 不一致（产物 '+meta.BUILD_ID+' / 源 '+buildId+'）'); bad++; }
const product=path.join(ROOT,'dist','绿茵生涯.html');
if(!fs.existsSync(product)){ console.error('✗ dist/绿茵生涯.html 不存在'); bad++; }
else{
  const sha=crypto.createHash('sha256').update(fs.readFileSync(product,'utf8')).digest('hex');
  if(sha!==meta.sha256){ console.error('✗ 产物哈希与 build.json 不一致'); bad++; }
  const first=fs.readFileSync(product,'utf8').split('\n')[0];
  if(!/^<!-- AUTO-GENERATED FROM/.test(first)){ console.error('✗ 产物缺少只读警告头'); bad++; }
}
console.log(bad?'产物过期/不一致':'产物新鲜且带警告头',meta.BUILD_ID);
process.exit(bad?1:0);
