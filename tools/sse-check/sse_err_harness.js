/**
 * 校验开流前的校验失败（HTTP 4xx + 统一 JSON 错误体）能否被 openSse 正确转成 onError。
 * 用法：node tools/sse-check/sse_err_harness.js <fixtures/err404.bin> <frontendDir> <statusCode>
 */
const fs = require('fs')
const path = require('path')

const rawPath = process.argv[2]
// require 的相对路径按脚本目录解析，这里统一转绝对路径，便于从仓库根目录直接跑
const feDir = path.resolve(process.argv[3])
const statusCode = parseInt(process.argv[4] || '404', 10)

const bytes = fs.readFileSync(rawPath)
const expectedBody = JSON.parse(bytes.toString('utf8'))

global.wx = {
  getStorageSync: () => 'test-token',
  request: (opts) => {
    const task = {
      onChunkReceived(cb) {
        task._cb = cb
      },
      abort() {}
    }
    setTimeout(() => {
      // 错误响应同样可能分片到达
      for (let i = 0; i < bytes.length; i += 5) {
        const c = bytes.subarray(i, Math.min(i + 5, bytes.length))
        task._cb({ data: c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) })
      }
      opts.success({ statusCode })
    }, 0)
    return task
  }
}

const { openSse } = require(path.join(feDir, 'utils', 'sse.js'))

const events = []
let streamError = null
let completed = false

openSse({
  url: '/chat-sessions/99999/completions',
  data: {},
  onEvent: (name, payload) => events.push({ name, payload }),
  onError: (e) => {
    streamError = e
  },
  onComplete: () => {
    completed = true
    const errors = []
    if (!streamError) errors.push('未触发 onError（错误响应被当成正常流了）')
    else {
      if (streamError.code !== expectedBody.code) {
        errors.push(`code 期望 ${expectedBody.code}，实际 ${streamError.code}`)
      }
      if (streamError.message !== expectedBody.message) {
        errors.push(`message 未原样透出，期望「${expectedBody.message}」，实际「${streamError.message}」`)
      }
    }
    if (!completed) errors.push('onComplete 未触发（页面会一直卡在“回复中”）')
    if (events.length) errors.push('错误响应不该产生业务事件，实际: ' + JSON.stringify(events))

    console.log(
      JSON.stringify(
        {
          statusCode,
          errorCaught: !!streamError,
          code: streamError && streamError.code,
          message: streamError && streamError.message,
          completed,
          businessEvents: events.length,
          errors
        },
        null,
        2
      )
    )
    process.exit(errors.length ? 1 : 0)
  }
})
