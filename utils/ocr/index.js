const api = require('../../services/api')
const { uploadGlucoseImage } = require('../media')

const STORAGE_KEY = 'pendingGlucoseOcr'
const OCR_BIZ_GLUCOSE = 1
const MAX_POLL_COUNT = 60
const POLL_INTERVAL_MS = 800

function idempotencyKey() {
  return `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pollTask(taskId, count) {
  return api.fetchOcrTask(taskId).then((task) => {
    if (task.taskStatus === 2 || task.taskStatus === 3) return task
    if (count >= MAX_POLL_COUNT) {
      throw new Error('识别等待超时，请手动输入')
    }
    return delay(POLL_INTERVAL_MS).then(() => pollTask(taskId, count + 1))
  })
}

function savePendingOcr(state) {
  const value = { ...state, savedAt: Date.now() }
  try {
    wx.setStorageSync(STORAGE_KEY, value)
  } catch (e) { /* ignore */ }
  const app = getApp()
  if (app && app.globalData) app.globalData.pendingGlucoseOcr = value
  return value
}

function readPendingOcr() {
  const app = getApp()
  const memory = app && app.globalData && app.globalData.pendingGlucoseOcr
  let value = memory
  if (!value) {
    try {
      value = wx.getStorageSync(STORAGE_KEY)
    } catch (e) { /* ignore */ }
  }
  // 防止上一次拍照结果在很久以后误带入新记录。
  if (!value || !value.savedAt || Date.now() - value.savedAt > 30 * 60 * 1000) return null
  return value
}

function clearPendingOcr() {
  const app = getApp()
  if (app && app.globalData) app.globalData.pendingGlucoseOcr = null
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) { /* ignore */ }
}

/** 上传血糖仪照片、创建任务并轮询；失败也返回可供确认页展示的状态。 */
function recognizeGlucoseImage(filePath) {
  let mediaId = ''
  clearPendingOcr()
  return uploadGlucoseImage(filePath)
    .then((media) => {
      mediaId = media.id
      return api.createOcrTask(mediaId, OCR_BIZ_GLUCOSE, idempotencyKey())
    })
    .then((task) => pollTask(task.id, 0))
    .then((task) => {
      const result = task.ocrResult || {}
      return savePendingOcr({
        status: task.taskStatus === 2 && result.suggestedValue != null ? 'success' : 'unreadable',
        mediaId: task.mediaId || mediaId,
        taskId: task.id,
        suggestedValue: result.suggestedValue == null ? '' : String(result.suggestedValue),
        confidence: result.confidence == null ? 0 : result.confidence,
        rawText: result.rawText || '',
        errorMessage: task.taskStatus === 3 ? (task.errorMsg || '识别失败，请手动输入') : ''
      })
    })
    .catch((err) => savePendingOcr({
      status: 'failed',
      mediaId,
      suggestedValue: '',
      confidence: 0,
      rawText: '',
      errorMessage: (err && err.message) || '识别失败，请手动输入'
    }))
}

module.exports = {
  recognizeGlucoseImage,
  readPendingOcr,
  clearPendingOcr
}
