/**
 * 微信小程序 SSE 客户端：wx.request({ enableChunked: true }) + onChunkReceived。
 *
 * 四个必须注意的点（踩了不是乱码就是丢事件）：
 * 1) chunk 边界会切断多字节 UTF-8：必须按字节累积，遇到结尾不完整的序列要留到下一块再解码；
 * 2) 同理不能假设「一个 chunk = 一个事件」：要按空行切事件，并保留半截事件；
 * 3) 不能用 String.fromCharCode 直接转 ArrayBuffer —— 中文必乱码；
 * 4) 换行归一化必须在**字节/字符累积之后**做，不能逐块 replace('\r\n')：
 *    chunk 边界可能正好落在 \r 与 \n 之间，逐块处理永远看不见被切开的 \r\n
 *    —— 分隔符会一直保持 \r\n\r\n，而事件切分只认 \n\n，结果是整条流一个事件都解析不出来。
 *    这是 tools/sse-check 在 chunkSize=1 时抓到的真实缺陷（2026-10-14 修复）。
 */
const config = require('./config')
const { getToken } = require('./request')

/** 异常情况下防止缓冲无界增长 */
const MAX_TEXT_BUFFER = 256 * 1024

/**
 * 把累积缓冲里的换行统一成 {@code \n}。
 * <p>
 * 结尾孤立的 {@code \r} 原样保留，留到下一块再判断：它很可能正是被 chunk 切断的 {@code \r\n} 的前半截，
 * 此刻换成 {@code \n} 会让一个事件分隔符被拆成两个空行（把一条事件切成两半）。
 * 中间孤立的 {@code \r}（老式 CR 行尾）才换成 {@code \n}。
 */
function normalizeNewlines(text) {
  let head = text
  let tail = ''
  if (head.charAt(head.length - 1) === '\r') {
    head = head.slice(0, -1)
    tail = '\r'
  }
  return head.replace(/\r\n/g, '\n').replace(/\r/g, '\n') + tail
}

function toUint8Array(data) {
  if (!data) return new Uint8Array(0)
  if (data instanceof Uint8Array) return data
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data)
}

function concatBytes(a, b) {
  if (!a.length) return b
  if (!b.length) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * 解码 UTF-8 字节流。
 * @returns {{text: string, rest: Uint8Array}} rest 为结尾处不完整的多字节序列
 */
function decodeUtf8(bytes) {
  let text = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    let code
    let len
    if (b < 0x80) {
      code = b
      len = 1
    } else if ((b & 0xe0) === 0xc0) {
      len = 2
      code = b & 0x1f
    } else if ((b & 0xf0) === 0xe0) {
      len = 3
      code = b & 0x0f
    } else if ((b & 0xf8) === 0xf0) {
      len = 4
      code = b & 0x07
    } else {
      i += 1 // 非法起始字节，跳过
      continue
    }
    if (i + len > bytes.length) break // 序列被 chunk 切断，留给下一块
    let valid = true
    for (let k = 1; k < len; k += 1) {
      const next = bytes[i + k]
      if ((next & 0xc0) !== 0x80) {
        valid = false
        break
      }
      code = (code << 6) | (next & 0x3f)
    }
    if (!valid) {
      i += 1
      continue
    }
    text += String.fromCodePoint(code)
    i += len
  }
  return { text, rest: bytes.slice(i) }
}

/** 解析单个 SSE 事件块，返回 { event, data } 或 null */
function parseEventBlock(block) {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    if (line.charAt(0) === ':') continue // 注释行（后端用它做连接保活）
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.charAt(0) === ' ') value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length) return null
  return { event, data: dataLines.join('\n') }
}

/**
 * 打开一条 SSE 流。
 * @param {object} options
 * @param {string} options.url 相对 config.baseUrl 的路径（也接受绝对地址）
 * @param {object} options.data 请求体（内部 JSON.stringify）
 * @param {function} options.onEvent (eventName, payload) => void
 * @param {function} [options.onError] (Error) => void
 * @param {function} [options.onComplete] () => void
 * @returns {{abort: function}}
 */
