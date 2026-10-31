# CHANGELOG

> 规范（措施四 · §5.3）：每条必须带「影响面 / 回归用例 / 行为变化」。
> 玩家可感知的变化必须单独放进「变更（需产品确认）」，不允许混在修复里。

## 2026-10-31 · BUILD 2026.10.31.1 · 五项根治措施

### 修复

- [D2] 剧情 `refereeRelation` 写入顶层无效字段 → 改为 `relationships.referee`
  - 影响面：所有剧情弧 / 亚洲弧 / 沉浸事件
  - 回归用例：T11
  - 行为变化：无（原本就是丢失）
- [D4] 事件路径只认 `coachTrust`，选项里的 `coach` 被静默丢弃 → 别名归一
  - 影响面：随机事件库中所有写 `coach` 的选项
  - 回归用例：T13
  - 行为变化：无（原本就是丢失）
- [D8] 剧情弧没有 `board` 键 → 补进规范键
  - 影响面：剧情弧 / 沉浸事件中写 `board` 的选项
  - 回归用例：T13
  - 行为变化：无（原本就是丢失）
- [D6] 缺字段时 `clamp(undefined+5)` 产生 NaN → 写入器统一补默认值
  - 影响面：`condition.*` 全部字段
  - 回归用例：T14
  - 行为变化：无（原本是 NaN 污染）
- [D7] `mediaApproval` 语义错位 → 保留别名并规范为 `fanFromMedia`
  - 影响面：事件路径
  - 回归用例：T13
  - 行为变化：无（等价迁移）
- [措施一] `applyEffects` 成为唯一写入器，8 套结算器改为委托
  - 影响面：场景 / 事件 / 弧 / 赛季 / 发布会 / 声音 / 结局 / 沉浸
  - 回归用例：T10–T14
  - 行为变化：见下方「变更」节
- [措施二] 不变量断言 A01–A17 + 5 个检查点
  - 影响面：写入器出口、存档入口、`p2Ensure`、每周结算、读档完成
  - 回归用例：T04/T06/T07/T10–T14
  - 行为变化：无（生产只写 `Game.diag`）
- [措施三] 内置 15 条回归用例（`?dev=1` 下 `window.__regress`）
  - 影响面：仅开发模式，不进入发布包逻辑路径
  - 回归用例：T01–T15
  - 行为变化：无
- [T01] 友谊赛仍会生成赛后声音 → `addVoiceEntry` 加 `m.friendly` 守卫
  - 影响面：友谊赛赛后流程
  - 回归用例：T01
  - 行为变化：友谊赛不再出现「赛后声音」卡片（见「变更」节）
- [T02] 未出场语料不得出现「评分 / {r}」
  - 影响面：板凳球员赛后声音
  - 回归用例：T02
  - 行为变化：无（现有语料已满足）
- [T03] 点球大战后 `voiceId` 标题同步
  - 影响面：点球大战结算
  - 回归用例：T03
  - 行为变化：无
- [T04] 青训期成年弧拦截
  - 影响面：青训梯队
  - 回归用例：T04
  - 行为变化：无
- [T05] 存档停在剧情场景 → 读档恢复
  - 影响面：`p2ArcScene` / 挂起场景
  - 回归用例：T05
  - 行为变化：无
- [T06] 事件结算后再存档不重放
  - 影响面：`resolveEvent` / `saveGame`
  - 回归用例：T06
  - 行为变化：无
- [T07] 周统计跨周重置
  - 影响面：事件调度
  - 回归用例：T07
  - 行为变化：无
- [T08] 事件 30 天冷却
  - 影响面：事件调度
  - 回归用例：T08
  - 行为变化：无
- [T09] 合同剩 1 年才允许谈续约
  - 影响面：合同系统
  - 回归用例：T09
  - 行为变化：无
- [T15] 同一周 `p2Weekly` 最多开启一次剧情
  - 影响面：周结算调度
  - 回归用例：T15
  - 行为变化：见「变更」节
- [措施四] `BUILD_ID` 与 `sw.js` `BUILD` 对齐，缓存名升级为 `lvyin-pwa-<BUILD>`；新增「有新版本」提示与离线兜底页
  - 影响面：PWA 更新链路
  - 回归用例：A15
  - 行为变化：弱网/离线不再长期停留在旧缓存
- [措施四] 产物统一带 `<!-- AUTO-GENERATED ... -->` 警告头，输出到 `dist/`，新增 `dist/build.json` 与新鲜度检查
  - 影响面：构建与发布
  - 回归用例：`node tools/check-freshness.js`
  - 行为变化：无
- [措施五] 新增 `tools/guard.js`、`tools/guard-baseline.json`、`tools/patch-template.md`
  - 影响面：AI 交接与提交前自检
  - 回归用例：guard 自检
  - 行为变化：无

### 变更（需产品确认）

- [D1] 沉浸事件 `social` 从 ×4 恢复为 ×2
  - 影响面：`applyImmEffect` 全部事件
  - 回归用例：T10
  - 确认人：待产品确认
