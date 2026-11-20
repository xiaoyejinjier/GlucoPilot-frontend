const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function harness(overrides = {}) {
  const state = { token: 'one', sent: [], toasts: [] }
  const api = {
    fetchFeedbackTypes: async () => [{ id: 5, name: '设备支持', deviceRelated: true }, { id: 1, name: '产品建议', deviceRelated: false }],
    fetchMyDevices: async () => [{ id: '9007199254740993', deviceName: '我的血糖仪' }],
    fetchFeedbacks: async () => ({ records: [], total: 0 }),
    submitFeedback: async (...args) => { state.sent.push(args) }, ...overrides
  }
  const service = Object.fromEntries(Object.keys(api).map(key => [key, (...args) => api[key](...args)]))
  const deps = { '../../services/api': service, '../../utils/display': { applyDisplayToCurrentPage() {} }, '../../utils/request': { getToken: () => state.token } }
  let def
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/feedback/feedback.js'), 'utf8'), {
    Page: value => { def = value }, wx: { showToast: toast => state.toasts.push(toast), stopPullDownRefresh() {} },
    require: key => { assert.ok(deps[key], key); return deps[key] }
  })
  const p = { ...def, data: JSON.parse(JSON.stringify(def.data)), setData(values) { Object.assign(this.data, values) } }
  p.onShow(); return { p, state, api }
}
test('反馈使用数据库编号而非排序，未绑定设备可填写型号，已绑定设备保留字符串ID', async () => {
  const { p, state } = harness(); await flush()
  p.onInput({ detail: { value: '不支持我的设备' } }); await p.onSubmit()
  assert.equal(state.sent.length, 0); assert.match(state.toasts.at(-1).title, /品牌型号/)
  p.onDeviceInput({ detail: { value: ' X2 血糖仪 ' } }); await p.onSubmit()
  assert.equal(state.sent[0][0], 5); assert.equal(state.sent[0][2].deviceDescription, 'X2 血糖仪')
  p.onInput({ detail: { value: '同步失败' } }); p.onDeviceChange({ detail: { value: '1' } }); await p.onSubmit()
  assert.equal(state.sent[1][2].deviceId, '9007199254740993')
  p.onDeviceInput({ detail: { value: '暂存型号' } }); p.onTypeTap({ currentTarget: { dataset: { index: 1 } } })
  p.onInput({ detail: { value: '普通建议' } }); await p.onSubmit()
  assert.equal(state.sent[2][0], 1); assert.equal(state.sent[2][2], undefined)
})
test('类型失败禁止提交，设备加载失败仍允许反馈不支持的型号，失败保留表单', async () => {
  const broken = harness({ fetchFeedbackTypes: async () => { throw Error('网络异常') } }); await flush()
  broken.p.onInput({ detail: { value: '建议' } }); await broken.p.onSubmit()
  assert.equal(broken.state.sent.length, 0); assert.equal(broken.p.data.typesError, true)
  const offline = harness({ fetchMyDevices: async () => { throw Error('网络异常') }, submitFeedback: async () => { throw Error('提交失败') } }); await flush()
  offline.p.onDeviceInput({ detail: { value: '其他设备型号' } }); offline.p.onInput({ detail: { value: '不支持' } }); await offline.p.onSubmit()
  assert.equal(offline.p.data.devicesError, true); assert.equal(offline.p.data.content, '不支持'); assert.equal(offline.p.data.deviceDescription, '其他设备型号')
  assert.equal(offline.p.data.submitting, false)
})
test('换账号清理设备与草稿，迟到列表和提交结果不回填新账号', async () => {
  const slow = deferred(), submit = deferred()
  const { p, state, api } = harness({ fetchMyDevices: () => slow.promise, submitFeedback: () => submit.promise }); await flush()
  p.onDeviceInput({ detail: { value: '旧设备' } }); p.onInput({ detail: { value: '旧反馈' } }); const sending = p.onSubmit()
  state.token = 'two'; api.fetchMyDevices = async () => []; p.onShow(); await flush()
  p.onInput({ detail: { value: '新反馈草稿' } }); slow.resolve([{ id: '77', deviceName: '旧账号设备' }]); submit.resolve(); await sending; await flush()
  assert.equal(p.data.devices.length, 0); assert.equal(p.data.content, '新反馈草稿'); assert.equal(p.data.deviceDescription, '')
  assert.equal(state.toasts.some(t => t.title === '已提交'), false)
})
test('设备支持历史反馈映射使用服务端名称并保留设备说明', () => {
  const mappers = require('../../utils/mappers')
  const row = mappers.mapFeedback({ id: '1', feedbackType: 5, feedbackTypeName: '设备支持', deviceDescription: '历史型号', deviceId: null })
  assert.equal(row.type, '设备支持'); assert.equal(row.deviceDescription, '历史型号'); assert.equal(row.deviceId, '')
  assert.equal(mappers.mapFeedback({ feedbackType: 1 }).type, '产品建议')
})
test('下拉刷新读取表中新类型和排序，使用新ID提交并跟随停用更新', async () => {
  const { p, state, api } = harness(); await flush()
  api.fetchFeedbackTypes = async () => [{ id: 6, name: '账号问题', deviceRelated: false }, { id: 5, name: '设备支持', deviceRelated: true }]
  await p.onPullDownRefresh()
  assert.equal(p.data.types[0].id, 6); assert.equal(p.data.types[p.data.activeTypeIndex].id, 5)
  p.onTypeTap({ currentTarget: { dataset: { index: 0 } } }); p.onInput({ detail: { value: '新类型反馈' } }); await p.onSubmit()
  assert.equal(state.sent[0][0], 6)
  api.fetchFeedbackTypes = async () => [{ id: 5, name: '设备支持', deviceRelated: true }]
  await p.onRefreshTap(); assert.equal(p.data.types[p.data.activeTypeIndex].id, 5); assert.equal(p.data.deviceRelated, true)
})
