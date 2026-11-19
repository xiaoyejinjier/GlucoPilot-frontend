function statusLabel(row) {
  if (row.status === 'COMPLETED') return row.provider === 'ALIPAY_SANDBOX_TRANSFER' ? '已到账沙箱钱包' : '已模拟发放'
  if (row.status === 'REJECTED') return row.transferState === 'FAILED' ? '转账失败，已退回' : '已拒绝'
  if (row.status === 'APPROVED') {
    if (!row.payeeUserId) return '待补充收款账号'
    if (row.transferState === 'PROCESSING' || row.transferState === 'WAITING') return '转账处理中'
    if (row.transferState === 'UNKNOWN') return '转账待核实'
    return '待发放'
  }
  return '待审核'
}
function validPayee(value) { return /^2088\d{12,28}$/.test(String(value || '').trim()) }
module.exports = { statusLabel, validPayee }
