const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { GLUCOSE_NODES } = require('../../utils/constants')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function flow(options = {}) {
  const state = { image: 'photo.jpg', token: 'account-one', date: '2026-10-16', locked: false,
    persisted: [], ocr: [], routes: [], backs: [], modals: [], toasts: [], clears: 0, uploads: 0, loading: 0 }
  const dependencies = {
    '../../utils/constants': { GLUCOSE_NODES }, '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/request': { getToken: () => state.token }, '../../utils/storage': { getTodayKey: () => state.date },
    '../../utils/record-window': { getNodeRecordWindow: () => ({ locked: state.locked, lockReason: '时段已截止' }) },
    '../../utils/shot': {
      readShotImage: () => state.image, clearShotImage() { state.image = '' },
      async persistShotImage(image) {
        state.persisted.push(image)
        if (options.persist) await options.persist()
        state.image = image ? 'saved-photo.jpg' : ''
        return state.image
      }
    },
    '../../utils/ocr/index': {
      clearPendingOcr() { state.clears++ },
      async recognizeGlucoseImage(image, control) {
        state.ocr.push({ image, control }); if (options.recognize) await options.recognize()
        return { status: 'success', suggestedValue: '5.2' }
      }
    }
  }
  const wx = {
    getSystemInfoSync: () => ({ platform: 'devtools' }), showLoading() { state.loading++ }, hideLoading() { state.loading-- },
    showToast: value => state.toasts.push(value), showModal: value => state.modals.push(value),
    navigateTo(value) { state.routes.push(value.url); if (value.complete) value.complete() },
    redirectTo(value) { state.routes.push(value.url); if (value.success) value.success() },
    navigateBack(value) { state.backs.push(value) }, switchTab(value) { state.routes.push(value.url) },
    reLaunch(value) { state.routes.push(value.url) },
    chooseMedia(value) { value.success({ tempFiles: [{ tempFilePath: 'album.jpg' }] }) },
    createCameraContext: () => ({ takePhoto(value) { value.success({ tempImagePath: 'capture.jpg' }) } })
  }
  function page(name, nodeId = 'before_breakfast') {
    let definition
    vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
      Page: value => { definition = value }, wx,
      require: name => { assert.ok(dependencies[name], name); return dependencies[name] }
    })
    const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
      setData(value) { Object.assign(this.data, value) } }
    const node = GLUCOSE_NODES.find(item => item.id === nodeId)
    page.onLoad({ nodeId, nodeName: encodeURIComponent(node.name), isMeal: node.isMeal ? '1' : '0' })
    return page
  }
  return { state, page }
}

test('全部餐前餐后节点先定格确认，不上传OCR；正餐继续走同一确认画面', async () => {
  for (const node of GLUCOSE_NODES) {
    const { page, state } = flow()
    const camera = page('camera', node.id)
    await camera.afterShot('photo.jpg')
    assert.equal(state.ocr.length, 0)
    assert.equal(state.routes.length, 1)
    assert.ok(state.routes[0].startsWith('/pages/food-confirm/food-confirm?nodeId=' + node.id))
    const preview = page('food-confirm', node.id)
    assert.equal(preview.data.isMeal, !!node.isMeal)
    assert.equal(preview.data.imagePath, 'saved-photo.jpg')
    assert.equal(state.ocr.length, 0)
    assert.equal(preview.data.busy, false)
    assert.equal(state.loading, 0)
  }
})

test('真实拍照与相册选图都进入定格页面，不直接识别', async () => {
  for (const kind of ['capture', 'album']) {
    const { page, state } = flow()
    const camera = page('camera', 'after_dinner')
    camera.setData({ isDevtools: false, useLiveCamera: true })
    if (kind === 'capture') camera.onCapture(); else camera.onAlbum()
    await flush()
    assert.equal(state.persisted[0], kind === 'capture' ? 'capture.jpg' : 'album.jpg')
    assert.equal(state.ocr.length, 0)
    assert.match(state.routes[0], /food-confirm\/food-confirm/)
  }
})

