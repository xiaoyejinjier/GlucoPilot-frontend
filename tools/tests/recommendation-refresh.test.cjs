const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function harness() {
  let definition, sequence = 0
  const state = { active: true, token: 'session-one', requests: [], exposures: [], navigations: [], stoppedRefresh: 0, response: { records: [{ id: '1' }], pages: 3 } }
  const api = {
    async fetchCommunityArticles(params) {
      state.requests.push(params)
      return typeof state.response === 'function' ? state.response(params) : state.response
    },
    async fetchHotArticles() { return state.response },
    async recordRecommendationExposures(ids) { state.exposures.push(Array.from(ids)) },
    async fetchCommunityTags() { return [] },
    async fetchMyCommunityTags() { return [] }
  }
  const socialModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/community.js'), 'utf8'), {
    module: socialModule, require: () => ({ getToken: () => state.token })
  })
  const original = socialModule.exports
  const social = { ...original, active: (...args) => state.active && original.active(...args), requestId: () => `refresh_test_${++sequence}`, timeLabel: () => '' }
  const dependencies = {
    '../../services/api': api,
    '../../utils/community': social,
    '../../utils/remote-image': { mapField: async rows => rows },
    '../../utils/publication': {},
    '../../utils/article-tags': { unpinned: () => [], hidden: () => [], list: () => [] },
    '../../utils/custom-tag-code': require('../../utils/custom-tag-code'),
    '../../utils/display': { applyDisplayToCurrentPage() {} }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8'), {
    Page: value => { definition = value },
    getApp: () => ({ checkLogin: () => !!state.token }),
    wx: { navigateTo: value => state.navigations.push(value), stopPullDownRefresh: () => state.stoppedRefresh++ },
    require: name => { assert.ok(dependencies[name], name); return dependencies[name] }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  social.begin(page)
  return { page, state }
}

test('主动刷新更换推荐种子，加载更多保留种子并排除本轮文章', async () => {
  const { page, state } = harness()
  await page.load(true)
  const firstSeed = state.requests[0].refreshSeed
  assert.deepEqual(state.exposures, [['1']])
  state.response = { records: [{ id: '2' }], pages: 3 }
  await page.load(false)
  assert.equal(state.requests[1].refreshSeed, firstSeed)
  assert.equal(state.requests[1].excludeIds, '1')
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['1', '2'])
  await page.load(true)
  assert.notEqual(state.requests[2].refreshSeed, firstSeed)
  assert.equal(state.requests[2].excludeIds, '')
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['2'])
})

test('关注列表和热榜不写推荐下发记录，也不携带推荐换批参数', async () => {
  const { page, state } = harness()
  page.data.feedMode = 'following'
  await page.load(true)
  assert.equal(state.requests[0].sort, 'LATEST')
  assert.equal(state.requests[0].refreshSeed, undefined)
  page.data.feedMode = 'hot'
  await page.load(true)
  assert.equal(state.requests.length, 1)
  assert.deepEqual(state.exposures, [])
})

test('旧轮次迟到响应不覆盖新列表，也不记录旧文章为已展示', async () => {
  const { page, state } = harness()
  let resolve
  state.response = () => new Promise(done => { resolve = done })
  const old = page.load(true)
  state.response = { records: [{ id: '2' }], pages: 1 }
  await page.load(true)
  resolve({ records: [{ id: '1' }], pages: 1 })
  await old
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['2'])
  assert.deepEqual(state.exposures, [['2']])
})

test('离页或切换账号后的响应不展示、不记录推荐曝光', async () => {
  const { page, state } = harness()
  let resolve
  state.response = () => new Promise(done => { resolve = done })
  const pending = page.load(true)
  state.active = false
  resolve({ records: [{ id: '1' }], pages: 1 })
  await pending
  assert.equal(page.data.posts.length, 0)
  assert.equal(state.exposures.length, 0)
})

test('阅读文章返回和切回社区保留推荐列表、分页与种子，不重复曝光', async () => {
  const { page, state } = harness()
  page.onShow(); await flush()
  const seed = state.requests[0].refreshSeed
  state.response = { records: [{ id: '2' }], pages: 3 }
  await page.load(false)
  const posts = page.data.posts
  page.onOpen({ currentTarget: { dataset: { id: '1' } } })
  assert.equal(state.navigations[0].url, '/pages/news-detail/news-detail?id=1')
  for (let i = 0; i < 2; i++) {
    page.onHide(); page.onShow(); await flush()
    assert.equal(state.requests.length, 2)
    assert.equal(page.data.posts, posts)
    assert.equal(page.data.pageNum, 2)
    assert.equal(page.data.hasMore, true)
    assert.equal(page._recommendationSeed, seed)
  }
  assert.deepEqual(state.exposures, [['1'], ['2']])
})

