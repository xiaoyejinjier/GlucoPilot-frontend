const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function panel(fetchArticles) {
  let definition
  const calls = []
  const social = {
    begin(instance) { instance._communityVersion = 1 },
    active(instance, version) { return version === undefined || version === instance._communityVersion },
    timeLabel() { return '刚刚' }
  }
  const dependencies = {
    '../../services/api': {
      fetchCommunityArticles(query) { calls.push(query); return fetchArticles(query) }
    },
    '../../utils/remote-image': { mapField: async rows => rows },
    '../../utils/community': social,
    '../../utils/community-search-history': {
      normalize: value => String(value || '').trim(), push: value => [value]
    },
    '../../utils/title-pinyin': require('../../utils/title-pinyin')
  }
  vm.runInNewContext(fs.readFileSync(path.join(root,
    'components/community-search-panel/community-search-panel.js'), 'utf8'), {
    Component: value => { definition = value },
    require: name => dependencies[name],
    setTimeout: () => 1, clearTimeout() {},
    getCurrentPages: () => [], wx: { showToast() {} }
  })
  const instance = {
    ...definition.methods, data: structuredClone(definition.data),
    setData(values) { Object.assign(this.data, values) }
  }
  social.begin(instance)
  return { instance, calls }
}

test('社区搜索独立使用最新排序，保留关键词分页且去除重复文章', async () => {
  const { instance, calls } = panel(async query => ({
    records: query.pageNum === 1 ? [{ id: '1', title: '早餐' }]
      : [{ id: '1', title: '早餐' }, { id: '2', title: '午餐' }], pages: 2
  }))
  instance.setData({ keyword: ' 早餐 ' })
  instance.onConfirmSearch()
  await flush()
  assert.equal(calls[0].keyword, '早餐')
  assert.equal(calls[0].sort, 'LATEST')
  assert.equal(instance.data.hasMore, true)
  await instance.loadResults(false)
  assert.equal(calls[1].pageNum, 2)
  assert.equal(calls[1].keyword, '早餐')
  assert.deepEqual(Array.from(instance.data.results, row => row.id), ['1', '2'])
  assert.equal(instance.data.hasMore, false)
})

test('拼音联想高亮原中文标题，旧关键词迟到结果不能覆盖当前输入', async () => {
  let resolve
  const { instance } = panel(() => new Promise(done => { resolve = done }))
  instance.setData({ keyword: 'kongtang' })
  const pending = instance.loadSuggests('kongtang')
  instance.setData({ keyword: '运动' })
  resolve({ records: [{ id: '1', title: '科学控糖' }] })
  await pending
  assert.equal(instance.data.suggests.length, 0)
  const highlight = require('../../utils/title-pinyin').highlightTitle('科学控糖', 'kongtang')
  assert.equal(highlight.match, '控糖')
  assert.equal(highlight.before, '科学')
})
