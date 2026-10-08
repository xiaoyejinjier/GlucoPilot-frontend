/**
 * 本地离线缓存。
 *
 * 唯一数据源是后端接口（见 services/api.js）：这里只在接口成功返回后落一份缓存，
 * 供小程序冷启动或断网时先渲染上一份数据，不再提供任何演示/兜底假数据。
 */
const { GLUCOSE_NODES } = require('./constants')

function getTodayKey(date) {
  const d = date || new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 今日血糖缓存：{ nodeId: { value, type } }，无数据返回空对象。 */
function getRecords(date) {
  const key = date || getTodayKey()
  const all = wx.getStorageSync('glucoseRecords') || {}
  return all[key] || {}
}

function getAllRecords() {
  return wx.getStorageSync('glucoseRecords') || {}
}

function saveRecord(nodeId, data, date) {
  const key = date || getTodayKey()
  const all = wx.getStorageSync('glucoseRecords') || {}
  if (!all[key]) all[key] = {}
  all[key][nodeId] = data
  wx.setStorageSync('glucoseRecords', all)
  return all[key]
}

/**
 * 使用日看板接口返回的数据覆盖某一天的缓存。
 * 只替换指定日期，保留其他日期，避免一次刷新把历史缓存清空。
 */
function replaceDayRecords(date, records) {
  const key = date || getTodayKey()
  const all = wx.getStorageSync('glucoseRecords') || {}
  all[key] = records || {}
  wx.setStorageSync('glucoseRecords', all)
  return all[key]
}

/** 用接口返回的区间记录整体覆盖缓存，避免本地与后端长期不一致。 */
function replaceRecords(recordsByDate) {
  wx.setStorageSync('glucoseRecords', recordsByDate || {})
}

function getRecordCount(records) {
  return Object.keys(records || {}).length
}

/** 当前用户资料缓存；未登录或未拉取过时返回 null。 */
function getUserInfo() {
  return wx.getStorageSync('userInfo') || null
}

function saveUserInfo(info) {
  wx.setStorageSync('userInfo', info || null)
}

function login(userInfo) {
  wx.setStorageSync('isLoggedIn', true)
  if (userInfo) saveUserInfo(userInfo)
}

function logout() {
  wx.removeStorageSync('isLoggedIn')
  wx.removeStorageSync('accessToken')
  wx.removeStorageSync('userInfo')
  wx.removeStorageSync('glucoseRecords')
}

module.exports = {
  GLUCOSE_NODES,
  getTodayKey,
  getRecords,
  getAllRecords,
  saveRecord,
  replaceDayRecords,
  replaceRecords,
  getRecordCount,
  getUserInfo,
  saveUserInfo,
  login,
  logout
}
