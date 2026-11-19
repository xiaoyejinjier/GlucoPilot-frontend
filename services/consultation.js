const { get, post, put } = require('../utils/request')

// 兼容尚未部署新接口的后端，不填充模拟病例或模拟支付结果。
const PREVIEW_CAPABILITIES = Object.freeze({
  mode: 'PREVIEW', submissionEnabled: false, doctorServiceEnabled: false,
  paymentEnabled: false, feeCents: 100, currency: 'CNY', paymentProvider: 'ALIPAY_SANDBOX'
})
function missing(error) { return error.statusCode === 404 || error.statusCode === 501 }
async function capabilities() {
  try { return await get('/consultations/capabilities', null, { auth: true }) }
  catch (error) { if (missing(error)) return { ...PREVIEW_CAPABILITIES }; throw error }
}
async function list(params = {}) {
  try { return await get('/consultations', params, { auth: true }) }
  catch (error) {
    if (missing(error)) return { records: [], pageNum: params.pageNum || 1, pages: 0, total: 0 }
    throw error
  }
}
async function orders(params = {}) {
  try { return await get('/consultation-orders', params, { auth: true }) }
  catch (error) {
    if (missing(error)) return { records: [], pageNum: params.pageNum || 1, pages: 0, total: 0 }
    throw error
  }
}
module.exports = {
  PREVIEW_CAPABILITIES, capabilities, list, orders,
  doctor: () => get('/consultation-doctors/me', null, { auth: true }),
  applyDoctor: payload => put('/consultation-doctors/me', payload, { auth: true }),
  images: id => get(`/consultations/${encodeURIComponent(id)}/images`, null, { auth: true }),
  messages: (id, params) => get(`/consultations/${encodeURIComponent(id)}/messages`, params, { auth: true }),
  sendMessage: (id, payload) => post(`/consultations/${encodeURIComponent(id)}/messages`, payload, { auth: true }),
  conversations: params => get('/consultation-conversations', params, { auth: true }),
  readMessages: (id, throughId) => put(`/consultations/${encodeURIComponent(id)}/messages/read`, { throughId }, { auth: true }),
  claim: id => post(`/consultations/${encodeURIComponent(id)}/claim`, {}, { auth: true }),
  issueReport: (id, payload) => post(`/consultations/${encodeURIComponent(id)}/report`, payload, { auth: true }),
  detail: id => get(`/consultations/${encodeURIComponent(id)}`, null, { auth: true }),
  report: id => get(`/consultation-reports/${encodeURIComponent(id)}`, null, { auth: true }),
  publish: payload => post('/consultations', payload, { auth: true }),
  createOrder: payload => post('/consultation-orders', payload, { auth: true }),
  order: orderNo => get(`/consultation-orders/${encodeURIComponent(orderNo)}`, null, { auth: true }),
  startPayment: (orderNo, payload) => post(`/consultation-orders/${encodeURIComponent(orderNo)}/payments`, payload, { auth: true })
}
