const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function createNavigation() {
  let definition
  const requests = [], pages = [], events = [], measurements = []
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/bottom-navigation/bottom-navigation.js'), 'utf8'), {
    Component: (value) => { definition = value },
    wx: { switchTab: (options) => requests.push(options), navigateTo: (options) => pages.push(options) }
  })
  const navigation = {
    ...definition.methods,
    data: { ...JSON.parse(JSON.stringify(definition.data)), selected: 0, guideActive: false },
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback() },
    createSelectorQuery() {
      const selectors = []
      const query = { select(selector) { selectors.push(selector); return query },
        boundingClientRect() { return query }, exec(callback) { measurements.push({ selectors, callback }) } }
      return query
    },
    triggerEvent(name, detail) { events.push({ name, detail }) }
  }
  return { navigation, requests, pages, events, measurements, definition }
}

test('新手引导按五个入口逐步高亮，期间拦截导航并在最后一步完成', () => {
  const { navigation, definition, measurements, requests, pages, events } = createNavigation()
  navigation.data.guideActive = true
  definition.properties.guideActive.observer.call(navigation, true)
  definition.lifetimes.ready.call(navigation)
  assert.equal(measurements.length, 1)
  for (let index = 0; index < 5; index++) {
    assert.equal(navigation.data.guideIndex, index)
    assert.equal(navigation.data.guideReady, false)
    navigation.nextGuide() // 布局未就绪时连续点击不跳过步骤。
    assert.equal(navigation.data.guideIndex, index)
    const measurement = measurements.at(-1)
    assert.equal(measurement.selectors[0], ['#nav-item-0', '#nav-item-1', '#nav-item-2', '#nav-item-3', '#nav-assistant'][index])
    measurement.callback([{ left: index === 4 ? 10 : 85 + index * 70, top: 650, width: 60, height: 60 }, { left: 0, width: 375 }])
    assert.equal(navigation.data.guideReady, true)
    assert.match(navigation.data.focusStyle, /top:650px;width:60px;height:60px;/)
    navigation.openAssistant()
    navigation.switchTab({ currentTarget: { dataset: { path: '/pages/ai/ai', index: 0 } } })
    assert.equal(requests.length + pages.length, 0)
    navigation.nextGuide()
    assert.equal(events.length, index === 4 ? 1 : 0)
  }
  assert.equal(events[0].name, 'guidecomplete')
  assert.equal(navigation.data.guideSteps.map(step => step.title).join(','), '记录,设备管理,社区,我的,小语')
  assert.equal(navigation.data.arrowStyle, 'left:30px;')
})

test('后台恢复不重置步骤，旋转或退出时过期测量不会覆盖当前高亮', () => {
  const { navigation, definition, measurements } = createNavigation()
  navigation.data.guideActive = true
  definition.properties.guideActive.observer.call(navigation, true)
  definition.lifetimes.ready.call(navigation)
  const rects = [{ left: 90, top: 600, width: 50, height: 58 }, { left: 0, width: 320 }]
  measurements.at(-1).callback(rects)
  navigation.nextGuide()
  assert.equal(navigation.data.guideIndex, 1)
  const stale = measurements.at(-1)
  definition.properties.guideActive.observer.call(navigation, true)
  assert.equal(navigation.data.guideIndex, 1)
  stale.callback(rects)
  assert.equal(navigation.data.guideReady, false)
  measurements.at(-1).callback(rects)
  assert.equal(navigation.data.guideReady, true)
  definition.pageLifetimes.resize.call(navigation)
  const resizing = measurements.at(-1)
  navigation.data.guideActive = false
  definition.properties.guideActive.observer.call(navigation, false)
  resizing.callback(rects)
  assert.equal(navigation.data.guideReady, false)
  navigation.nextGuide()
  assert.equal(navigation.data.guideIndex, 1)
})

