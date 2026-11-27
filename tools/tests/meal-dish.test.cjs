// 餐食「按菜分组」：扁平食材列表 → 菜 / 主料 + 配料（纯展示，不改数值）
const assert = require('assert')
const { buildDishGroups, UNGROUPED } = require('../../utils/meal-dish')

// 1) 同一道菜的主料归一组，配料单独收集，做法取组内第一个非空值
const oneDish = buildDishGroups([
  { foodName: '青椒', dishName: '青椒炒肉', role: 'MAIN', cookMethod: '炒', weightG: 60 },
  { foodName: '猪肉', dishName: '青椒炒肉', role: 'MAIN', cookMethod: '炒', weightG: 80 },
  { foodName: '葱', dishName: '青椒炒肉', role: 'SEASONING', weightG: 5 },
  { foodName: '姜', dishName: '青椒炒肉', role: 'SEASONING', weightG: 3 }
])
assert.strictEqual(oneDish.length, 1)
assert.strictEqual(oneDish[0].dishName, '青椒炒肉')
assert.strictEqual(oneDish[0].cookMethod, '炒')
assert.deepStrictEqual(oneDish[0].mains.map((entry) => entry.foodName), ['青椒', '猪肉'])
assert.deepStrictEqual(oneDish[0].seasonings.map((entry) => entry.foodName), ['葱', '姜'])
assert.strictEqual(oneDish[0].seasoningNames, '葱、姜')
assert.strictEqual(oneDish[0].count, 4)

// 2) 不同菜各成一组，顺序保持识别顺序（用户改重量时列表不能跳动）
const twoDishes = buildDishGroups([
  { foodName: '米饭', role: 'MAIN', cookMethod: '蒸', weightG: 150 },
  { foodName: '毛豆', dishName: '毛豆炒肉丁', role: 'MAIN', cookMethod: '炒', weightG: 30 },
  { foodName: '猪肉', dishName: '毛豆炒肉丁', role: 'MAIN', cookMethod: '炒', weightG: 40 }
])
assert.deepStrictEqual(twoDishes.map((group) => group.dishName), [UNGROUPED, '毛豆炒肉丁'])

// 3) 没有 dishName 的老数据归到「未归类」，不能被丢掉
assert.strictEqual(twoDishes[0].ungrouped, true)
assert.strictEqual(twoDishes[0].mains.length, 1)

// 4) role 缺失或非法一律按主料展示（宁可按主料，也不让食材从界面上消失）
const legacy = buildDishGroups([{ foodName: '胡萝卜', dishName: '', role: '', weightG: 10 }])
assert.strictEqual(legacy[0].mains.length, 1)
assert.strictEqual(legacy[0].seasonings.length, 0)

// 5) 重量非法/缺失记 null（由页面显示「重量待确认」），不做 0 处理
const weird = buildDishGroups([{ foodName: '海带', dishName: '凉拌海带', role: 'MAIN', weightG: 'abc' }])
assert.strictEqual(weird[0].mains[0].weightG, null)

// 6) 空输入返回空数组（识别失败/空态时页面不该崩）
assert.deepStrictEqual(buildDishGroups([]), [])
assert.deepStrictEqual(buildDishGroups(null), [])

console.log('meal-dish grouping tests passed')
