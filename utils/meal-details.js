/** 只展示已保存的饮食快照；缺失营养不伪装成 0，不调用预测模块。 */
function nutrientValue(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function nutrientText(value, unit) {
  const number = nutrientValue(value)
  return number == null ? '未记录' : `${Number(number.toFixed(1))} ${unit}`
}

function sumCompleteItems(items, field) {
  const values = items.map((item) => nutrientValue(item[field]))
  return values.length && values.every((value) => value != null)
    ? values.reduce((sum, value) => sum + value, 0) : null
}

function buildMealDetails(meal, recordDate) {
  const items = (Array.isArray(meal.items) ? meal.items : []).filter((item) => item && typeof item === 'object')
  const foodsText = typeof meal.foodsText === 'string' ? meal.foodsText.trim() : ''
  const time = typeof meal.recordedAt === 'string'
    ? /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/.exec(meal.recordedAt) : null
  const carbs = nutrientValue(meal.carbsG)
  return {
    recordDate,
    foodsText: foodsText || (items.length ? items.map((item) => item.foodName || '未命名食物').join('、') : '未填写食物内容'),
    recordedAt: time ? `${time[1]} ${time[2]}${time[3] || ':00'}` : '未记录',
    carbsText: nutrientText(carbs == null ? sumCompleteItems(items, 'carbsG') : carbs, 'g'),
    caloriesText: nutrientText(sumCompleteItems(items, 'caloriesKcal'), 'kcal'),
    hungerText: ({ 1: '饱腹', 2: '一般', 3: '微饿' })[meal.hungerLevel] || '未填写',
    supplementText: typeof meal.supplementText === 'string' && meal.supplementText.trim() ? meal.supplementText : '无',
    mediaUrl: typeof meal.mediaUrl === 'string' ? meal.mediaUrl : '',
    mediaId: /^[1-9]\d{0,18}$/.test(String(meal.mediaId || '')) ? String(meal.mediaId) : '',
    items: items.map((item, index) => ({
      key: index,
      name: item.foodName || '未命名食物',
      weightText: nutrientText(item.weightG, 'g'),
      carbsText: nutrientText(item.carbsG, 'g'),
      caloriesText: nutrientText(item.caloriesKcal, 'kcal')
    }))
  }
}

module.exports = { buildMealDetails }
