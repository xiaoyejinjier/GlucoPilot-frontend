const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { buildGlucoseAlerts } = require('../../utils/glucose-alerts')
const directory = path.resolve(__dirname, '../../components/glucose-alert-reminder')
const measured = (value, extra = {}) => ({ id: 'before_breakfast', value, hasRecord: true, ...extra })

test('提醒边界与后端一致：3.9不提示、10提示，低值严格小于3.9', () => {
  assert.equal(buildGlucoseAlerts([measured(3.9), measured(9.9)]).length, 0)
  assert.equal(buildGlucoseAlerts([measured(3.8)])[0].type, 'low')
  assert.equal(buildGlucoseAlerts([measured('10.0')])[0].type, 'high')
  assert.equal(buildGlucoseAlerts([measured(10)])[0].name, '早餐前')
})

test('正餐预测、空值、非法值和未保存节点均不生成提醒', () => {
  const invalid = [null, undefined, '', '  ', 'bad', 0, -1, 40, Infinity, true, [], {}]
  for (const value of invalid) assert.equal(buildGlucoseAlerts([measured(value)]).length, 0)
  for (const extra of [{ isMeal: true }, { id: 'breakfast' }, { id: 'unknown' }, { hasRecord: false }]) {
    assert.equal(buildGlucoseAlerts([measured(12, extra)]).length, 0)
  }
  assert.equal(buildGlucoseAlerts(null).length, 0)
})

test('提醒只派生显示数据，不修改原节点、数值或缓存', () => {
  const nodes = [Object.freeze(measured(3.2)), Object.freeze(measured(12, { id: 'after_dinner' }))]
  const before = JSON.stringify(nodes)
  const alerts = buildGlucoseAlerts(Object.freeze(nodes))
  assert.equal(alerts.length, 2)
  assert.equal(JSON.stringify(nodes), before)
  assert.equal(alerts[1].name, '晚餐后')
})

function createComponent(fetchReplies = async () => ({ records: [], total: 0 })) {
  let component
  const state = { token: 'test-user-a', calls: [], events: [],navs:[] }
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'glucose-alert-reminder.js'), 'utf8'), {
    Component(value) { component = value }, wx:{navigateTo:value=>state.navs.push(value)},require(name) {
      if (name === '../../utils/glucose-alerts') return { buildGlucoseAlerts }
      if (name === '../../utils/request') return { getToken: () => state.token }
      assert.equal(name, '../../services/api')
      return { fetchGlucoseAlertReplies: (page, size) => { state.calls.push({ page, size }); return fetchReplies(page, size) } }
    }
    // 不提供 wx：不使用系统弹窗、跳转或存储写操作；自定义弹窗仅由用户点击打开。
  })
  const instance = { ...component.methods, _alive: true, _visible: true,
    data: JSON.parse(JSON.stringify(component.data)), setData(data) { Object.assign(this.data, data) },
    triggerEvent(name, detail) { state.events.push({ name, visible: detail.visible }) } }
  return { component, instance, state }
}

test('实测提醒随节点更正/删除自然清除，节点观察不额外请求', () => {
  const { component, instance, state } = createComponent()
  const observer = component.properties.nodes.observer
  observer.call(instance, [measured(3.2)])
  assert.equal(instance.data.alerts.length, 1)
  observer.call(instance, [measured(6.2)])
  assert.equal(instance.data.alerts.length, 0)
  observer.call(instance, [])
  assert.equal(instance.data.alerts.length, 0)
  assert.equal(state.calls.length, 0)
})

test('记录页全局提醒只保留非零私信及互动类别，没有信息时清空',()=>{
  const {component,instance}=createComponent()
  component.properties.socialCounts.observer.call(instance,{messages:1,likes:2,collections:0,comments:3,follows:0,total:6})
  assert.equal(instance.data.socialTotal,6);assert.equal(instance.data.socialItems.map(item=>item.title).join(','),'私信,点赞,评论')
  component.properties.socialCounts.observer.call(instance,{messages:0,likes:0,collections:0,comments:0,follows:0,total:0})
  assert.equal(instance.data.socialItems.length,0);assert.equal(instance.data.socialTotal,0)
})

