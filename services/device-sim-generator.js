/**
 * 按厂商适配器格式随机生成血糖 payload（演示用，非真设备）。
 */

const MOCK_NODES = [
  'before_breakfast',
  'after_breakfast',
  'before_lunch',
  'after_lunch',
  'before_dinner',
  'after_dinner'
]

const HC_MEALS = ['BEFORE_BREAKFAST', 'AFTER_BREAKFAST', 'BEFORE_LUNCH', 'AFTER_LUNCH', 'BEFORE_DINNER', 'AFTER_DINNER']

const PROVIDER_LABELS = {
  MOCK: '模拟血糖仪',
  HUAWEI: '模拟华为设备',
  HEALTH_CONNECT: '模拟 Health Connect',
  APPLE_HEALTH: '模拟苹果健康',
  NIGHTSCOUT: '模拟 Nightscout'
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function randFloat(min, max, digits) {
  const n = min + Math.random() * (max - min)
  const f = 10 ** (digits || 1)
  return Math.round(n * f) / f
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)]
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** OffsetDateTime-ish for adapters that use OffsetDateTime.parse */
function hoursAgoOffset(hours) {
  const d = new Date(Date.now() - hours * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  // Asia/Shanghai fixed +08:00 for demo
  const local = new Date(d.getTime() + 8 * 3600 * 1000)
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+08:00`
}

function hoursAgoMs(hours) {
  return Date.now() - hours * 3600 * 1000
}

function buildMockRandom() {
  const count = randInt(2, 4)
  const nodes = shuffle(MOCK_NODES).slice(0, count)
  const recordDate = todayYmd()
  return {
    readings: nodes.map((nodeCode, i) => ({
      recordDate,
      nodeCode,
      value: randFloat(3.5, 12.0, 1),
      unit: 'MMOL_L',
      externalRecordId: `sim-mock-${recordDate}-${i}-${randInt(1000, 9999)}`
    }))
  }
}

function buildHuaweiRandom() {
  const count = randInt(2, 3)
  const times = shuffle([1, 2, 3, 4, 5, 6]).slice(0, count)
  return {
    samplePoints: times.map((measureTime, i) => ({
      startTime: hoursAgoMs(1 + i * 1.5 + Math.random()),
      originalDataCollectorId: `sim-hw-${randInt(10000, 99999)}`,
      value: [
        { fieldName: 'level', floatValue: randFloat(3.5, 12.0, 1) },
        { fieldName: 'measure_time', integerValue: measureTime }
      ]
    }))
  }
}

function buildNightscoutRandom() {
  const count = randInt(2, 4)
  const list = []
  for (let i = 0; i < count; i++) {
    const date = hoursAgoMs(0.5 + i * 0.75 + Math.random())
    list.push({
      type: 'sgv',
      sgv: randInt(70, 200),
      date,
      dateString: new Date(date).toISOString(),
      _id: `sim-ns-${date}-${randInt(100, 999)}`
    })
  }
  return list
}

function buildHealthConnectRandom() {
  const count = randInt(2, 3)
  const meals = shuffle(HC_MEALS).slice(0, count)
  return {
    records: meals.map((mealType, i) => ({
      id: `sim-hc-${Date.now()}-${i}`,
      level: { millimolesPerLiter: randFloat(3.5, 12.0, 1) },
      time: hoursAgoOffset(1 + i * 1.2),
      mealType
    }))
  }
}

function buildAppleHealthRandom() {
  const count = randInt(2, 3)
  const mealCodes = shuffle([1, 2, 3, 4, 5, 6]).slice(0, count)
  return {
    samples: mealCodes.map((mealTime, i) => ({
      uuid: `sim-apple-${Date.now()}-${i}-${randInt(100, 999)}`,
      quantity: randFloat(3.5, 12.0, 1),
      unit: 'mmol/L',
      startDate: hoursAgoOffset(1 + i * 1.1),
      metadata: {
        HKMetadataKeyBloodGlucoseMealTime: mealTime
      }
    }))
  }
}

/**
 * @param {string} provider
 * @returns {object|array}
 */
function buildRandomPayload(provider) {
  const code = String(provider || '').toUpperCase()
  switch (code) {
    case 'MOCK':
      return buildMockRandom()
    case 'HUAWEI':
      return buildHuaweiRandom()
    case 'NIGHTSCOUT':
      return buildNightscoutRandom()
    case 'HEALTH_CONNECT':
      return buildHealthConnectRandom()
    case 'APPLE_HEALTH':
      return buildAppleHealthRandom()
    default:
      throw new Error('不支持的厂商: ' + provider)
  }
}

function providerLabel(provider) {
  const code = String(provider || '').toUpperCase()
  return PROVIDER_LABELS[code] || `模拟${code}`
}

/** @returns {string} */
function generateSimDeviceSn(provider) {
  const code = String(provider || 'MOCK').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const tail = String(Date.now()).slice(-6)
  const rand = String(randInt(1000, 9999))
  return `SIM-${code}-${tail}-${rand}`
}

module.exports = {
  buildRandomPayload,
  providerLabel,
  generateSimDeviceSn,
  PROVIDER_LABELS
}
