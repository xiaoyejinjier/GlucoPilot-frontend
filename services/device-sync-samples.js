/**
 * 设备同步总线 — 一期受控样例入口。
 * 结构对齐后端测试 payload（华为 Health Kit samplePoints / Nightscout entries），
 * 非厂家云实拉；二期可替换为真 Ingress。
 */

function hoursAgoMs(hours) {
  return Date.now() - hours * 60 * 60 * 1000
}

function buildHuaweiSample() {
  // measure_time: 1 早餐前、2 早餐后
  return {
    samplePoints: [
      {
        startTime: hoursAgoMs(3),
        originalDataCollectorId: 'demo-hw-collector',
        value: [
          { fieldName: 'level', floatValue: 6.7 },
          { fieldName: 'measure_time', integerValue: 1 }
        ]
      },
      {
        startTime: hoursAgoMs(2),
        originalDataCollectorId: 'demo-hw-collector',
        value: [
          { fieldName: 'level', floatValue: 8.2 },
          { fieldName: 'measure_time', integerValue: 2 }
        ]
      }
    ]
  }
}

function buildNightscoutSample() {
  const t1 = hoursAgoMs(4)
  const t2 = hoursAgoMs(3.5)
  return [
    {
      type: 'sgv',
      sgv: 110,
      date: t1,
      dateString: new Date(t1).toISOString(),
      _id: 'demo-ns-1'
    },
    {
      type: 'sgv',
      sgv: 120,
      date: t2,
      dateString: new Date(t2).toISOString(),
      _id: 'demo-ns-2'
    }
  ]
}

/**
 * @param {string} provider
 * @returns {object|array|null}
 */
function getIngressPayload(provider) {
  const code = String(provider || '').toUpperCase()
  if (code === 'HUAWEI') return buildHuaweiSample()
  if (code === 'NIGHTSCOUT') return buildNightscoutSample()
  return null
}

module.exports = {
  getIngressPayload,
  buildHuaweiSample,
  buildNightscoutSample
}
