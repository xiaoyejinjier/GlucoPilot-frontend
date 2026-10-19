/**
 * 把 http(s) 图片先下载到本地临时路径再交给 <image>。
 * 真机调试切到广域网后，wx.request 会经调试通道转发，<image src="http://局域网IP"> 仍由手机直连，连不上电脑就会空白。
 * wx.downloadFile 与 wx.request 走同一条调试通道。
 */
const cache = Object.create(null)

function isHttp(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

function loadRemoteImage(url) {
  const source = String(url || '').trim()
  if (!isHttp(source)) return Promise.resolve(source)
  if (cache[source]) return Promise.resolve(cache[source])
  return new Promise((resolve) => {
    wx.downloadFile({
      url: source,
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

module.exports = { loadRemoteImage, mapField }
