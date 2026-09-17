const { GLUCOSE_NODES } = require('./constants')

const DEFAULT_USER = {
  nickname: '吴先生',
  avatarText: '吴',
  diabetesType: '2 型糖尿病',
  age: 42,
  confirmDate: '2021-06',
  medication: '二甲双胍 0.5g bid',
  exercise: '每周快走 3 次'
}

const DEFAULT_RECORDS = {
  before_breakfast: { value: 5.8, type: 'glucose' },
  after_breakfast: { value: 7.6, type: 'glucose' },
  before_lunch: { value: 6.1, type: 'glucose' }
}

function getTodayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRecords(date) {
  const key = date || getTodayKey()
  const all = wx.getStorageSync('glucoseRecords') || {}
  return all[key] || { ...DEFAULT_RECORDS }
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

function getRecordCount(records) {
  return Object.keys(records || {}).length
}

function getUserInfo() {
  return wx.getStorageSync('userInfo') || { ...DEFAULT_USER }
}

function saveUserInfo(info) {
  wx.setStorageSync('userInfo', { ...DEFAULT_USER, ...info })
}

function login(userInfo) {
  wx.setStorageSync('isLoggedIn', true)
  if (userInfo) saveUserInfo(userInfo)
}

function logout() {
  wx.removeStorageSync('isLoggedIn')
  wx.removeStorageSync('accessToken')
}

/** 日历打卡：1–3 红 / 4–6 橙 / ≥7 绿；部分天为 0 不着色 */
function getCalendarData(year, month) {
  const data = {}
  const all = getAllRecords()
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const daysInMonth = new Date(year, month, 0).getDate()
  // 示意次数：含若干 0，颜色按次数映射（非乱标）
  const demoCounts = [2, 0, 5, 1, 0, 7, 3, 0, 6, 4, 8, 0, 2, 9, 1, 0, 5, 3, 0, 7, 4, 0, 6, 2, 0, 8, 3, 0, 5, 1, 0]

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${pad(month)}-${pad(d)}`
    const dayRec = all[key]
    let count = dayRec ? Object.keys(dayRec).length : 0
    if (!dayRec) {
      count = demoCounts[(d - 1) % demoCounts.length]
    }
    if (count <= 0) continue

    // a=绿 b=橙 c=红（图例色不变）：1–3→红c，4–6→橙b，≥7→绿a
    let level = 'c'
    if (count >= 7) level = 'a'
    else if (count >= 4) level = 'b'

    data[d] = { level, count }
  }
  return data
}

module.exports = {
  GLUCOSE_NODES,
  getTodayKey,
  getRecords,
  getAllRecords,
  saveRecord,
  getRecordCount,
  getUserInfo,
  saveUserInfo,
  login,
  logout,
  getCalendarData,
  DEFAULT_USER
}
