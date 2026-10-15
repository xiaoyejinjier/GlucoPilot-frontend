const test = require('node:test')
const assert = require('node:assert/strict')
const { buildMealDetails } = require('../../utils/meal-details')

test('完整食物、长备注和逐项快照保留，时间去掉 T 和小数秒', () => {
  const foodsText = '米饭150g、清蒸鱼100g、炒青菜200g\n水果半个'
  const detail = buildMealDetails({ foodsText, supplementText: '少油少盐\n饭后散步',
    recordedAt: '2026-10-14T12:03:45.123456', hungerLevel: 3, carbsG: 48.25,
    items: [{ foodName: '米饭', weightG: 150, carbsG: 38.25, caloriesKcal: 180 },
      { foodName: '清蒸鱼', weightG: '100', carbsG: '10', caloriesKcal: '100.5' }]
  }, '2026-10-14')
  assert.equal(detail.foodsText, foodsText)
  assert.equal(detail.supplementText, '少油少盐\n饭后散步')
  assert.equal(detail.recordedAt, '2026-10-14 12:03:45')
  assert.equal(detail.hungerText, '微饿')
  assert.equal(detail.items[0].weightText, '150 g')
  assert.equal(detail.carbsText, '48.3 g')
  assert.equal(detail.caloriesText, '280.5 kcal')
  assert.equal(detail.recordDate, '2026-10-14')
})

test('历史记录只有食物文本也可阅读，缺失数据不伪装成零', () => {
  const detail = buildMealDetails({ foodsText: '米饭、鸡蛋' }, '2026-10-14')
  assert.equal(detail.foodsText, '米饭、鸡蛋')
  assert.deepEqual(detail.items, [])
  for (const key of ['carbsText', 'caloriesText', 'recordedAt']) assert.equal(detail[key], '未记录')
  assert.equal(detail.hungerText, '未填写')
  assert.equal(detail.supplementText, '无')
  assert.equal(detail.mediaUrl, '')
})

test('食物文本为空时按真实快照名称兜底，不调用食品库或预测', () => {
  const detail = buildMealDetails({ items: [{ foodName: '米饭', carbsG: 30, caloriesKcal: 100 },
    { foodName: '豆腐', carbsG: 2, caloriesKcal: 60 }], predictNow: 99 }, '2026-10-14')
  assert.equal(detail.foodsText, '米饭、豆腐')
  assert.equal(detail.carbsText, '32 g')
  assert.equal(detail.caloriesText, '160 kcal')
  assert.equal(Object.hasOwn(detail, 'predictNow'), false)
})

test('部分营养缺失时总量不使用不完整求和，合法零值保留', () => {
  const detail = buildMealDetails({ carbsG: 0, items: [{ foodName: '水', weightG: 200, carbsG: 0, caloriesKcal: 0 },
    { foodName: '未知食物', carbsG: null, caloriesKcal: '' }] }, '2026-10-14')
  assert.equal(detail.carbsText, '0 g')
  assert.equal(detail.caloriesText, '未记录')
  assert.equal(detail.items[0].caloriesText, '0 kcal')
  assert.equal(detail.items[1].carbsText, '未记录')
})

test('非法营养、空白和无效时间明确显示缺失，不造成崩溃', () => {
  for (const invalid of [null, undefined, '', '  ', 'bad', -1, Infinity, true, [], {}]) {
    const detail = buildMealDetails({ carbsG: invalid, items: [null, { weightG: invalid, carbsG: invalid, caloriesKcal: invalid }],
      recordedAt: 'invalid', hungerLevel: 99 }, '2026-10-14')
    assert.equal(detail.carbsText, '未记录')
    assert.equal(detail.caloriesText, '未记录')
    assert.equal(detail.items[0].weightText, '未记录')
    assert.equal(detail.recordedAt, '未记录')
    assert.equal(detail.hungerText, '未填写')
  }
  assert.equal(buildMealDetails({ items: 'invalid' }, '2026-10-14').foodsText, '未填写食物内容')
})

test('读取已有照片地址、正常秒时间及分钟时间，不编造照片', () => {
  const detail = buildMealDetails({ mediaUrl: '/photo/example.jpg', recordedAt: '2026-10-14 12:03:45' }, '2026-10-14')
  assert.equal(detail.mediaUrl, '/photo/example.jpg')
  assert.equal(detail.recordedAt, '2026-10-14 12:03:45')
  assert.equal(buildMealDetails({ recordedAt: '2026-10-14T12:03' }, '2026-10-14').recordedAt, '2026-10-14 12:03:00')
})
