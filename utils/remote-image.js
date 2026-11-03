/**
 * 把 http(s) 图片先下载到本地临时路径再交给 <image>。
 * 接口请求成功不代表原生 <image> 的网络加载也成功；统一通过下载结果、本地缓存和错误重试显示。
 * 临时文件被系统清理后重新下载，稳定业务地址始终保留在页面数据中。
 */
const cache = Object.create(null)
const pending = Object.create(null)
const downloadQueue = []
let activeDownloads = 0

// A food list can contain dozens of images; keep native download concurrency bounded.
function queueDownload(options) {
  downloadQueue.push(options)
  pumpDownloads()
}

function pumpDownloads() {
  while (activeDownloads < 5 && downloadQueue.length) {
    const options = downloadQueue.shift()
    activeDownloads++
    let done = false
    const finish = (callback, result) => {
      if (done) return
      done = true
      try { callback(result) } finally { activeDownloads--; pumpDownloads() }
    }
    try {
      wx.downloadFile({ ...options,
        success: result => finish(options.success, result),
        fail: error => finish(options.fail, error)
      })
    } catch (error) { finish(options.fail, error) }
  }
}

// Stable backend image routes follow the current API host. External CDN URLs stay intact.
function resolveImageUrl(url) {
  const source = String(url || '').trim()
  const match = source.match(/^(?:https?:\/\/[^/?#]+)?(\/api\/v1\/(?:media-files\/(?:local-objects|avatars\/[1-9]\d{0,18})|foods\/(?:images\/[1-9]\d{0,18}|[1-9]\d{0,18}\/image)))(\?[^#]*)?(?:#.*)?$/i)
  if (!match) return source
  const base = String(require('./config').baseUrl || '').replace(/\/+$/, '')
  return base ? base + match[1].slice('/api/v1'.length) + (match[2] || '') : source
}

function invalidateRemoteImage(url) { delete cache[resolveImageUrl(url)] }

function accessible(path) {
  return new Promise(resolve => {
    try {
      const fs = wx.getFileSystemManager()
      if (!fs || typeof fs.access !== 'function') return resolve(false)
      fs.access({ path,success:()=>resolve(true),fail:()=>resolve(false) })
    } catch (_) { resolve(false) }
  })
}

function isHttp(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

async function loadRemoteImage(url) {
  const source = resolveImageUrl(url)
  if (!isHttp(source)) return source
  if (pending[source]) return pending[source]
  const cached = cache[source]
  if (cached && await accessible(cached)) return cached
  if (pending[source]) return pending[source]
  delete cache[source]
  const task = new Promise((resolve) => {
    queueDownload({
      url: source,
      timeout:15000,
      success(res) {
        const local = res.statusCode === 200 && res.tempFilePath ? res.tempFilePath : source
        if (local !== source) cache[source] = local
        resolve(local)
      },
      fail() {
        resolve(source)
      }
    })
  })
  pending[source] = task
  try { return await task } finally { if(pending[source]===task)delete pending[source] }
}

function mapField(list, field) {
  return Promise.all((list || []).map((item) => {
    if (!item || !isHttp(item[field])) return Promise.resolve(item)
    return loadRemoteImage(item[field]).then((local) => {
      if (local === item[field]) return item
      return Object.assign({}, item, { [field]: local })
    })
  }))
}

module.exports = { loadRemoteImage, mapField, resolveImageUrl, invalidateRemoteImage }