- [D3] `reputation` 倍率参数化（`repScale`）：剧情弧默认 0.5、事件默认 1.0，与旧行为一致
  - 影响面：所有写 `reputation` 的选项
  - 回归用例：T12
  - 确认人：无需确认（默认值未变）
- [T01] 友谊赛不再生成「赛后声音」卡片
  - 影响面：友谊赛赛后流程
  - 回归用例：T01
  - 确认人：待产品确认
- [T15] 同一周重复调用 `p2Weekly` 不再二次弹剧情
  - 影响面：周结算调度
  - 回归用例：T15
  - 确认人：待产品确认
- `FX_MODE` 默认 `new`；应急回滚可执行 `localStorage.fxMode='legacy'`（设置页长按版本号 5 次）
  - 影响面：全部结算器
  - 回归用例：legacy 模式下 T10/T11/T13/T14 变红
  - 确认人：待产品确认

### 已知偏差

- 施工图以 `index.html`（61,838 行）为目标；本仓库可编辑真源是 `绿茵生涯.html`（约 37,600 行），`index.html` 为内联数据库后的构建产物。所有改造落在真源，构建产物由脚本生成。
- 回归 fixture 采用内存构造（`setup/steps`），未落 `fixtures/*.json`，避免随机数造成假失败；`capture(id)` 可随时导出白名单快照。

---

## 2026-10-31 · 补丁：重复结算与声望倍率（重出包，BUILD 仍为 2026.10.31.1）

### 修复

- **[P0] 5 处重复结算**，效果被加 2~3 次：
  - `wcBuildChoice`：`applyEffects` 连调两次 + 手动补 `teammate` → 全部 ×2、队友 ×3
  - `euroSceneChoice`：同上，且 `adapt`/`culture` 手动 + 写入器各加一次 → ×2；money/media ×2、队友 ×3
  - `p2ClubSceneChoice`：连调两次 + 手动补 `board` → board ×3、money ×3
  - `p2MatchHookAction`：连调两次 → ×2、队友 ×3
  - `p2NpcSceneChoice`：`applyEffects` 全量结算后 `p2ApplyArcEffects(extra)` 又结算一遍 → reputation/media/fanApproval/morale ×2
  - 影响面：上述 5 个场景的全部选项
  - 回归用例：T10–T14（切 `legacy` 时应变红）
  - 行为变化：**是**（回到设计值）

- **[P0] `applyImmEffect` 声望倍率丢失**：新路径未传 `repScale`（默认 1），旧路径经 `p2ApplyArcEffects` 是 0.5 → 沉浸事件声望翻倍。已补 `repScale:0.5`。
  - 影响面：`IMM_EURO_EVENTS` / `IMM_ASIA_EVENTS`
  - 回归用例：T10（social）+ 手工核对声望
  - 行为变化：**是**（回到减半）

### 工具

- `tools/guard.js` 新增 **规则 5**：同一处连续两次 `applyEffects(p, ...)` 判失败
- `tools/guard.js` 统计改为"等长空白遮罩"：legacy 块与 REGRESS 块不计数，且**行号与偏移保持不变**（规则 5 能定位到真实行）
- `tools/build.js` 补上构建脚本：`绿茵生涯.html` + 内联 `绿茵生涯_球员数据库.js` → `index.html` / `绿茵生涯_单文件版.html` / `dist/index.html` / `dist/绿茵生涯.html` + `dist/build.json`
- 校验结果：`guard` 7/7 通过、`check-freshness` 通过、内联脚本语法检查 3 blocks / 0 error

### 注意

- 本次改动落在真源 `绿茵生涯.html`，并重新生成了全部产物；**直接编辑 `index.html` 会在下次构建时被覆盖**。

- **[P0] `narrApplyEffects` 双重结算**：函数先对 `reputation/fan/media/coach/teammate/social` 做 `fxBump` 封顶，随后又调 `applyEffects(p,e,...)` 把同一组键再加一遍 → 剧情单元效果约 ×2（声望还叠了两套封顶）。
  - 修复：改为"先逐键封顶 → 只调一次 `applyEffects`"，`social` 统一按 `socialScale=2` 生效
  - 影响面：全部 NARR 单元（32 个）与十个体裁
  - 回归用例：`?dev=1` 下 `__regress` 全绿 + 手工抽一个 CASE 单元核对数值
  - 行为变化：**是**（回到设计值）

### 决定（2026-10-31）

- **`FX_MODE` 保持 `new`，不切 `shadow`**：legacy 分支仍带 D1（social ×4）与 D2（referee 写错字段）两个已知 bug，切 shadow 等于继续让 legacy 生效、只多打日志。回滚入口保留：`localStorage.fxMode='legacy'`。
- **VOX/NARRA 语料与剧情单元继续内联在真源**（当前约 6.9k 行）：`tools/build.js` 已改为支持多内联模块（`INLINES` 数组），并在构建时检查"未内联的本地 `<script src>`"；将来把语料拆成独立 js，只需在 `INLINES` 加一行、源文件保留同样的占位标签。

