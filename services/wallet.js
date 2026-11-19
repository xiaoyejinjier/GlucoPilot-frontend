const { get, post } = require('../utils/request')

// 统一走当前API配置和登录身份；404/网络失败明确报错，不伪装为零余额。
module.exports = {
  withdrawalSummary: () => get('/wallet/withdrawals/summary', null, { auth: true }),
  withdrawals: params => get('/wallet/withdrawals', params, { auth: true }),
  withdraw: body => post('/wallet/withdrawals', body, { auth: true }),
  withdrawalRecipient: (no, body) => post(`/wallet/withdrawals/${encodeURIComponent(no)}/recipient`, body, { auth: true }),
  refreshWithdrawals: () => post('/wallet/withdrawals/refresh', {}, { auth: true, timeout: 60000 }),
  summary: () => get('/wallet', null, { auth: true }),
  activate: () => post('/wallet/activation', {}, { auth: true }),
  orders: (type, params) => get(type === 'RECHARGE' ? '/wallet/recharge-orders' : '/consultation-orders', params, { auth: true }),
  detail: (type, orderNo) => get(`${type === 'RECHARGE' ? '/wallet/recharge-orders' : '/consultation-orders'}/${encodeURIComponent(orderNo)}`, null, { auth: true }),
  recharge: body => post('/wallet/recharge-orders', body, { auth: true }),
  payment: orderNo => post(`/wallet/recharge-orders/${encodeURIComponent(orderNo)}/payments`, {}, { auth: true }),
  refreshPayment: orderNo => post(`/wallet/recharge-orders/${encodeURIComponent(orderNo)}/refresh`, {}, { auth: true })
}
