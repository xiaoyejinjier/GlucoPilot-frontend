const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function harness() {
  let definition, sequence = 0
  const state = { active: true, requests: [], exposures: [], response: { records: [{ id: '1' }], pages: 3 } }
  const api = {
    async fetchCommunityArticles(params) {
      state.requests.push(params)
      return typeof state.response === 'function' ? state.response(params) : state.response
    },
    async fetchHotArticles() { return state.response },
    async recordRecommendationExposures(ids) { state.exposures.push(Array.from(ids)) }
  }
  const social = { active: () => state.active, requestId: () => `refresh_test_${++sequence}`, timeLabel: () => '' }
  const dependencies = {
    '../../services/api': api,
    '../../utils/community': social,
    '../../utils/remote-image': { mapField: async rows => rows },
    '../../utils/publication': {},
    '../../utils/article-tags': {},
    '../../utils/custom-tag-code': require('../../utils/custom-tag-code'),
    '../../utils/display': {}
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8'), {
    Page: value => { definition = value },
    require: name => { assert.ok(dependencies[name], name); return dependencies[name] }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, state }
}

test('推荐重新进入或刷新更换种子，加载更多保留种子并排除本轮文章', async () => {
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
