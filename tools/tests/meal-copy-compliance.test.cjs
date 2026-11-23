const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const pageDirectory = path.resolve(__dirname, '../../pages/food-analysis')
const read = (file) => fs.readFileSync(path.join(pageDirectory, file), 'utf8')

// 方案 4.4：禁止绝对/医疗结论类文案
const FORBIDDEN_TERMS = ['适合', '不建议', '放心吃', '会导致血糖', '不宜食用', '推荐食用', '可以吃']

function findForbidden(source) {
  return FORBIDDEN_TERMS.filter((term) => source.includes(term))
}

test('餐食页模板不出现适合/不建议类绝对结论文案', () => {
  const wxml = read('food-analysis.wxml')
  assert.deepEqual(findForbidden(wxml), [], 'food-analysis.wxml 含禁用文案')
})

test('餐食页脚本不出现适合/不建议类绝对结论文案', () => {
  const script = read('food-analysis.js')
  assert.deepEqual(findForbidden(script), [], 'food-analysis.js 含禁用文案')
})

test('餐食页展示文案由后端档位标签驱动，不自造结论', () => {
  const wxml = read('food-analysis.wxml')
  // 三档命名（升糖负担较低/中等/较高）与免责声明只来自预览接口，页面不硬编码判断
  assert.match(wxml, /preview\.tierLabel/)
  assert.match(wxml, /preview\.disclaimer/)
  assert.equal(wxml.includes('升糖负担较高'), false)
})

test('餐食页不再出现预测相关文案', () => {
  const wxml = read('food-analysis.wxml')
  assert.equal(wxml.includes('预测'), false, 'food-analysis.wxml 仍有预测字样')
  assert.equal(wxml.includes('预测值'), false)
})

test('餐食页 i18n 词条不含禁用文案', () => {
  const wxml = read('food-analysis.wxml')
  const keys = []
  const pattern = /i18n\.t\(\s*["']([^"']+)["']/g
  let match = pattern.exec(wxml)
  while (match) {
    keys.push(match[1])
    match = pattern.exec(wxml)
  }
  assert.ok(keys.length > 0, '未解析到 i18n.t 字面量')
  const offenders = keys.filter((key) => FORBIDDEN_TERMS.some((term) => key.includes(term)))
  assert.deepEqual(offenders, [], '页面 i18n 词条含禁用文案')
})
