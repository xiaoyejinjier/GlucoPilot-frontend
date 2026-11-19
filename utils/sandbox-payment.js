function expiryTime(value) {
  let text = String(value || '').trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text += '+08:00'
  return Date.parse(text)
}

function isSandboxPageUrl(value) {
  return typeof value === 'string' && value.length <= 12000
    && /^https:\/\/openapi-sandbox\.dl\.alipaydev\.com\/gateway\.do\?/.test(value)
    && /[?&]method=alipay\.trade\.page\.pay(?:&|$)/.test(value)
}
module.exports = { isSandboxPageUrl, expiryTime }
