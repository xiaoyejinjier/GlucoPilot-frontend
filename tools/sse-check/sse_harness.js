/**
 * 用真实后端抓下来的 SSE 字节流，喂给 frontend/utils/sse.js 的 openSse，
 * 校验「按字节缓冲 + 跨 chunk UTF-8 解码 + 事件切分」在任意分片边界下都不丢事件、不乱码。
 *
 * 用法：node tools/sse-check/sse_harness.js <fixtures/sse_raw.bin> <frontendDir> <chunkSize>
 */
const fs = require('fs')
const path = require('path')

const rawPath = process.argv[2]
// require 的相对路径按脚本目录解析，这里统一转绝对路径，便于从仓库根目录直接跑
const feDir = path.resolve(process.argv[3])
const chunkSize = parseInt(process.argv[4] || '7', 10)

const bytes = fs.readFileSync(rawPath)
const chunks = []
for (let i = 0; i < bytes.length; i += chunkSize) {
  chunks.push(bytes.subarray(i, Math.min(i + chunkSize, bytes.length)))
}

let task = null
global.wx = {
  getStorageSync: () => 'test-token',
  request: (opts) => {
    task = {
      onChunkReceived(cb) {
        task._cb = cb
      },
      abort() {
        task._aborted = true
      }
    }
    // 异步回放：真实 wx 也是先返回 task，再持续回调 onChunkReceived
    setTimeout(() => {
      for (const c of chunks) {
        const ab = c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength)
        task._cb({ data: ab })
      }
      opts.success({ statusCode: 200 })
    }, 0)
    return task
  }
}

const { openSse } = require(path.join(feDir, 'utils', 'sse.js'))

const events = []
let streamError = null
let completed = false

openSse({
  url: '/chat-sessions/1/completions',
  data: { clientMsgId: 'cap1', replyToMsgId: '1', stream: true },
  onEvent: (name, payload) => events.push({ name, payload }),
  onError: (e) => {
    streamError = e
  },
  onComplete: () => {
    completed = true

    const deltas = events.filter((e) => e.name === 'delta')
    const joined = deltas.map((e) => (e.payload && e.payload.delta) || '').join('')
    const done = events.find((e) => e.name === 'done')

    const errors = []
    if (streamError) errors.push('onError 被触发: ' + streamError.message)
    if (!completed) errors.push('onComplete 未触发')
    if (deltas.length === 0) errors.push('没有解析到任何 delta 事件')
    if (!done) errors.push('没有解析到 done 事件')

    if (done) {
      const expected = done.payload.contentText || ''
      if (joined !== expected) {
        errors.push('delta 拼接结果与 done.contentText 不一致')
        errors.push('  delta 长度=' + joined.length + ' done 长度=' + expected.length)
      }
      if (done.payload.finishReason !== 1) errors.push('finishReason 异常: ' + done.payload.finishReason)
      if (!done.payload.assistantMsgId) errors.push('done 缺少 assistantMsgId')
    }

    // 中文必须完好：出现 U+FFFD 替换符说明解码有损
    if (joined.indexOf('\uFFFD') !== -1) errors.push('解码出现替换符 U+FFFD（说明 UTF-8 处理有损）')

    const result = {
      chunkSize,
      totalBytes: bytes.length,
      chunks: chunks.length,
      deltaEvents: deltas.length,
      hasDone: !!done,
      completed,
      textLength: joined.length,
      sample: joined.slice(0, 40),
      errors
    }
    console.log(JSON.stringify(result, null, 2))
    process.exit(errors.length ? 1 : 0)
  }
})