test('记录全局提醒包含管理员举报反馈，点击进入本人举报，不走互动分类',()=>{
  const {component,instance,state}=createComponent()
  component.properties.socialCounts.observer.call(instance,{reports:2,total:2})
  assert.equal(instance.data.socialItems[0].title,'举报反馈');assert.equal(instance.data.socialItems.length,1)
  instance.onInformation({currentTarget:{dataset:{key:'reports'}}});assert.equal(state.navs[0].url,'/pages/community-reports/community-reports')
  component.properties.socialCounts.observer.call(instance,{reports:0,total:0});assert.equal(instance.data.socialItems.length,0)
})

const reply = (id, text) => ({ id, recordId: '123', recordDate: '2026-10-15', nodeName: '早餐前', glucoseValue: 3.8,
  recordedAt: '2026-10-15T08:00:00.123', userReply: text, repliedAt: '2026-10-15T09:00:00.456', note: '不应进入用户展示数据' })

test('提醒和回复不自动弹出，打开/关闭不重复请求、不丢失内容或分页状态', async () => {
  const { instance, state } = createComponent(async () => ({ records: [reply('1', '完整回复')], total: 4 }))
  assert.equal(instance.data.noticeVisible, false)
  await instance.refreshReplies()
  assert.equal(instance.data.noticeVisible, false)
  assert.equal(instance.data.replyTotal, 4)
  instance.openNotice(); instance.openNotice()
  assert.equal(instance.data.noticeVisible, true)
  instance.closeNotice(); instance.closeNotice()
  assert.equal(instance.data.noticeVisible, false)
  instance.openNotice()
  assert.equal(instance.data.replies[0].userReply, '完整回复')
  assert.equal(instance.data.hasMoreReplies, true)
  assert.equal(state.calls.length, 1)
  assert.deepEqual(state.events, [
    { name: 'visibilitychange', visible: true }, { name: 'visibilitychange', visible: false },
    { name: 'visibilitychange', visible: true }
  ])
})

test('慢请求不会自动打开弹窗，离开页面和切换账号关闭详情', async () => {
  let complete
  const { component, instance, state } = createComponent(() => new Promise((resolve) => { complete = resolve }))
  const loading = instance.refreshReplies()
  instance.openNotice(); instance.closeNotice()
  complete({ records: [reply('1', '新回复')], total: 1 }); await loading
  assert.equal(instance.data.noticeVisible, false)
  instance.openNotice()
  component.pageLifetimes.hide.call(instance)
  assert.equal(instance.data.noticeVisible, false)
  assert.equal(instance.data.replyTotal, 0)
  assert.equal(instance.data.replies.length, 0)
  instance._visible = true
  instance.openNotice()
  state.token = 'test-user-b'
  const next = instance.refreshReplies()
  assert.equal(instance.data.noticeVisible, false)
  complete({ records: [reply('2', '乙的回复')], total: 1 }); await next
  assert.equal(instance.data.noticeVisible, false)
  assert.equal(instance.data.replies[0].userReply, '乙的回复')
})

test('主页只有紧凑入口，提醒和回复详情在可滚动弹窗内，刷新保留在回复标题栏', () => {
  const template = fs.readFileSync(path.join(directory, 'glucose-alert-reminder.wxml'), 'utf8')
  const bodyStart = template.indexOf('<view wx:if="{{noticeVisible}}" class="notice-overlay">')
  assert.ok(bodyStart > template.indexOf('bindtap="openNotice"'))
  assert.ok(template.indexOf('class="notice-alert-badge"') < bodyStart)
  assert.ok(template.indexOf('class="notice-reply-badge"') < bodyStart)
  const refreshStart = template.indexOf('catchtap="refreshReplies"')
  assert.ok(refreshStart > template.indexOf('class="reply-heading"'))
  assert.ok(refreshStart < template.indexOf('class="reply-item"'))
  for (const marker of ['class="alert-card"', 'class="reply-content"', '<scroll-view', 'bindtap="loadMoreReplies"', 'bindtap="onRetryReplies"']) {
    assert.ok(template.indexOf(marker) > bodyStart)
  }
  assert.equal((template.match(/bindtap="closeNotice"/g) || []).length, 2)
  assert.ok(template.includes('catchtouchmove="onNoticeContentTap"'))
  assert.ok(template.includes('暂无管理端回复'))
})

