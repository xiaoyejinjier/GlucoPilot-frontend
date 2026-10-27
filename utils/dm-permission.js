function normalizePermission(value) {
  if (!value || typeof value.canSend !== 'boolean' || typeof value.following !== 'boolean' || typeof value.mutualFollowing !== 'boolean') return null
  if (!['FIRST_MESSAGE', 'WAITING_REPLY', 'OPEN'].includes(value.state) || value.canSend !== (value.state !== 'WAITING_REPLY')) return null
  return { canSend:value.canSend, following:value.following, mutualFollowing:value.mutualFollowing, state:value.state }
}
module.exports = { normalizePermission }