test('确认血糖照片后才识别，完成后进入原OCR结果页，连续点击只识别一次', async () => {
  const pending = deferred()
  const { page, state } = flow({ recognize: () => pending.promise })
  const preview = page('food-confirm', 'after_lunch')
  const confirmation = preview.onConfirm()
  await flush()
  assert.equal(preview.data.busy, true)
  assert.equal(state.ocr.length, 1)
  assert.equal(state.ocr[0].image, 'saved-photo.jpg')
  assert.equal(state.routes.length, 0)
  await preview.onConfirm()
  preview.onRetake()
  assert.equal(state.ocr.length, 1)
  assert.equal(state.backs.length, 0)
  pending.resolve()
  await confirmation
  assert.match(state.routes[0], /^\/pages\/confirm\/confirm\?nodeId=after_lunch&/)
  assert.equal(state.loading, 0)
})

test('重拍清除旧图片及OCR结果，保留餐前餐后节点和相机类型', () => {
  const { page, state } = flow()
  const preview = page('food-confirm', 'before_dinner')
  preview.onRetake()
  assert.equal(state.image, '')
  assert.equal(state.clears, 1)
  assert.equal(state.ocr.length, 0)
  state.backs[0].fail()
  assert.match(state.routes[0], /camera\/camera\?nodeId=before_dinner&isMeal=0&/)
})

test('正餐确认仍进入食物分析，重拍仍保留正餐类型', async () => {
  const { page, state } = flow()
  await page('food-confirm', 'dinner').onConfirm()
  assert.match(state.routes[0], /^\/pages\/food-analysis\/food-analysis\?nodeId=dinner&/)
  assert.equal(state.ocr.length, 0)
  const preview = page('food-confirm', 'breakfast')
  preview.onRetake(); state.backs[0].fail()
  assert.match(state.routes.at(-1), /camera\/camera\?nodeId=breakfast&isMeal=1&/)
})

test('缺图或图片加载失败不能识别，时段截止和跨日不能继续识别', async () => {
  for (const kind of ['missing', 'broken', 'closed', 'date']) {
    const { page, state } = flow()
    const preview = page('food-confirm')
    if (kind === 'missing') preview.setData({ imagePath: '' })
    if (kind === 'broken') preview.onImgError()
    if (kind === 'closed') state.locked = true
    if (kind === 'date') state.date = '2026-10-17'
    await preview.onConfirm()
    assert.equal(state.ocr.length, 0)
    assert.equal(state.routes.length, 0)
    assert.ok(state.toasts.length || state.modals.length)
  }
})

test('确认准备失败后可以重试；识别过程中离页或切换账号不跳转旧结果', async () => {
  let attempts = 0
  const retry = flow({ persist: async () => { if (++attempts === 1) throw new Error('save failed') } })
  const preview = retry.page('food-confirm')
  await preview.onConfirm()
  assert.equal(preview.data.busy, false)
  assert.equal(retry.state.routes.length, 0)
  await preview.onConfirm()
  assert.equal(retry.state.ocr.length, 1)
  for (const action of ['leave', 'account', 'expired']) {
    const pending = deferred(), current = flow({ recognize: () => pending.promise })
    const page = current.page('food-confirm'), promise = page.onConfirm()
    await flush()
    if (action === 'leave') page.onUnload()
    else current.state.token = action === 'account' ? 'account-two' : ''
    assert.equal(current.state.ocr[0].control.isCurrent(), false)
    pending.resolve(); await promise
    assert.equal(current.state.routes.some(route => route.startsWith('/pages/confirm/')), false)
    assert.equal(current.state.loading, 0)
    if (action === 'expired') assert.equal(current.state.routes.at(-1), '/pages/login/login')
  }
})

test('识别结束时已过截止时间，不进入结果页；换账号后不能提交旧照片', async () => {
  const pending = deferred(), current = flow({ recognize: () => pending.promise })
  const preview = current.page('food-confirm'), promise = preview.onConfirm()
  await flush(); current.state.locked = true; pending.resolve(); await promise
  assert.equal(current.state.routes.length, 0)
  assert.equal(current.state.modals.length, 1)
  const other = flow(), previous = other.page('food-confirm')
  other.state.token = 'account-two'
  await previous.onConfirm()
  assert.equal(other.state.ocr.length, 0)
  assert.equal(other.state.routes[0], '/pages/ai/ai')
})

