/**
 * 临时评分适配层，仅用于页面联调，不进行营养/血糖评估。
 * 后续与预测模块负责人确认契约后，在此接入真实服务并映射返回结构。
 * 页面仅展示此结果，禁止将模拟分数或文案提交到饮食记录接口。
 */
async function getMealScorePreview(input) {
  if (!input || !Array.isArray(input.items) || !input.items.length) return null
  return {
    schemaVersion: 1,
    source: 'MOCK',
    score: 85,
    maxScore: 100,
    label: '评分展示示例',
    description: '85分为固定模拟数据，仅用于展示和模块联调，不代表本餐的真实评分或血糖预测。'
  }
}

module.exports = { getMealScorePreview }
