const { get } = require('../utils/request')
const { mapUserMe } = require('../utils/mappers')

async function inspect(token, expectedId) {
  if (!token) throw Object.assign(new Error('该账号需要重新登录'), { code: 40100 })
  // 使用候选会话进行只读校验，401不会清掉当前账号的登录态。
  const options = { auth: false, header: { Authorization: 'Bearer ' + token }, timeout: 10000 }
  const [raw, doctor] = await Promise.all([
    get('/users/me', null, options),
    get('/consultation-doctors/me', null, options)
  ])
  const profile = mapUserMe(raw)
  if (!/^u[1-9]\d{0,18}$/.test(profile.communityKey) || (expectedId && profile.communityKey !== expectedId))
    throw Object.assign(new Error('账号信息已变化，请重新登录'), { code: 40100 })
  if (Number(profile.accountStatus) !== 1) throw Object.assign(new Error('账号当前不可切换，请重新登录查看状态'), { code: 40300 })
  return { token, profile, doctorStatus: doctor ? doctor.status : null }
}
module.exports = { inspect }