function openSse(options) {
  const { url, data, onEvent, onError, onComplete } = options

  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let pendingBytes = new Uint8Array(0)
  let textBuffer = ''
  let rawText = '' // 非 SSE 响应（统一错误 JSON）的兜底解析
  let terminal = false // 已收到 done / error
  let closed = false

  const emit = (name, payload) => {
    if (typeof onEvent === 'function') onEvent(name, payload)
  }

  const handleText = (text) => {
    // 归一化放在累积之后，理由见文件头第 4 条与 normalizeNewlines 的注释
    textBuffer = normalizeNewlines(textBuffer + text)
    if (textBuffer.length > MAX_TEXT_BUFFER) {
      textBuffer = textBuffer.slice(-MAX_TEXT_BUFFER)
    }
    let idx = textBuffer.indexOf('\n\n')
    while (idx !== -1) {
      const block = textBuffer.slice(0, idx)
      textBuffer = textBuffer.slice(idx + 2)
      const parsed = parseEventBlock(block)
      if (parsed) {
        if (parsed.event === 'done' || parsed.event === 'error') terminal = true
        let payload = parsed.data
        try {
          payload = JSON.parse(parsed.data)
        } catch (e) {
          // 非 JSON 就按原文透出
        }
        emit(parsed.event, payload)
      }
      idx = textBuffer.indexOf('\n\n')
    }
  }

  const finish = (err) => {
    if (closed) return
    closed = true
    if (err && typeof onError === 'function') onError(err)
    if (typeof onComplete === 'function') onComplete()
  }

  if (typeof wx === 'undefined' || !wx.request) {
    finish(new Error('当前环境不支持网络请求'))
    return { abort() {} }
  }

  const task = wx.request({
    url: url.indexOf('http') === 0 ? url : `${config.baseUrl}${url}`,
    method: 'POST',
    data: JSON.stringify(data || {}),
    header: headers,
    enableChunked: true,
    success: (res) => {
      // 已正常收到 done/error，按正常结束处理
      if (!terminal) {
        // 开流前的校验失败会返回统一 JSON 错误体（HTTP 4xx/5xx），这里兜底解析。
        // ⚠️ body 的来源有三种可能，必须都试过再放弃，否则会把后端写好的中文原因吞成
        //    「请求失败(400)」这种无用文案（本项目真实发生过）：
        //   1) res.data 已经是对象——Content-Type: application/json 时小程序会自动解析；
        //   2) res.data 是字符串；
        //   3) 走 onChunkReceived 累积的 rawText——个别基础库会把非流式响应也按 chunk 派发。
        let parsed = null
        if (res.data && typeof res.data === 'object') {
          parsed = res.data
        } else {
          const raw = String(res.data || rawText || textBuffer || '').trim()
          try {
            parsed = JSON.parse(raw)
          } catch (e) {
            parsed = null
          }
        }
        if (parsed && typeof parsed.code !== 'undefined' && parsed.code !== 0) {
          finish(Object.assign(new Error(parsed.message || `请求失败(${res.statusCode})`), {
            code: parsed.code,
            statusCode: res.statusCode,
            body: parsed
          }))
          return
        }
        if (res.statusCode >= 400) {
          const err = Object.assign(new Error(`请求失败(${res.statusCode})`), { statusCode: res.statusCode })
          if (res.statusCode === 401) err.code = 40100
          finish(err)
          return
        }
      }
      finish()
    },
    fail: (err) => {
      // 主动 abort 也会触发 fail，此时 closed 已置位，不再回调
      finish(Object.assign(new Error((err && err.errMsg) || '网络异常'), { network: true, err }))
    }
  })

  if (task && typeof task.onChunkReceived === 'function') {
    task.onChunkReceived((res) => {
      if (closed) return
      const bytes = concatBytes(pendingBytes, toUint8Array(res.data))
      const decoded = decodeUtf8(bytes)
      pendingBytes = decoded.rest
      if (!decoded.text) return
      // 刻意不在这里做换行归一化：chunk 边界会切开 \r\n（见文件头第 4 条）
      rawText += decoded.text
      handleText(decoded.text)
    })
  } else {
    finish(new Error('当前微信基础库不支持流式响应，请升级微信版本'))
  }

  return {
    abort() {
      closed = true
      try {
        task.abort()
      } catch (e) {
        // ignore
      }
    }
  }
}

module.exports = {
  openSse,
  decodeUtf8,
  parseEventBlock
}
