const { getUserInfo } = require('./storage')
const { normalizeTag,tagIssue } = require('./publication')
function key(){const info=getUserInfo();return info && /^u[1-9]\d{0,18}$/.test(info.communityKey || '') ? `articleTags:${info.communityKey}` : ''}
function list(){try{const k=key(),raw=k && wx.getStorageSync(k);return Array.isArray(raw)?raw.filter(n=>typeof n==='string'&&!tagIssue(n)).slice(0,30):[]}catch(_){return []}}
function remember(names){const k=key();if(!k)return;const unique=new Map();[...names,...list()].forEach(raw=>{const n=normalizeTag(raw);if(!tagIssue(n)&&!unique.has(n.toLowerCase()))unique.set(n.toLowerCase(),n)});try{wx.setStorageSync(k,Array.from(unique.values()).slice(0,30))}catch(_){} }
function forget(names){const k=key();if(!k)return;const removed=new Set(names.map(n=>normalizeTag(n).toLowerCase()));try{wx.setStorageSync(k,list().filter(n=>!removed.has(n.toLowerCase())))}catch(_){}}
module.exports={list,remember,forget}