test('相机等待保存时离页或关闭时段，不再跳转定格页', async () => {
  for (const action of ['leave', 'closed']) {
    const pending = deferred(), current = flow({ persist: () => pending.promise })
    const camera = current.page('camera'), promise = camera.afterShot('photo.jpg')
    if (action === 'leave') camera.onUnload(); else current.state.locked = true
    pending.resolve(); await promise
    assert.equal(current.state.routes.length, 0)
    assert.equal(current.state.loading, 0)
  }
})

function ocrHarness(options = {}) {
  const state = { storage: new Map(), app: { globalData: {} }, uploads: 0, creates: 0, polls: 0, timers: [] }
  const exports = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/ocr/index.js'), 'utf8'), {
    module: exports, getApp: () => state.app,
    wx: { setStorageSync: (key, value) => state.storage.set(key, value), getStorageSync: key => state.storage.get(key),
      removeStorageSync: key => state.storage.delete(key) },
    setTimeout(callback) { state.timers.push(callback) },
    require(name) {
      if (name === '../media') return { async uploadGlucoseImage() { state.uploads++; return options.upload ? options.upload() : { id: 'media-one' } } }
      assert.equal(name, '../../services/api')
      return {
        async createOcrTask() { state.creates++; return { id: 'task-one' } },
        async fetchOcrTask() {
          state.polls++
          return options.fetch ? options.fetch() : { id: 'task-one', taskStatus: 2, ocrResult: { suggestedValue: 5.2, confidence: 95 } }
        }
      }
    }
  })
  return { ...exports.exports, state }
}

test('实际OCR模块成功保留识别结果；上传失败仍进入可手动输入的失败结果', async () => {
  const current = ocrHarness()
  const result = await current.recognizeGlucoseImage('photo.jpg')
  assert.equal(result.status, 'success')
  assert.equal(result.suggestedValue, '5.2')
  assert.equal(result.mediaId, 'media-one')
  assert.equal(current.readPendingOcr().taskId, 'task-one')
  const failed = ocrHarness({ upload: async () => { throw new Error('无法上传') } })
  const failure = await failed.recognizeGlucoseImage('photo.jpg')
  assert.equal(failure.status, 'failed')
  assert.equal(failed.readPendingOcr().errorMessage, '无法上传')
})

test('取消旧识别后不创建新任务、不继续轮询，也不覆盖新照片的结果', async () => {
  const uploading = deferred()
  let active = true
  const first = ocrHarness({ upload: () => uploading.promise })
  const promise = first.recognizeGlucoseImage('old.jpg', { isCurrent: () => active })
  active = false; uploading.resolve({ id: 'old-media' })
  assert.equal(await promise, null)
  assert.equal(first.state.creates, 0)
  assert.equal(first.state.app.globalData.pendingGlucoseOcr, null)

  active = true
  const polling = deferred(), second = ocrHarness({ fetch: () => polling.promise })
  const completion = second.recognizeGlucoseImage('old.jpg', { isCurrent: () => active })
  await flush()
  const fresh = { status: 'success', suggestedValue: '6.1', savedAt: Date.now() }
  second.state.app.globalData.pendingGlucoseOcr = fresh
  active = false
  polling.resolve({ taskStatus: 2, ocrResult: { suggestedValue: 9.9 } })
  assert.equal(await completion, null)
  assert.equal(second.state.app.globalData.pendingGlucoseOcr, fresh)

  active = true
  const waiting = ocrHarness({ fetch: async () => ({ taskStatus: 1 }) })
  const waitingResult = waiting.recognizeGlucoseImage('old.jpg', { isCurrent: () => active })
  await flush()
  assert.equal(waiting.state.timers.length, 1)
  active = false; waiting.state.timers[0]()
  assert.equal(await waitingResult, null)
  assert.equal(waiting.state.polls, 1)
})
