const { money } = require('./consultation')
const { timeLabel } = require('./community')

const STATUSES = [
  { code: '', label: '全部' }, { code: 'PENDING', label: '待支付' },
  { code: 'PAID', label: '已支付' }, { code: 'CLOSED', label: '已关闭' },
  { code: 'REFUNDING', label: '退款中' }, { code: 'REFUNDED', label: '已退款' }
]
// 使用字符串拆分换算整数分，避免1.01 * 100的浮点误差。
function amountCents(value) {
  const text = String(value == null ? '' : value).trim()
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(text)) return null
  const [yuan, fraction = ''] = text.split('.')
  const cents = Number(yuan) * 100 + Number((fraction + '00').slice(0, 2))
  return cents >= 100 && cents <= 100000 ? cents : null
}
function decorate(row) {
  const rawBalance = row.balanceAfterCents
  const balance = typeof rawBalance === 'number' || (typeof rawBalance === 'string' && /^\d+$/.test(rawBalance)) ? Number(rawBalance) : NaN
  const balanceAfter = Number.isSafeInteger(balance) && balance >= 0 ? money(balance) : null
  return { ...row, price: money(row.amountCents), statusLabel: (STATUSES.find(item => item.code === row.status) || {}).label || '处理中',
    showBalanceAfter: row.status === 'PAID', balanceAfter,
    balanceAfterLabel: row.type === 'RECHARGE' ? '充值后余额' : '支付后余额',
    time: timeLabel(row.createdAt), paidTime: timeLabel(row.paidAt), closedTime: timeLabel(row.closedAt), creditedTime: timeLabel(row.creditedAt) }
}
module.exports = { amountCents, decorate, STATUSES }
