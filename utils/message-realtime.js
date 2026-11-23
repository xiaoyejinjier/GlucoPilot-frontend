const config = require('./config')
const { getToken, setToken } = require('./request')

// 整个小程序共用一条前台连接，聊天页只订阅，不各自重复建立连接。
let enabled = false, socket = null, token = '', baseUrl = '', generation = 0
let ready = false, retry = null, heartbeat = null, opening = null, failures = 0, lastPong = 0
const listeners = new Set(), pending = new Map()

function emit(event) {
  for (const listener of listeners) { try { listener(event) } catch (_) {} }
}
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
function current(version = generation) {
  return enabled && version === generation && token === getToken() && baseUrl === config.baseUrl
}
function connected() { return current() && ready && !!socket }
function rejectPending(message) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(message)) }
  pending.clear()
}
function clearTimers() {
  if (retry) clearTimeout(retry)
  if (opening) clearTimeout(opening)
  if (heartbeat) clearInterval(heartbeat)
  retry = opening = heartbeat = null
}
function stop() {
  enabled = false; ready = false; generation++; clearTimers()
  const previous = socket; socket = null
  rejectPending('连接已断开，可重试发送')
  if (previous) { try { previous.close({ code:1000, reason:'Page background or account changed' }) } catch (_) {} }
}
function lost(version) {
  if (!current(version)) return
  const previous = socket; socket = null; ready = false
  generation++; clearTimers(); rejectPending('发送结果尚未确认，请重试；不会重复保存')
  if (previous) { try { previous.close({ code:1000 }) } catch (_) {} }
  emit({ type:'DISCONNECTED' })
  const next = generation
  const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(failures++, 5)))
  retry = setTimeout(() => { retry = null; if (current(next)) connect() }, delay)
}
function expire(version, envelope) {
  if (!current(version)) return
  const original = token
  stop()
  if (getToken() !== original) return
  setToken(''); wx.setStorageSync('isLoggedIn', false)
  const app = typeof getApp === 'function' ? getApp() : null
  if (app && typeof app.handleSessionExpired === 'function') app.handleSessionExpired(original, envelope.message)
}
function receive(version, event) {
  if (!current(version)) return
  let envelope
  try { envelope = JSON.parse(event.data) } catch (_) { return }
  if (!envelope || typeof envelope.code !== 'number' || !envelope.data) return
  const data = envelope.data
  if (envelope.code === 40100 || envelope.code === 40101 || envelope.code === 40300) return expire(version, envelope)
  if (envelope.code !== 0) {
    const entry = pending.get(data.clientRequestId)
    if (entry) {
      clearTimeout(entry.timer); pending.delete(data.clientRequestId)
      entry.reject(Object.assign(new Error(envelope.message || '消息发送失败'), { code:envelope.code, requestId:envelope.requestId }))
    }
    return
  }
  if (data.type === 'READY') {
    if (ready) return
    ready = true; failures = 0; lastPong = Date.now()
    if (opening) clearTimeout(opening)
    opening = null
    heartbeat = setInterval(() => {
      if (!current(version)) return
      if (Date.now() - lastPong > 60000) return lost(version)
      socket.send({ data:JSON.stringify({ type:'PING' }), fail:() => lost(version) })
    }, 25000)
    emit({ type:'CONNECTED' })
  } else if (data.type === 'PONG') lastPong = Date.now()
  else if (data.type === 'SENT') {
    const entry = pending.get(data.clientRequestId)
    if (!entry) return
    // 确认必须对应当前发送的接收者，不能误用其他请求的结果。
    if (!data.message || String(data.message.recipientId) !== entry.peer) return
    clearTimeout(entry.timer); pending.delete(data.clientRequestId); entry.resolve(data.message)
  } else if (data.type === 'DM_CHANGED' && /^[1-9]\d{0,18}$/.test(String(data.peerUserId || ''))) emit(data)
}
function connect() {
  if (!current() || socket || typeof wx.connectSocket !== 'function') return
  const version = generation
  try {
    socket = wx.connectSocket({
      url:baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/community/messages/socket',
      header:{ Authorization:`Bearer ${token}` },
      // 提供success避免部分基础库将返回值包装成Promise；使用独立SocketTask事件。
      success() {}, fail:() => lost(version)
    })
    socket.onMessage(event => receive(version, event))
    socket.onError(() => lost(version))
    socket.onClose(event => {
      if (!current(version)) return
      // 被服务端关闭时由下一次汇总请求核对HTTP身份，不能无限保留旧会话。
      lost(version)
    })
    opening = setTimeout(() => lost(version), 10000)
  } catch (_) { lost(version) }
}
function start() {
  const accessToken = getToken(), address = config.baseUrl
  if (!accessToken || !/^https?:\/\//.test(address) || (config.connectionIssue && config.connectionIssue())) return stop()
  if (enabled && token === accessToken && baseUrl === address) return
  stop(); token = accessToken; baseUrl = address; enabled = true; failures = 0; connect()
}
function send(peer, payload) {
  if (!connected()) return null // 尚未发送任何帧，安全回退原HTTP接口。
  const id = payload.clientRequestId, recipient = String(peer)
  const existing = pending.get(id)
  if (existing) return existing.promise
  const version = generation
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  const timer = setTimeout(() => {
    if (!current(version) || !pending.has(id)) return
    pending.delete(id); reject(new Error('发送结果尚未确认，请重试；不会重复保存'))
  }, 15000)
  pending.set(id, { peer:recipient, promise, resolve, reject, timer })
  try {
    socket.send({ data:JSON.stringify({ type:'SEND', peerUserId:recipient, ...payload }), fail:() => lost(version) })
  } catch (_) { lost(version) }
  return promise
}
module.exports = { start, stop, subscribe, connected, send }
