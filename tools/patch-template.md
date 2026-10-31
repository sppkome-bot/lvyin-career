# AI 补丁交付模板（措施五 · 交接契约）

> 每次让 AI 改 `绿茵生涯.html`，交付必须按本模板输出。缺任何一节视为不合格交付。

## 改了什么
一句话。

## 改动位置
- 绿茵生涯.html:行号 `函数名`

## 改动前
（原样粘贴 5–10 行，含上下文）

## 改动后
（原样粘贴同样范围）

## 保留清单
- [ ] 保留 `if(!eff) return;`
- [ ] 保留 `refereeRelation` 走 `relationships.referee`
- [ ] 保留 `professionalism` 别名
- [ ] 未改动 clamp 上下限
- [ ] 未改动 `Math.random()` 的调用次数与顺序

## 影响面
调用者：`resolveScene`、`applySceneEffects` 的 3 处调用点
可能变化的数值：`condition.*`、`relationships.*`

## 自检
- [ ] `node tools/guard.js` 通过（`applyEffects` 仍唯一、直写不增加）
- [ ] 未新增 `p.fanApproval=clamp` 直写
- [ ] 回归用例 T10–T14 通过（`?dev=1` 下 `__regress.runAll()`）
- [ ] 若产生玩家可感知变化，已写入 `CHANGELOG.md` 的「变更（需产品确认）」

---

## 五条铁律

1. **只打补丁，不重写函数。** 除非函数 <10 行，否则必须给"改动前/改动后"片段，保留未改动部分。
2. **不许删已有注释和 `if` 守卫。** 若认为某个守卫多余，必须单列"我建议删除 X，因为 Y"，由人确认。
3. **不许新增第 6 套结算器。** 任何效果结算必须调 `applyEffects(p, eff, {src})`。
4. **不许改随机调用顺序。** `Math.random()` 的调用次数和顺序变化会改变所有既有存档的后续走向。
5. **必须报告"我保留了什么"。** 每次交付附"保留清单"，逐条列出继承的守卫与注释。
