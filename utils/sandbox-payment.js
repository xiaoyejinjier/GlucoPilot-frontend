function expiryTime(value) {
  let text = String(value || '').trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text += '+08:00'
  return Date.parse(text)
}

function qrSource(base64) {
  if (typeof base64 !== 'string' || base64.length > 200000
      || !base64.startsWith('iVBORw0KGgo') || base64.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('支付码格式异常')
  }
  // 接口已返回PNG，直接显示内存数据，避免本地文件写入和清理影响二维码展示。
  return `data:image/png;base64,${base64}`
}
module.exports = { qrSource, expiryTime }