test('组件读取公开回复并保留对应测量时间，不展示内部字段', async () => {
  const { instance } = createComponent(async () => ({ records: [reply('1', '回复第一行\n回复第二行')], total: 1 }))
  await instance.refreshReplies()
  assert.equal(instance.data.replies[0].userReply, '回复第一行\n回复第二行')
  assert.equal(instance.data.replies[0].recordedAtText, '2026-10-15 08:00:00')
  assert.equal(instance.data.replies[0].repliedAtText, '2026-10-15 09:00:00')
  assert.equal(Object.hasOwn(instance.data.replies[0], 'note'), false)
  assert.equal(instance.data.repliesLoading, false)
})

test('分页失败保留已读回复，重试不跳页，刷新后撤回内容消失', async () => {
  let fail = true, cleared = false
  const { instance, state } = createComponent(async (page) => {
    if (cleared) return { records: [], total: 0 }
    if (page === 2 && fail) throw new Error('网络失败')
    return page === 1 ? { records: [reply('1', '一'), reply('2', '二'), reply('3', '三')], total: 4 }
      : { records: [reply('4', '四')], total: 4 }
  })
  await instance.refreshReplies(); await instance.loadMoreReplies()
  assert.equal(instance.data.replies.length, 3)
  assert.equal(instance.data.repliesError, '网络失败')
  fail = false; await instance.onRetryReplies()
  assert.equal(state.calls.at(-1).page, 2)
  assert.equal(instance.data.replies.length, 4)
  assert.equal(instance.data.replyTotal, 4)
  assert.equal(instance.data.hasMoreReplies, false)
  cleared = true; await instance.refreshReplies()
  assert.equal(instance.data.replies.length, 0)
  assert.equal(instance.data.replyTotal, 0)
})

test('退出/隐藏页面后旧回复请求不能回写，返回页面可重新读取', async () => {
  let complete
  const { component, instance } = createComponent(() => new Promise((resolve) => { complete = resolve }))
  const old = instance.refreshReplies()
  component.pageLifetimes.hide.call(instance)
  complete({ records: [reply('1', '晚到的旧回复')], total: 1 }); await old
  assert.equal(instance.data.replies.length, 0)
  const returned = component.pageLifetimes.show.call(instance)
  // show方法发起异步读取，等待它完成后再检查。
  complete({ records: [reply('2', '返回后的新回复')], total: 1 }); await new Promise((resolve) => setImmediate(resolve)); await returned
  assert.equal(instance.data.replies[0].userReply, '返回后的新回复')
  component.lifetimes.detached.call(instance)
  assert.equal(instance._alive, false)
})

test('切换账号时清空旧回复，前一个账号慢响应不能串入新账号', async () => {
  const pending = []
  const { instance, state } = createComponent(() => new Promise((resolve) => pending.push(resolve)))
  const a = instance.refreshReplies()
  state.token = 'test-user-b'
  const b = instance.refreshReplies()
  assert.equal(instance.data.replies.length, 0)
  pending[1]({ records: [reply('2', '乙的回复')], total: 1 }); await b
  pending[0]({ records: [reply('1', '甲的回复')], total: 1 }); await a
  assert.equal(instance.data.replies.length, 1)
  assert.equal(instance.data.replies[0].userReply, '乙的回复')
})

test('未登录时不读取回复，401清除token后不残留上个账号公开回复', async () => {
  const { instance, state } = createComponent(async () => { state.token = ''; throw new Error('登录失效') })
  state.token = ''
  await instance.refreshReplies()
  assert.equal(state.calls.length, 0)
  state.token = 'test-user-a'
  await instance.refreshReplies()
  assert.equal(instance.data.replies.length, 0)
  assert.equal(instance.data.repliesLoading, false)
})
