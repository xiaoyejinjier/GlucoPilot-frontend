/** 型号未定前，仅登记候选信息；不持久化令牌/设备、不制造“已绑定”。 */
let sessionToken = ''
let drafts = []

function forSession(token) {
  if (sessionToken !== token) { sessionToken = token || ''; drafts = [] }
  if (!token) drafts = []
  return drafts
}

function validateSerial(value) {
  if (typeof value !== 'string') throw new Error('请输入设备 SN 码')
  const sn = value.trim().replace(/^SN\s*[:：]\s*/i, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(sn)) {
    throw new Error('SN 须为 4–64 位字母、数字、点、横线或下划线，且以字母或数字开头')
  }
  return sn
}

function parseDeviceCode(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('无法识别设备码，请改用 SN 添加')
  const raw = value.trim()
  if (raw.startsWith('{')) {
    let item
    try { item = JSON.parse(raw) } catch (_) { throw new Error('设备码格式不正确，请手动输入 SN') }
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('设备码格式不正确，请手动输入 SN')
    return { sn: validateSerial(item.sn || item.serialNumber),
      name: typeof item.deviceName === 'string' ? item.deviceName.trim().slice(0, 40) : '' }
  }
  if (/^https?:\/\//i.test(raw)) {
    const match = raw.match(/[?&](?:sn|serialNumber)=([^&#]*)/i)
    if (!match) throw new Error('二维码中未找到 SN，请查看设备标签后手动添加')
    let sn
    try { sn = decodeURIComponent(match[1]) } catch (_) { throw new Error('设备码格式不正确，请手动输入 SN') }
    return { sn: validateSerial(sn), name: '' }
  }
  return { sn: validateSerial(raw), name: '' }
}

function listDeviceDrafts(token) { return forSession(token).map((item) => ({ ...item })) }

function addDeviceDraft(token, item) {
  if (!token) throw new Error('请先登录后再登记设备')
  forSession(token)
  const source = item.source === 'bluetooth' ? 'bluetooth' : item.source === 'scan' ? 'scan' : 'sn'
  const identity = source === 'bluetooth' ? String(item.deviceId || '').trim() : validateSerial(item.sn)
  if (!identity || identity.length > 128) throw new Error('设备标识无效，请重新搜索')
  const id = (source === 'bluetooth' ? 'ble:' : 'sn:') + identity
  if (drafts.some((entry) => entry.id === id)) throw new Error('该设备已在待适配列表中')
  if (drafts.length >= 20) throw new Error('最多暂存 20 台设备，请先移除不需要的条目')
  drafts.push({ id, source, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 40) : '待适配设备',
    sn: source === 'bluetooth' ? '' : identity,
    deviceId: source === 'bluetooth' ? identity : '', status: 'pending',
    sourceText: source === 'bluetooth' ? '蓝牙发现' : source === 'scan' ? '扫码登记' : 'SN 登记' })
  return listDeviceDrafts(token)
}

function removeDeviceDraft(token, id) {
  forSession(token)
  drafts = drafts.filter((item) => item.id !== id)
  return listDeviceDrafts(token)
}

module.exports = { validateSerial, parseDeviceCode, listDeviceDrafts, addDeviceDraft, removeDeviceDraft }