test('下拉刷新和重新登录更新推荐，同一会话返回不更新', async () => {
  const { page, state } = harness()
  page.onShow(); await flush()
  const seed = state.requests[0].refreshSeed
  state.response = { records: [{ id: '2' }], pages: 1 }
  await page.onPullDownRefresh()
  assert.notEqual(state.requests[1].refreshSeed, seed)
  assert.equal(state.stoppedRefresh, 1)
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['2'])
  page.onHide(); state.token = 'session-two'
  state.response = { records: [{ id: '3' }], pages: 2 }
  page.onShow()
  assert.equal(page.data.posts.length, 0)
  await flush()
  assert.equal(state.requests.length, 3)
  assert.notEqual(state.requests[2].refreshSeed, state.requests[1].refreshSeed)
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['3'])
  assert.equal(page.data.pageNum, 1)
})

test('已加载的空推荐不会每次返回都重刷，首次失败则允许返回重试', async () => {
  const { page, state } = harness()
  state.response = { records: [], pages: 0 }
  page.onShow(); await flush()
  page.onHide(); page.onShow(); await flush()
  assert.equal(state.requests.length, 1)
  state.response = async () => { throw Error('网络暂时不可用') }
  await page.onPullDownRefresh()
  assert.equal(page.data.error, '网络暂时不可用')
  page.onHide()
  state.response = { records: [{ id: '2' }], pages: 1 }
  page.onShow(); await flush()
  assert.equal(state.requests.length, 3)
  assert.equal(page.data.error, '')
})

test('加载更多时离页，返回取消加载状态并丢弃迟到结果，继续分页沿用原种子', async () => {
  const { page, state } = harness()
  page.onShow(); await flush()
  const seed = state.requests[0].refreshSeed
  let resolve
  state.response = () => new Promise(done => { resolve = done })
  const pending = page.load(false)
  page.onHide(); page.onShow(); await flush()
  assert.equal(state.requests.length, 2)
  assert.equal(page.data.loading, false)
  resolve({ records: [{ id: '99' }], pages: 3 }); await pending
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['1'])
  state.response = { records: [{ id: '2' }], pages: 3 }
  await page.load(false)
  assert.equal(state.requests[2].pageNum, 2)
  assert.equal(state.requests[2].refreshSeed, seed)
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['1', '2'])
})

test('详情真实浏览量回传只更新对应文章，返回保留推荐顺序、分页和曝光', async () => {
  const { page, state } = harness()
  state.response = { records: [{ id: '1', viewCount: 3 }], pages: 3 }
  page.onShow(); await flush()
  const seed = page._recommendationSeed
  state.response = { records: [{ id: '2', viewCount: 9 }], pages: 3 }
  await page.load(false)
  const untouched = page.data.posts[1]
  page.onOpen({ currentTarget: { dataset: { id: '1' } } })
  const callback = state.navigations.at(-1).events.articleViewed
  page.onHide()
  callback({ id: '1', viewCount: 4 })
  page.onShow(); await flush()
  assert.deepEqual(Array.from(page.data.posts, row => [row.id, row.viewCount]), [['1', 4], ['2', 9]])
  assert.equal(page.data.posts[1], untouched)
  assert.equal(page.data.pageNum, 2)
  assert.equal(page._recommendationSeed, seed)
  assert.equal(state.requests.length, 2)
  assert.deepEqual(state.exposures, [['1'], ['2']])
})

test('评论入口同样同步浏览量，重复及迟到较小计数不增加、不回退', async () => {
  const { page, state } = harness()
  state.response = { records: [{ id: '1', viewCount: 7 }], pages: 1 }
  page.onShow(); await flush()
  page.onComments({ currentTarget: { dataset: { id: '1' } } })
  assert.equal(state.navigations.at(-1).url, '/pages/news-detail/news-detail?id=1&comments=1')
  const callback = state.navigations.at(-1).events.articleViewed
  const original = page.data.posts
  for (const count of [7, 6, -1, 1.2, null, '', ' ', true, Infinity, 'invalid']) callback({ id: '1', viewCount: count })
  callback({ id: '2', viewCount: 100 })
  assert.equal(page.data.posts, original)
  callback({ id: '1', viewCount: '8' })
  assert.equal(page.data.posts[0].viewCount, 8)
  callback({ id: '1', viewCount: 8 })
  assert.equal(page.data.posts[0].viewCount, 8)
})

test('浏览量回传隔离账号和已卸载页面，不复活被隐藏的文章', async () => {
  const { page, state } = harness()
  state.response = { records: [{ id: '1', viewCount: 2 }], pages: 1 }
  page.onShow(); await flush()
  page.onOpen({ currentTarget: { dataset: { id: '1' } } })
  const callback = state.navigations.at(-1).events.articleViewed
  state.token = 'session-two'
  callback({ id: '1', viewCount: 20 })
  assert.equal(page.data.posts[0].viewCount, 2)
  state.token = 'session-one'
  page.setData({ posts: [] })
  callback({ id: '1', viewCount: 21 })
  assert.equal(page.data.posts.length, 0)
  page.setData({ posts: [{ id: '1', viewCount: 2 }] })
  page.onUnload()
  callback({ id: '1', viewCount: 22 })
  assert.equal(page.data.posts[0].viewCount, 2)
})
