/**
 * 餐食明细的「按菜分组」纯函数。
 *
 * <p>识别返回的是扁平食材列表（`foods[]`，每项带 `dishName` / `role` / `cookMethod`），
 * 因为后端要按食材算营养与升糖负担；但用户看的是「这一顿吃了哪几样菜」。
 * 这一层把扁平列表折成「菜 → 主料 + 配料」，只做展示与统计，不改任何数值。
 *
 * <p>单独放在 utils 里而不是写进页面，是为了能被 `tools/tests` 直接 require 起来跑，
 * 页面里有 `wx`、有 `Page()`，纯逻辑混进去就测不了了。
 */
const UNGROUPED = '未归类'

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function weightOf(item) {
  const weight = item ? Number(item.weightG) : NaN
  return Number.isFinite(weight) && weight > 0 ? weight : null
}

/**
 * 按 `dishName` 分组。
 *
 * @param {Array<Object>} items 识别/编辑中的明细（允许 `dishName` 为空）
 * @returns {Array<Object>} 每组形如
 *   `{ dishName, ungrouped, cookMethod, mains: [], seasonings: [], count, seasoningNames }`
 *
 * 规则：
 * - `dishName` 为空（老客户端、或用户手工加的食材）归到「未归类」，不静默丢；
 * - `role === 'SEASONING'` 进 `seasonings`，其余（含老数据的空 role）按主料处理 ——
 *   宁可按主料展示，也不要让一条食材从界面上消失；
 * - `cookMethod` 取组内第一个非空值（同一道菜的做法只有一个）。
 */
function buildDishGroups(items) {
  const groups = new Map()
  ;(Array.isArray(items) ? items : []).forEach((item) => {
    if (!item) return
    const dishName = textOf(item.dishName) || UNGROUPED
    let group = groups.get(dishName)
    if (!group) {
      group = {
        dishName,
        ungrouped: dishName === UNGROUPED,
        cookMethod: '',
        mains: [],
        seasonings: [],
        count: 0,
        seasoningNames: ''
      }
      groups.set(dishName, group)
    }
    const entry = { foodName: textOf(item.foodName), weightG: weightOf(item) }
    if (!group.cookMethod) group.cookMethod = textOf(item.cookMethod)
    group.count += 1
    if (item.role === 'SEASONING') group.seasonings.push(entry)
    else group.mains.push(entry)
  })
  return Array.from(groups.values()).map((group) => ({
    ...group,
    seasoningNames: group.seasonings.map((entry) => entry.foodName).filter(Boolean).join('、')
  }))
}

module.exports = { UNGROUPED, buildDishGroups }
