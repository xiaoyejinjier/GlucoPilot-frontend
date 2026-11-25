const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { GLUCOSE_NODES } = require('../../utils/constants')

function createPage(ocr = { status: 'success', suggestedValue: '10.3', confidence: 95, mediaId: 'media-one' }) {
  let definition
  const state = { writes: [], toasts: [], cached: [] }
  const dependencies = {
    '../../services/api': {
      upsertGlucoseRecord(payload) { state.writes.push(payload); return Promise.resolve() }
    },
    '../../utils/storage': {
      getTodayKey: () => '2026-11-25',
      saveRecord(...args) { state.cached.push(args) }
    },
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/shot': { readShotImage: () => 'photo.jpg', clearShotImage() {} },
    '../../utils/request': { getToken: () => 'test-account' },
    '../../utils/ocr/index': { readPendingOcr: () => ocr, clearPendingOcr() {} },
    '../../utils/record-window': { getNodeRecordWindow: () => ({ locked: false }) },
    '../../utils/constants': { GLUCOSE_NODES }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/confirm/confirm.js'), 'utf8'), {
    Page(value) { definition = value },
    require(name) { assert.ok(dependencies[name], name); return dependencies[name] },
    wx: { setNavigationBarTitle() {}, showToast(value) { state.toasts.push(value) } },
    setTimeout() {}
  })
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(value, done) { Object.assign(this.data, value); if (done) done() }
  }
  page.onLoad({ nodeId: 'after_breakfast', nodeName: encodeURIComponent('早餐后') })
  return { page, state }
}

test('进入识别结果页不保存，切换手动编辑保留原值及照片关联', () => {
  const { page, state } = createPage()
  assert.equal(page.data.manualEdit, false)
  page.onUseManual()
  assert.equal(page.data.manualEdit, true)
  assert.equal(page.data.value, '10.3')
  assert.equal(page.data.recognizedValue, '10.3')
  assert.equal(page.data.mediaId, 'media-one')
  assert.equal(state.writes.length, 0)
})

test('确认原识别值仅提交一次，保持OCR来源及图片关联', async () => {
  const { page, state } = createPage()
  page.onAcceptRecognized()
  page.onAcceptRecognized()
  page.onUseManual()
  assert.equal(page.data.manualEdit, false)
  assert.equal(state.writes.length, 1)
  assert.equal(state.writes[0].glucoseValue, 10.3)
  assert.equal(state.writes[0].sourceType, 2)
  assert.equal(state.writes[0].mediaId, 'media-one')
  await Promise.resolve()
  assert.equal(state.cached.length, 1)
})

test('手动修正后只保存修正值，旧识别值不会覆盖当前输入', () => {
  const { page, state } = createPage()
  page.onUseManual()
  page.onValueInput({ detail: { value: '9.8' } })
  page.onAcceptRecognized()
  assert.equal(state.writes.length, 0)
  page.onConfirm()
  assert.equal(state.writes.length, 1)
  assert.equal(state.writes[0].glucoseValue, 9.8)
  assert.equal(state.writes[0].sourceType, 1)
  assert.equal(state.writes[0].mediaId, 'media-one')
})

test('识别失败可直接手动填写，无效值不入库', () => {
  const { page, state } = createPage({ status: 'failed', errorMessage: '图片不清晰' })
  assert.equal(page.data.manualEdit, true)
  assert.equal(page.data.value, '')
  for (const value of ['', '40', '0', '5.23']) {
    page.onValueInput({ detail: { value } })
    page.onConfirm()
  }
  assert.equal(state.writes.length, 0)
  assert.equal(state.toasts.length, 4)
  page.onValueInput({ detail: { value: '5.2' } })
  page.onConfirm()
  assert.equal(state.writes[0].glucoseValue, 5.2)
  assert.equal(state.writes[0].sourceType, 1)
})
