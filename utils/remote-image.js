/**
 * 把 http(s) 图片先下载到本地临时路径再交给 <image>。
 * 真机调试切到广域网后，wx.request 会经调试通道转发，<image src="http://局域网IP"> 仍由手机直连，连不上电脑就会空白。
 * wx.downloadFile 与 wx.request 走同一条调试通道。
 */
const cache = Object.create(null)
const pending = Object.create(null)

// Backend object and avatar routes follow the current API host. External image URLs stay intact.
function resolveImageUrl(url) {
  const source = String(url || '').trim()
  const match = source.match(/^(?:https?:\/\/[^/?#]+)?(\/api\/v1\/media-files\/(?:local-objects|avatars\/[1-9]\d{0,18}))(\?[^#]*)?(?:#.*)?$/i)
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
    wx.downloadFile({
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
