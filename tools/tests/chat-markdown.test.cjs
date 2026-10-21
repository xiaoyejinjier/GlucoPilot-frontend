const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { renderChatMarkdown } = require('../../utils/chat-markdown')
const root = path.resolve(__dirname, '../..')
const text = nodes => nodes.map(node => node.type === 'text' ? node.text : text(node.children || [])).join('')
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])])

test('AI常见加粗、三重强调和下划线加粗变成受控样式，保留数字和中文', () => {
  const source = '建议**记录血糖 5.2 mmol/L**，并关注 __运动情况__ 与 ***饮食搭配***。'
  const nodes = renderChatMarkdown(source)
  assert.equal(text(nodes), '建议记录血糖 5.2 mmol/L，并关注 运动情况 与 饮食搭配。')
  assert.equal(all(nodes).filter(node => node.name === 'strong').length, 3)
  assert.equal(all(nodes).filter(node => node.name === 'em').length, 1)
  assert.ok(source.includes('**')) // 展示转换不修改接口原文。
})

test('标题、列表、分段和段内换行正常展示，带加粗的多行内容不丢失', () => {
  const nodes = renderChatMarkdown('## **今日建议**\r\n\r\n- **饮食**：记录早餐\n* 运动：散步\n\n**第一行\n第二行**\n\n1. 继续记录\n2. 查看统计\n---')
  assert.equal(nodes.length, 5)
  assert.equal(text(nodes[0].children), '今日建议')
  assert.match(nodes[0].attrs.style, /font-weight:600/)
  assert.equal(text(nodes[1].children), '• 饮食：记录早餐')
  assert.equal(text(nodes[2].children), '• 运动：散步')
  assert.equal(text(nodes[3].children), '第一行\n第二行')
  assert.equal(text(nodes[4].children), '1. 继续记录\n2. 查看统计')
})

test('流式回复在星号标记被拆开时不闪出标记，完成后与历史格式一致', () => {
  const source = '**建议**：先记录，再**分析血糖**。'
  for (let length = 1; length <= source.length; length++) {
    const nodes = renderChatMarkdown(source.slice(0, length), true)
    assert.equal(text(nodes).includes('*'), false, source.slice(0, length))
  }
  assert.deepEqual(renderChatMarkdown(source, true), renderChatMarkdown(source, false))
  assert.equal(text(renderChatMarkdown('**建议', true)), '建议')
})

test('代码、转义星号和运算表达式保留，不误删用户需要阅读的字符', () => {
  assert.equal(text(renderChatMarkdown('2 * 3 = 6，2**3 = 8，`**原始标记**`，\\*\\*文字\\*\\*')),
    '2 * 3 = 6，2**3 = 8，**原始标记**，**文字**')
  const code = renderChatMarkdown('```text\n**原文**\n2 * 3\n```')
  assert.equal(text(code), '**原文**\n2 * 3')
  assert.equal(all(code).some(node => node.name === 'strong'), false)
  assert.equal(text(renderChatMarkdown('```text\n**未结束的代码', true)), '**未结束的代码')
})

test('模型返回的HTML、图片和链接只作为文本显示，不生成可执行或远程节点', () => {
  const source = '<script>alert(1)</script><img src="https://example.invalid/tracker"> [链接](javascript:alert(1))'
  const nodes = renderChatMarkdown(source)
  assert.equal(text(nodes), source)
  const names = all(nodes).filter(node => node.name).map(node => node.name)
  assert.deepEqual(names, ['div'])
  assert.equal(all(nodes).some(node => node.attrs && (node.attrs.src || node.attrs.href)), false)
})

test('空输入、非法输入和未闭合的完整消息不崩溃或丢失原文', () => {
  for (const value of ['', null, undefined, 123, {}]) assert.deepEqual(renderChatMarkdown(value), [])
  assert.equal(text(renderChatMarkdown('尚未闭合 **提示')), '尚未闭合 **提示')
  assert.equal(text(renderChatMarkdown('0 和 3.9 < 10\n正常换行')), '0 和 3.9 < 10\n正常换行')
})

test('富文本组件同时覆盖流式和历史内容，未变的旧消息不会重复解析', () => {
  let definition, updates = 0
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/chat-markdown/chat-markdown.js'), 'utf8'), {
    Component: value => { definition = value }, require: () => ({ renderChatMarkdown })
  })
  const component = { data: { nodes: [] }, setData(values) { updates++; Object.assign(this.data, values) } }
  const change = (content, pending) => definition.observers['content, pending'].call(component, content, pending)
  change('**血', true)
  assert.equal(text(component.data.nodes), '血')
  change('**血糖** 5.2', true)
  assert.equal(text(component.data.nodes), '血糖 5.2')
  change('**血糖** 5.2', false)
  change('**血糖** 5.2', false)
  assert.equal(updates, 3)
  change('历史 **建议**', false)
  assert.equal(text(component.data.nodes), '历史 建议')
  change('', true)
  assert.deepEqual(component.data.nodes, [])
})

test('小语仅将AI回复交给格式组件，用户原文、加载提示和重试入口保留', () => {
  const template = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/voice/voice.json'), 'utf8'))
  assert.equal(config.usingComponents['chat-markdown'], '/components/chat-markdown/chat-markdown')
  assert.match(template, /<chat-markdown wx:elif="\{\{item.role !== 'user'\}\}" content="\{\{item.content\}\}" pending="\{\{item.pending\}\}"/)
  assert.match(template, /<text wx:else>\{\{item.content\}\}<\/text>/)
  assert.match(template, /正在思考…/)
  assert.match(template, /bindtap="onRetry"/)
})
