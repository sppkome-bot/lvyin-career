# 发布 6 步 checklist（措施四 · 版本治理）

每次发布按顺序执行，并在下方「发布留痕」追加一行。

1. **改版本号**：`绿茵生涯.html` 的 `BUILD_ID` 与 `sw.js` 的 `BUILD` 同时改成新版本（如 `2026.11.01.1`），两者必须一致。
2. **跑守卫**：`node tools/guard.js` 必须输出「守卫通过」。
3. **跑回归（自动，不必人工游玩）**：`node tools/autocheck.js` 退出码必须为 0；
   - 报告里 `regress.pass === regress.total`（15/15）、`warns === 0`
   - `voice.exactDupRate < 0.08`、`voice.nearPairRate < 0.15`、`voice.quoteDupRate < 0.08`
   - 应急回滚验证：`node tools/autocheck.js "http://127.0.0.1:8788/index.html?dev=1&assert=all&fx=legacy"` 时 T10/T11/T13/T14 必须变红
4. **构建产物**：运行构建脚本（`绿茵生涯.html` + 内联球员数据库 → `index.html` / `绿茵生涯_单文件版.html` / `dist/`）。
5. **查新鲜度**：`node tools/check-freshness.js` 必须输出「产物新鲜且带警告头」。
6. **冒烟**：390×844 与 1280×900 各跑一遍主流程；移动端强刷一次确认新版生效；断网刷新确认出现「离线版本」提示。

## 发布留痕

| 日期 | BUILD_ID | guard | 回归 | 新鲜度 | 冒烟 | 发布人 |
|---|---|---|---|---|---|---|
| 2026-10-31 | 2026.10.31.1 | 通过 | new 15/15；legacy 4 红 | 通过 | 390×844 / 1280×900 通过 | Trae |
