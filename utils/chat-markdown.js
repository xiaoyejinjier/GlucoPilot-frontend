// 仅生成受控的富文本节点；模型返回的 HTML、链接和图片不会作为标签执行或加载。
function textNode(text) { return { type: 'text', text } }
function element(name, children, style) {
  return { name, attrs: style ? { style } : {}, children }
}

function inlineNodes(source, pending = false, depth = 0) {
  if (depth > 6) return [textNode(source)]
  const nodes = []
  let plain = ''
  const flush = () => { if (plain) { nodes.push(textNode(plain)); plain = '' } }
  for (let cursor = 0; cursor < source.length;) {
    // 转义和代码里的星号属于原文，不当作强调标记。
    if (source[cursor] === '\\' && /[\\*_`#]/.test(source[cursor + 1] || '')) {
      plain += source[cursor + 1]; cursor += 2; continue
    }
    if (source[cursor] === '`') {
      const delimiter = source.slice(cursor).match(/^`+/)[0]
      const end = source.indexOf(delimiter, cursor + delimiter.length)
      if (end >= 0) {
        flush()
        nodes.push(element('code', [textNode(source.slice(cursor + delimiter.length, end))],
          'font-family:monospace;background:#f1f4f7;border-radius:3px;padding:0 3px;'))
        cursor = end + delimiter.length; continue
      }
    }
    const rest = source.slice(cursor)
    const marker = ['***', '___', '**', '__'].find(value => rest.startsWith(value))
    // 2**3 等运算表达式保留原样。
    if (marker && !(marker === '**' && /\d/.test(source[cursor - 1] || '') && /\d/.test(source[cursor + 2] || ''))) {
      let end = source.indexOf(marker, cursor + marker.length)
      while (end > 0 && source[end - 1] === '\\') end = source.indexOf(marker, end + marker.length)
      if (end >= 0 || pending) {
        flush()
        const body = source.slice(cursor + marker.length, end >= 0 ? end : source.length)
        if (body) {
          const children = inlineNodes(body, pending && end < 0, depth + 1)
          nodes.push(element('strong', marker.length === 3 ? [element('em', children)] : children, 'font-weight:600;'))
        }
        cursor = end >= 0 ? end + marker.length : source.length
        continue
      }
    }
    // 流式分块可能正好停在开头/结尾标记的第一个星号，等下一块补齐再显示。
    if (pending && cursor === source.length - 1 && source[cursor] === '*') break
    plain += source[cursor++]
  }
  flush()
  return nodes
}

function renderChatMarkdown(value, pending = false) {
  const source = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
  if (!source) return []
  const blocks = []
  let paragraph = [], codeLines = null, fence = ''
  const addBlock = (children, extraStyle = '') => {
    blocks.push(element('div', children, 'white-space:pre-wrap;word-break:break-word;line-height:1.65;' +
      (blocks.length ? 'margin-top:8px;' : '') + extraStyle))
  }
  const flushParagraph = () => {
    if (paragraph.length) { addBlock(inlineNodes(paragraph.join('\n'), pending)); paragraph = [] }
  }
  for (const line of source.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (codeLines) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        addBlock([textNode(codeLines.join('\n'))], 'font-family:monospace;background:#f1f4f7;padding:8px;border-radius:6px;')
        codeLines = null
      } else codeLines.push(line)
      continue
    }
    if (fenceMatch) { flushParagraph(); codeLines = []; fence = fenceMatch[1]; continue }
    if (!line.trim()) { flushParagraph(); continue }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/)
    const list = line.match(/^\s*[-+*]\s+(.+)$/)
    if (heading || list) {
      flushParagraph()
      addBlock(inlineNodes(heading ? heading[1] : '• ' + list[1], pending), heading ? 'font-weight:600;' : '')
    } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph()
    } else paragraph.push(line)
  }
  flushParagraph()
  if (codeLines) addBlock([textNode(codeLines.join('\n'))], 'font-family:monospace;background:#f1f4f7;padding:8px;border-radius:6px;')
  return blocks
}

module.exports = { renderChatMarkdown }