test('原生TabBar读取当前登录的引导状态，完成后通知记录页恢复图表', () => {
  let definition, token = 'first-account', completed = 0, restored = 0
  const app = {
    getNavigationGuideToken: () => token,
    completeNavigationGuide(value) {
      if (!token || value !== token) return false
      completed++; token = ''; return true
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8'), {
    Component: value => { definition = value }, getApp: () => app,
    getCurrentPages: () => [{ onNavigationGuideComplete() { restored++ } }]
  })
  const bar = { ...definition.methods, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) } }
  definition.lifetimes.attached.call(bar)
  assert.equal(bar.data.guideActive, true)
  token = 'second-account'
  bar.onGuideComplete()
  assert.equal(completed + restored, 0)
  definition.pageLifetimes.show.call(bar)
  bar.onGuideComplete()
  assert.equal(completed, 1)
  assert.equal(restored, 1)
  assert.equal(bar.data.guideActive, false)
  definition.pageLifetimes.show.call(bar)
  assert.equal(bar.data.guideActive, false)
})

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

function pageForNavigation(name, tabBar) {
  let definition
  const state = { selected: [], pages: [], tabs: [], display: 0 }
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page: value => { definition = value },
    getApp: () => ({ globalData: { isLoggedIn: true }, checkLogin: () => true }),
    require: name => ({
      '../../utils/display': { applyDisplayToCurrentPage: () => state.display++ },
      '../../utils/community': { begin() {}, active: () => false },
      '../../utils/publication': { TAGS: [] },
      '../../services/api': { fetchCommunityTags: async () => [] }
    }[name] || {}),
    wx: { navigateTo: options => state.pages.push(options), switchTab: options => state.tabs.push(options) }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value) },
    getTabBar: () => tabBar || ({ setData: value => state.selected.push(value.selected) }) }
  return { page, state }
}

function cachedGuideBars() {
  let definition, token = 'first-account', completed = 0
  const app = {
    getNavigationGuideToken: () => token,
    completeNavigationGuide(value) {
      if (!token || value !== token) return false
      completed++; token = ''; return true
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8'), {
    Component: value => { definition = value }, getApp: () => app, getCurrentPages: () => []
  })
  const bars = ['ai', 'devices', 'index', 'mine'].map(() => {
    const bar = { ...definition.methods, data: { ...definition.data },
      setData(value) { Object.assign(this.data, value) } }
    definition.lifetimes.attached.call(bar)
    assert.equal(bar.data.guideActive, true)
    return bar
  })
  return { bars, definition, completed: () => completed }
}

test('完成指引后切换设备管理等缓存Tab时清除旧遮罩，不依赖组件show事件', () => {
  const { bars, definition, completed } = cachedGuideBars()
  bars[0].onGuideComplete()
  assert.equal(completed(), 1)
  // 模拟各Tab提前创建，但切换时只触发页面onShow的真机时序。
  const names = ['ai', 'devices', 'index', 'mine']
  for (const index of [1, 2, 3, 0, 1]) {
    const { page } = pageForNavigation(names[index], bars[index])
    page.load = page.loadData = page.syncTodayFromServer = page.startRecordWindowTimer = page.loadRemote = page.refresh = () => {}
    page.onShow()
    assert.equal(bars[index].data.selected, index)
    assert.equal(bars[index].data.guideActive, false, names[index])
    definition.pageLifetimes.show.call(bars[index])
    assert.equal(bars[index].data.guideActive, false)
  }
  assert.equal(completed(), 1)
})

test('已完成的指引在其他缓存实例再次触发完成时仍能关闭，不会卡住导航', () => {
  const { bars, completed } = cachedGuideBars()
  bars[0].onGuideComplete()
  assert.equal(bars[1].data.guideActive, true)
  bars[1].onGuideComplete()
  assert.equal(bars[1].data.guideActive, false)
  assert.equal(completed(), 1)
})

test('四个Tab页面选中索引同步，社区沿用现有首页，设备管理仅展示占位', () => {
  for (const [name, selected] of [['ai', 0], ['devices', 1], ['index', 2], ['mine', 3]]) {
    const { page, state } = pageForNavigation(name)
    page.load = page.loadData = page.syncTodayFromServer = page.startRecordWindowTimer = page.loadRemote = page.refresh = () => {}
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
