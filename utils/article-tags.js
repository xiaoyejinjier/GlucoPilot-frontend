const { getUserInfo } = require('./storage')
const { normalizeTag, tagIssue } = require('./publication')
function key(suffix=''){const info=getUserInfo();return info && /^u[1-9]\d{0,18}$/.test(info.communityKey || '') ? `articleTags${suffix}:${info.communityKey}` : ''}
function read(suffix){try{const k=key(suffix),raw=k && wx.getStorageSync(k);return Array.isArray(raw)?raw.filter(n=>typeof n==='string'&&!tagIssue(n)).slice(0,30):[]}catch(_){return []}}
function write(suffix,names){const k=key(suffix);if(!k)return;try{wx.setStorageSync(k,names.slice(0,30))}catch(_){}}
function list(){return read('')}
function hidden(){return read('Hidden')}
function unpinned(){return read('Unpinned')}
function remember(names){const unique=new Map();[...names,...list()].forEach(raw=>{const n=normalizeTag(raw);if(!tagIssue(n)&&!unique.has(n.toLowerCase()))unique.set(n.toLowerCase(),n)});write('',Array.from(unique.values()))}
function forget(names){const removed=new Set(names.map(n=>normalizeTag(n).toLowerCase()));write('',list().filter(n=>!removed.has(n.toLowerCase())))}
function hide(names){const unique=new Map();[...names,...hidden()].forEach(raw=>{const n=normalizeTag(raw);if(!tagIssue(n)&&!unique.has(n.toLowerCase()))unique.set(n.toLowerCase(),n)});write('Hidden',Array.from(unique.values()));forget(names)}
function unhide(names){const removed=new Set(names.map(n=>normalizeTag(n).toLowerCase()));write('Hidden',hidden().filter(n=>!removed.has(n.toLowerCase())))}
function unpin(names){
  const unique=new Map()
  ;[...names,...unpinned()].forEach(raw=>{const n=normalizeTag(raw);if(!tagIssue(n)&&!unique.has(n.toLowerCase()))unique.set(n.toLowerCase(),n)})
  write('Unpinned',Array.from(unique.values()))
  forget(names)
}
function repin(names){
  const removed=new Set(names.map(n=>normalizeTag(n).toLowerCase()))
  write('Unpinned',unpinned().filter(n=>!removed.has(n.toLowerCase())))
  remember(names)
}
function rename(from,to){
  const next=normalizeTag(to),issue=tagIssue(next)
  if(issue)return issue
  const prior=normalizeTag(from)
  if(!prior||prior.toLowerCase()===next.toLowerCase())return ''
  forget([prior]);unhide([next]);remember([next]);hide([prior]);return ''
}
module.exports={list,remember,forget,hidden,hide,unhide,unpinned,unpin,repin,rename}
