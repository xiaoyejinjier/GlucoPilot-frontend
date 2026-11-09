const PinyinMatch = require('./pinyin-match')

function highlightTitle(title, keyword) {
  const text = String(title || '')
  const key = String(keyword || '').trim()
  if (!text || !key) return { before: text, match: '', after: '' }
  const lower = text.toLowerCase()
  const literal = lower.indexOf(key.toLowerCase())
  if (literal >= 0) {
    return {
      before: text.slice(0, literal),
      match: text.slice(literal, literal + key.length),
      after: text.slice(literal + key.length)
    }
  }
  const range = PinyinMatch.match(text, key)
  if (!range || range.length < 2) return { before: text, match: '', after: '' }
  const start = range[0]
  const end = range[1] + 1
  return {
    before: text.slice(0, start),
    match: text.slice(start, end),
    after: text.slice(end)
  }
}

module.exports = { highlightTitle }
