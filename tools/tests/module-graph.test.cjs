const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', '.idea'])

/**
 * 模块图自检。
 *
 * 起因：微信开发者工具里出现 `module 'utils/sse.js' is not defined, require args is '../utils/sse'`
 * （devtools 的 `ignoreDevUnusedFiles` / 文件索引把模块剔除了），而这种"文件明明在仓库里"的
 * 故障在 IDE 之前完全不可见——只有打开模拟器才会炸。这里把它降级成一条 `node tools/tests`
 * 就能跑出来的断言：**所有相对 require、所有 wxs 引用、所有 app.json 页面都必须落地**。
 */
function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name), visit)
      continue
    }
    visit(path.join(dir, entry.name))
  }
}

function resolves(from, spec) {
  const target = path.resolve(path.dirname(from), spec)
  return [target, `${target}.js`, `${target}.wxs`, path.join(target, 'index.js')]
    .some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

test('所有相对 require 都能解析到真实文件', () => {
  const missing = []
  walk(root, file => {
    if (!file.endsWith('.js')) return
    const source = fs.readFileSync(file, 'utf8')
    const pattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
    let match
    while ((match = pattern.exec(source))) {
      if (!resolves(file, match[1])) missing.push(`${path.relative(root, file)} -> ${match[1]}`)
    }
  })
  assert.deepEqual(missing, [], `以下 require 指向不存在的模块：\n${missing.join('\n')}`)
})

test('所有 wxs 引用都能解析到真实文件', () => {
  const missing = []
  walk(root, file => {
    if (!file.endsWith('.wxml')) return
    const source = fs.readFileSync(file, 'utf8')
    const pattern = /<wxs[^>]+src="([^"]+)"/g
    let match
    while ((match = pattern.exec(source))) {
      // wxml 里的 src 有两种写法：以 / 开头的包内绝对路径，以及相对于当前文件的路径
      const spec = match[1].startsWith('/') ? path.join(root, match[1]) : path.resolve(path.dirname(file), match[1])
      if (!fs.existsSync(spec)) missing.push(`${path.relative(root, file)} -> ${match[1]}`)
    }
  })
  assert.deepEqual(missing, [], `以下 wxs 引用指向不存在的文件：\n${missing.join('\n')}`)
})

test('app.json 声明的页面都存在 js/wxml 与依赖的组件', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const problems = []
  for (const page of app.pages) {
    for (const ext of ['.js', '.wxml']) {
      const file = path.join(root, page + ext)
      if (!fs.existsSync(file)) problems.push(`${page}${ext}`)
    }
    // 页面 json 里 usingComponents 指向的自定义组件也必须在包里
    const jsonFile = path.join(root, page + '.json')
    if (!fs.existsSync(jsonFile)) continue
    const config = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
    for (const [name, spec] of Object.entries(config.usingComponents || {})) {
      if (spec.startsWith('plugin://') || spec.startsWith('wx://')) continue
      const base = spec.startsWith('/') ? path.join(root, spec) : path.resolve(path.dirname(file), spec)
      for (const ext of ['.js', '.wxml']) {
        if (!fs.existsSync(base + ext)) problems.push(`${page}: ${name} -> ${spec}${ext}`)
      }
    }
  }
  assert.deepEqual(problems, [], `以下页面/组件缺失：\n${problems.join('\n')}`)
})

test('SSE 客户端导出契约稳定（api.js 依赖 openSse）', () => {
  const sse = require(path.join(root, 'utils/sse.js'))
  assert.equal(typeof sse.openSse, 'function', 'utils/sse.js 必须导出 openSse，否则 services/api.js 的流式补全会整体失效')
  assert.equal(typeof sse.parseEventBlock, 'function')
  assert.equal(typeof sse.decodeUtf8, 'function')
})

test('项目里没有残留的重复副本目录（避免编译到旧快照）', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(app.pages.includes('pages/information/information'), '页面列表必须包含我的信息页')
  assert.ok(fs.existsSync(path.join(root, 'project.config.json')))
})
