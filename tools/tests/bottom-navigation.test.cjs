const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function createNavigation() {
  let definition
  const requests = [], pages = [], events = []
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/bottom-navigation/bottom-navigation.js'), 'utf8'), {
    Component: (value) => { definition = value },
    wx: { switchTab: (options) => requests.push(options), navigateTo: (options) => pages.push(options) }
  })
  const navigation = {
    ...definition.methods,
    data: { ...JSON.parse(JSON.stringify(definition.data)), selected: 0 },
    setData(value) { Object.assign(this.data, value) },
    triggerEvent(name, detail) { events.push({ name, detail }) }
  }
  return { navigation, requests, pages, events }
}

test('四个常规入口保持原生Tab路由与选中索引一致，小语为独立页面', () => {
  const { navigation, requests, events } = createNavigation()
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(navigation.data.items.length, 4)
  assert.equal(manifest.tabBar.list.length, 4)
  assert.equal(navigation.data.items.map(item => item.text).join(','), '记录,设备管理,社区,我的')
  assert.equal(manifest.tabBar.list.map(item => item.text).join(','), '记录,设备管理,社区,我的')
  assert.equal(navigation.data.assistant.text, '小语')
  assert.ok(manifest.pages.includes(navigation.data.assistant.pagePath.slice(1)))
  assert.equal(manifest.tabBar.list.some((item) => '/' + item.pagePath === navigation.data.assistant.pagePath), false)
  for (const entry of navigation.data.items) {
    assert.equal('/' + manifest.tabBar.list[entry.index].pagePath, entry.pagePath)
    navigation.switchTab({ currentTarget: { dataset: { path: entry.pagePath, index: String(entry.index) } } })
    assert.equal(requests.at(-1).url, entry.pagePath)
    requests.at(-1).success()
    assert.equal(navigation.data.selected, entry.index)
    assert.equal(events.at(-1).detail.index, entry.index)
    assert.equal(events.at(-1).name, 'tabchange')
  }
})

test('切换未成功时保持原选中项，拒绝不匹配的路径和索引', () => {
  const { navigation, requests, events } = createNavigation()
  const entry = navigation.data.items[1]
  navigation.switchTab({ currentTarget: { dataset: { path: entry.pagePath, index: entry.index } } })
  assert.equal(navigation.data.selected, 0)
  assert.equal(events.length, 0)
  navigation.switchTab({ currentTarget: { dataset: { path: entry.pagePath, index: 3 } } })
  navigation.switchTab({ currentTarget: { dataset: { path: '/pages/login/login', index: 0 } } })
  assert.equal(requests.length, 1)
  assert.equal(navigation.data.selected, 0)
})

test('确认页即使高亮记录入口，点击仍返回记录主页', () => {
  const { navigation, requests } = createNavigation()
  navigation.data.selected = 0
  const entry = navigation.data.items.find((item) => item.index === 0)
  navigation.switchTab({ currentTarget: { dataset: { path: entry.pagePath, index: entry.index } } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/pages/ai/ai')
})

function pageForNavigation(name) {
  let definition
  const state = { selected: [], pages: [], tabs: [], display: 0 }
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page: value => { definition = value },
    getApp: () => ({ globalData: { isLoggedIn: true } }),
    require: name => name === '../../utils/display' ? { applyDisplayToCurrentPage: () => state.display++ } : {},
    wx: { navigateTo: options => state.pages.push(options), switchTab: options => state.tabs.push(options) }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value) },
    getTabBar: () => ({ setData: value => state.selected.push(value.selected) }) }
  return { page, state }
}

test('四个Tab页面选中索引同步，社区沿用现有首页，设备管理仅展示占位', () => {
  for (const [name, selected] of [['ai', 0], ['devices', 1], ['index', 2], ['mine', 3]]) {
    const { page, state } = pageForNavigation(name)
    page.loadData = page.syncTodayFromServer = page.startRecordWindowTimer = page.loadRemote = page.refresh = () => {}
    page.onShow()
    assert.equal(state.selected[0], selected)
    assert.equal(state.display, 1)
  }
  const device = fs.readFileSync(path.join(root, 'pages/devices/devices.js'), 'utf8')
  assert.equal(/services\/api|device-discovery|startBluetooth|openBluetooth|wx\.request/.test(device), false)
  assert.match(fs.readFileSync(path.join(root, 'pages/devices/devices.wxml'), 'utf8'), /即将上线/)
  for (const name of ['confirm', 'food-analysis']) {
    assert.match(fs.readFileSync(path.join(root, `pages/${name}/${name}.wxml`), 'utf8'), /<tab-bar selected="\{\{0\}\}"/)
  }
})

test('记录页统计卡片压入统计页，保留返回路径，重复点击不叠加页面', () => {
  const { page, state } = pageForNavigation('ai')
  page.onOpenStats(); page.onOpenStats()
  assert.equal(state.pages.length, 1)
  assert.equal(state.pages[0].url, '/pages/stats/stats')
  assert.equal(state.tabs.length, 0)
  state.pages[0].complete(); page.onOpenStats()
  assert.equal(state.pages.length, 2)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(manifest.pages.includes('pages/stats/stats'))
  assert.equal(manifest.tabBar.list.some(item => item.pagePath === 'pages/stats/stats'), false)
  assert.match(fs.readFileSync(path.join(root, 'pages/stats/stats.wxml'), 'utf8'), /class="page-no-tab stats-page"/)
  const record = fs.readFileSync(path.join(root, 'pages/ai/ai.wxml'), 'utf8')
  assert.ok(record.indexOf('class="stats-entry"') > record.indexOf('class="status-legend"'))
  assert.match(record, /bindtap="onOpenStats"/)
  const stats = pageForNavigation('stats')
  stats.page.loadSummary = () => {}
  stats.page.onShow()
  assert.equal(stats.state.selected.length, 0)
})

test('小语压入页面栈并保留来源Tab，重复点击不叠加页面，返回后可再次打开', () => {
  const { navigation, requests, pages, events } = createNavigation()
  navigation.data.selected = 2
  navigation.openAssistant()
  navigation.openAssistant()
  assert.equal(pages.length, 1)
  assert.equal(pages[0].url, '/pages/voice/voice')
  assert.equal(requests.length, 0)
  assert.equal(navigation.data.selected, 2)
  assert.equal(events.length, 0)
  pages[0].complete()
  navigation.openAssistant()
  assert.equal(pages.length, 2)

  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/voice/voice.json'), 'utf8'))
  assert.equal(config.navigationStyle, 'default')
  assert.equal(config.navigationBarTitleText, '小语')
  const template = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  assert.match(template, /class="page-no-tab voice-page(?:\s|")/)
  assert.equal(template.includes('bottom-navigation'), false)
  assert.equal(template.includes('tab-bar'), false)
})
