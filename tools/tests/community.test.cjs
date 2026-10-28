const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const message = (id, mine = false) => ({ id: String(id), content: `消息${id}`, senderId: mine ? '1' : '2', recipientId: mine ? '2' : '1', mine, createdAt: '2026-10-19T12:30:00', readAt: null })

function harness(name, options = {}) {
  const state = { token: 'account-one', calls: [], toasts: [], feedback:[], ticks:[], navs: [], scrolls: [], intervals: new Map(), timeouts:new Map(), modals: [], clipboard: [], reset: 0, speech:[] }
  const app = { checkLogin: () => !!state.token, resetLoginState() { state.token = ''; state.reset++ } }
  const request = { getToken: () => state.token }
  const wx = { showToast: v => state.toasts.push(v), navigateTo: v => state.navs.push(v), reLaunch: v => state.navs.push(v),
    setNavigationBarTitle() {}, nextTick(fn) { if(options.manualNextTick)state.ticks.push(fn);else fn() }, pageScrollTo(v) { state.scrolls.push(v);if(v.success)v.success();if(v.complete)v.complete() }, showModal: v => state.modals.push(v), setClipboardData: v => state.clipboard.push(v.data) }
  const socialModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/community.js'), 'utf8'), { module: socialModule, require: () => request, wx, getApp: () => app })
  const implementations = {
    fetchMe:async()=>({communityKey:'u1',nickname:'我',avatarUrl:'my-avatar'}),fetchProfileArticles:async()=>({records:[],pages:0}),
    fetchCommunityProfile: async key => ({ key, userId: key.startsWith('u') ? key.slice(1) : null, nickname: '测试用户', followed: false, isSelf: false }),
    setCommunityFollowing: async (key, desired) => ({ key, userId: '2', nickname: '测试用户', followed: desired, isSelf: false }),
    fetchCommunityList: async () => ({ records: [], pages: 0 }),
    fetchDirectMessages: async () => ({ records: [], hasMore: false, nextBeforeId: null }),
    readDirectMessages: async () => ({}), sendDirectMessage: async () => message(5, true),
    fetchInteractionNotices:async()=>({records:[],pages:0}),readInteractionNotices:async()=>({}),
    fetchMyComments:async()=>({records:[],pages:0}),
    fetchNewsDetail: async () => ({ id: '10', title: '真实文章', liked: false, collected: false, likeCount: 0, collectCount: 0, commentCount: 0 }),
    fetchNewsComments: async () => ({ records: [], pages: 0 }), addNewsComment: async () => ({}), deleteNewsComment: async () => ({}),
    fetchCommentReplies: async () => ({ records: [], hasMore:false, nextAfterId:null }),
    fetchCommentContext: async () => { throw Object.assign(new Error('missing'),{code:40400}) },
    updateNewsAction: async (id, payload) => ({ liked: !!payload.liked, collected: !!payload.collected, likeCount: payload.liked ? 1 : 0, collectCount: payload.collected ? 1 : 0 }),
    ...options.api
  }
  const api = Object.fromEntries(Object.keys(implementations).map(key => [key, (...args) => { state.calls.push({ name: key, args }); const result=implementations[key](...args);return key==='fetchDirectMessages'?Promise.resolve(result).then(page=>({...page,sendPermission:Object.prototype.hasOwnProperty.call(page,'sendPermission')?page.sendPermission:{canSend:true,following:false,mutualFollowing:false,state:'OPEN'}})):result }]))
  let definition, timerId = 0
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page: v => { definition = v }, wx, getApp: () => app,
    setInterval: (fn, ms) => { state.intervals.set(++timerId, { fn, ms }); return timerId }, clearInterval: id => state.intervals.delete(id),
    setTimeout:(fn,ms)=>{if(!options.manualTimeouts){fn();return 0}const id=++timerId;state.timeouts.set(id,{fn:()=>{state.timeouts.delete(id);fn()},ms});return id},
    clearTimeout:id=>state.timeouts.delete(id),
    require: key => ({ '../../services/api': api, '../../utils/community': socialModule.exports, '../../utils/dm-permission':require('../../utils/dm-permission'),
      '../../utils/request': request, '../../utils/message-notifications':{refresh:()=>state.calls.push({name:'refreshUnread'}),count:v=>Math.max(0,Number(v)||0),label:v=>Number(v)>99?'99+':Number(v)>0?String(v):''}, '../../utils/remote-image':{mapField:async rows=>rows,loadRemoteImage:async url=>options.cover ? options.cover(url) : url}, '../../utils/display': { applyDisplayToCurrentPage() {} } }[key])
  })
  const page = { ...definition, selectComponent:selector=>selector==='#social-feedback'?{show:text=>state.feedback.push(text)}:({beginHold:()=>state.speech.push('start'),endHold:cancel=>state.speech.push(cancel?'cancel':'stop')}), data: JSON.parse(JSON.stringify(definition.data)), setData(patch,callback) {
    for (const [key, value] of Object.entries(patch)) {
      const keys = key.split('.'); let object = this.data
      for (const part of keys.slice(0, -1)) object = object[part]
      object[keys[keys.length - 1]] = value
    }
    if(callback)callback()
  } }
  page.onLoad(options.route || (name === 'messages' ? { peer: '2' } : name === 'news-detail' ? { id: '10' } : name === 'community-profile' ? { key: 'u2' } : { mode: 'following' }))
  page.onShow()
  return { page, state, api: implementations, social: socialModule.exports }
}

const dmPermission=(kind,following=false)=>({canSend:kind!=='WAITING_REPLY',following,mutualFollowing:false,state:kind})
test('等待状态保留输入和语音表情草稿，点击发送提示而不发请求，回复到来恢复发送',async()=>{
  let sent=false,replied=false
  const {page:p,state}=harness('messages',{api:{fetchDirectMessages:async()=>({records:sent?[message(5,true)]:[],hasMore:false,sendPermission:dmPermission(replied?'OPEN':sent?'WAITING_REPLY':'FIRST_MESSAGE')}),sendDirectMessage:async()=>{sent=true;return message(5,true)}}});await flush()
  assert.equal(p.canCompose(),true);p.onInput({detail:{value:'你好'}});await p.onSend();await flush();assert.equal(p.data.sendPermission.state,'WAITING_REPLY')
  p.onInput({detail:{value:'还想再发'}});p.onInputFocus({detail:{}});await p.onSend()
  assert.equal(p.data.input,'还想再发');assert.equal(state.toasts.at(-1).title,'等待对方回复或相互关注后可继续发信息')
  await p.loadLatest(true);assert.equal(p.data.inputFocus,true);assert.equal(p.data.input,'还想再发')
  p.onToggleEmoji();assert.equal(p.data.emojiVisible,true);p.onEmoji({currentTarget:{dataset:{emoji:'😊'}}});assert.ok(p.data.input.includes('😊'))
  p.onToggleVoiceMode();p.onHoldStart();await p.loadLatest(true);assert.equal(p.data.speechVisible,true);p.onHoldEnd();p.onConfirmSpeechInput({detail:{text:'这段识别文字也要保留'}});await flush()
  assert.equal(state.calls.filter(c=>c.name==='sendDirectMessage').length,1);assert.equal(p.data.input,'这段识别文字也要保留');assert.equal(state.speech.length,2)
  replied=true;await p.loadLatest(true);assert.equal(p.canCompose(),true);await p.onSend();assert.equal(state.calls.filter(c=>c.name==='sendDirectMessage').length,2);p.onUnload()
})
test('单向关注不会解锁第二条，双方互关的服务端权限到来后才恢复',async()=>{
  let followed=false,mutual=false
  const {page:p}=harness('messages',{api:{fetchDirectMessages:async()=>({records:[],hasMore:false,sendPermission:{...dmPermission(mutual?'OPEN':'WAITING_REPLY',followed),mutualFollowing:mutual}}),setCommunityFollowing:async()=>{followed=true;return{key:'u2',userId:'2',followed:true}}}});await flush()
  await p.onFollowPeer();await flush();assert.equal(p.data.sendPermission.following,true);assert.equal(p.canCompose(),false)
  mutual=true;await p.loadLatest(true);assert.equal(p.canCompose(),true);p.onUnload()
})
test('旧轮询权限晚于首条发送返回时不能重新放开输入，随后补取新权限',async()=>{
  const old=deferred();let calls=0
  const {page:p}=harness('messages',{api:{fetchDirectMessages:async()=>++calls===2?old.promise:{records:[],hasMore:false,sendPermission:dmPermission(calls===1?'FIRST_MESSAGE':'WAITING_REPLY')}}});await flush()
  const polling=p.loadLatest(true);p.onInput({detail:{value:'招呼'}});await p.onSend();assert.equal(p.canCompose(),false)
  old.resolve({records:[],hasMore:false,sendPermission:dmPermission('FIRST_MESSAGE')});await polling;await flush()
  assert.equal(p.canCompose(),false);assert.equal(calls,3);p.onUnload()
})
test('权限缺失先禁发可重试，服务器40301保留草稿并显示等待',async()=>{
  const {page:p,state,api}=harness('messages',{api:{fetchDirectMessages:async()=>({records:[],hasMore:false,sendPermission:null})}});await flush()
  assert.equal(p.canCompose(),false);p.onInput({detail:{value:'保留草稿'}});await p.onSend();assert.equal(state.calls.filter(c=>c.name==='sendDirectMessage').length,0)
  api.fetchDirectMessages=async()=>({records:[],hasMore:false,sendPermission:dmPermission('FIRST_MESSAGE')});await p.onPermissionRetry();assert.equal(p.canCompose(),true)
  api.sendDirectMessage=async()=>{throw Object.assign(Error('等待对方回复或相互关注后可继续发信息'),{code:40301})}
  api.fetchDirectMessages=async()=>({records:[],hasMore:false,sendPermission:dmPermission('WAITING_REPLY')});await p.onSend();await flush()
  assert.equal(p.data.input,'保留草稿');assert.equal(p.canCompose(),false);assert.equal(p.data.sending,false);p.onUnload()
})
test('聊天中的关注操作晚于切换账号返回时不改变新账号权限',async()=>{
  const follow=deferred()
  const {page:p,state,api}=harness('messages',{api:{fetchDirectMessages:async()=>({records:[],hasMore:false,sendPermission:dmPermission('WAITING_REPLY')}),setCommunityFollowing:()=>follow.promise}});await flush()
  const pending=p.onFollowPeer();p.onHide();state.token='new-account';api.fetchDirectMessages=async()=>({records:[],hasMore:false,sendPermission:dmPermission('FIRST_MESSAGE')});p.onShow();await flush()
  follow.resolve({key:'u2',userId:'2',followed:true});await pending
  assert.equal(p.data.sendPermission.state,'FIRST_MESSAGE');assert.equal(p.data.sendPermission.following,false);assert.equal(p.data.followingPeer,false);assert.equal(state.toasts.filter(t=>t.title==='关注成功').length,0);p.onUnload()
})
test('私信灰色已关注按钮可以取消并重新关注，失败和连点不产生错误状态',async()=>{
  let followed=true,reject=false
  const late=deferred()
  const {page:p,state,api}=harness('messages',{api:{fetchDirectMessages:async()=>({records:[],hasMore:false,sendPermission:dmPermission('WAITING_REPLY',followed)}),setCommunityFollowing:async(_key,desired)=>{if(reject)throw Error('网络异常');followed=desired;return{key:'u2',userId:'2',followed}}}});await flush()
  await p.onFollowPeer();await flush();assert.equal(followed,false);assert.equal(p.data.sendPermission.following,false);assert.equal(p.data.peer.followed,false);assert.equal(state.toasts.at(-1).title,'取消关注成功')
  await p.onFollowPeer();await flush();assert.equal(followed,true);assert.equal(p.data.peer.followed,true);assert.equal(p.canCompose(),false)
  reject=true;await p.onFollowPeer();await flush();assert.equal(p.data.sendPermission.following,true);assert.equal(p.data.peer.followed,true)
  api.setCommunityFollowing=()=>late.promise;const saving=p.onFollowPeer();p.onFollowPeer();assert.equal(state.calls.filter(c=>c.name==='setCommunityFollowing').length,4)
  followed=false;late.resolve({key:'u2',userId:'2',followed:false});await saving;await flush();assert.equal(p.data.sendPermission.following,false);p.onUnload()
})
test('主页与私信通过同一关注关系同步，返回读取主页修改，聊天取消后主页也更新',async()=>{
  let followed=false
  const api={fetchCommunityProfile:async()=>({key:'u2',userId:'2',nickname:'糖友',followed,isSelf:false}),fetchDirectMessages:async()=>({records:[],hasMore:false,sendPermission:dmPermission('WAITING_REPLY',followed)}),setCommunityFollowing:async(_key,desired)=>{followed=desired;return{key:'u2',userId:'2',nickname:'糖友',followed,isSelf:false}}}
  const chat=harness('messages',{api}),profile=harness('community-profile',{api});await flush();assert.equal(chat.page.data.sendPermission.following,false)
  chat.page.onHide();await profile.page.onFollow();chat.page.onShow();await flush();assert.equal(chat.page.data.sendPermission.following,true);assert.equal(chat.page.data.peer.followed,true)
  profile.page.onHide();await chat.page.onFollowPeer();await flush();profile.page.onShow();await flush();assert.equal(profile.page.data.profile.followed,false)
  followed=true;const timer=[...chat.state.intervals.values()][0];timer.fn();await flush();assert.equal(chat.page.data.sendPermission.following,true);assert.equal(chat.page.data.peer.followed,true)
  chat.page.onUnload();profile.page.onUnload()
})
test('旧轮询和资料请求不能覆盖聊天中刚完成的取消关注',async()=>{
  const poll=deferred(),profile=deferred();let followed=true,calls=0
  const {page:p}=harness('messages',{api:{fetchCommunityProfile:()=>profile.promise,fetchDirectMessages:async()=>++calls===2?poll.promise:{records:[],hasMore:false,sendPermission:dmPermission('WAITING_REPLY',followed)},setCommunityFollowing:async()=>{followed=false;return{key:'u2',userId:'2',nickname:'糖友',followed:false}}}});await flush()
  const loading=p.loadLatest(true);await p.onFollowPeer();assert.equal(p.data.sendPermission.following,false)
  profile.resolve({key:'u2',userId:'2',nickname:'糖友',followed:true});poll.resolve({records:[],hasMore:false,sendPermission:dmPermission('WAITING_REPLY',true)});await loading;await flush()
  assert.equal(p.data.sendPermission.following,false);assert.equal(p.data.peer.followed,false);p.onUnload()
})

test('私信表情插入光标位置，语音先按住再确认，超过上限或换账号不发送',async()=>{
  const {page:p,state}=harness('messages');await flush()
  p.onInput({detail:{value:'你好朋友',cursor:2}});p.onToggleEmoji();p.onEmoji({currentTarget:{dataset:{emoji:'😊'}}})
  assert.equal(p.data.input,'你好😊朋友');assert.equal(state.calls.filter(c=>c.name==='sendDirectMessage').length,0)
  p.onToggleVoiceMode();assert.equal(p.data.voiceMode,true);assert.equal(state.speech.length,0)
  p.onHoldStart();assert.equal(state.speech[0],'start');p.onHoldEnd();assert.equal(state.speech[1],'stop')
  assert.equal(state.calls.filter(c=>c.name==='sendDirectMessage').length,0)
  p.onConfirmSpeechInput({detail:{text:'语音识别并确认的文字'}});await flush()
  assert.equal(state.calls.find(c=>c.name==='sendDirectMessage').args[1].content,'语音识别并确认的文字')
  p.setData({input:'a'.repeat(999)});p._cursor=999;p.onEmoji({currentTarget:{dataset:{emoji:'😊'}}});assert.equal(p.data.input.length,999)
  p.onHoldStart();state.token='new-account';p.onConfirmSpeechInput({detail:{text:'上一个账号的识别'}})
  assert.equal(state.calls.filter(c=>c.name==='sendDirectMessage').length,1);p.onUnload()
})

test('信息中心包含私信点赞收藏评论新关注，按当前类别标记已读并跳到真实目标',async()=>{
  const {page:p,state}=harness('information',{route:{tab:'likes'},api:{fetchInteractionNotices:async kind=>({records:[{id:'90',kind,actor:{key:'u2',nickname:'糖友'},newsId:'10',newsTitle:'我的文章',createdAt:'2026-10-20T12:00:00',read:false}],pages:1})}})
  await flush();assert.equal(p.data.tabs.map(t=>t.label).join(','),'私信,点赞,收藏,收到的评论,新关注我的,我的评论');assert.equal(p.data.list[0].action,'赞了你的文章')
  assert.deepEqual(state.calls.find(c=>c.name==='readInteractionNotices').args,['LIKE','90'])
  p.onOpen({currentTarget:{dataset:{id:'90'}}});assert.match(state.navs[0].url,/news-detail.*id=10/)
  p.onTab({currentTarget:{dataset:{key:'follows'}}});await flush();p.onOpen({currentTarget:{dataset:{id:'90'}}});assert.match(state.navs[1].url,/community-profile.*key=u2/)
  assert.equal(state.intervals.size,1);p.onHide();assert.equal(state.intervals.size,0)
})

test('我的评论只取自己的、标出被隐藏的，并跳到文章定位该评论',async()=>{
  const rows=[
    {id:'501',newsId:'10',articleTitle:'控糖早餐怎么吃',articleAvailable:true,content:'我的公开评论',createdAt:'2026-10-20T12:00:00',hidden:false,replyCount:2,likeCount:1},
    {id:'502',newsId:'11',articleTitle:'被删掉的文章',articleAvailable:false,content:'被机器隐藏的评论',createdAt:'2026-10-21T08:00:00',hidden:true,replyCount:0,likeCount:0}
  ]
  const {page:p,state}=harness('information',{route:{tab:'myComments'},api:{fetchMyComments:async()=>({records:rows,pages:1})}})
  await flush()
  assert.equal(p.data.activeTab,'myComments')
  // 跨 vm 上下文的对象原型不同，deepEqual 会因原型不等而失败，这里按字段比较
  const call = state.calls.find(c=>c.name==='fetchMyComments').args[0]
  assert.equal(call.pageNum,1);assert.equal(call.pageSize,20)
  assert.equal(p.data.list[0].rowKey,'501')
  assert.equal(p.data.list[1].hidden,true,'被 AI 隐藏的评论作者自己也要看得到')
  p.onOpen({currentTarget:{dataset:{id:'501'}}});assert.match(state.navs[0].url,/news-detail\?id=10&comments=1&commentId=501$/)
  p.onOpen({currentTarget:{dataset:{id:'502'}}});assert.equal(state.navs.length,1,'文章已不可查看时只提示不跳转')
  p.onUnload()
})

test('切换信息分类时丢弃旧请求，离页后的提醒不能回填',async()=>{
  const slow=deferred();const {page:p}=harness('information',{route:{tab:'likes'},api:{fetchInteractionNotices:kind=>kind==='LIKE'?slow.promise:Promise.resolve({records:[],pages:0})}})
  p.onTab({currentTarget:{dataset:{key:'collections'}}});await flush();slow.resolve({records:[{id:'1',actor:{key:'u2'}}],pages:1});await flush();assert.equal(p.data.activeTab,'collections');assert.equal(p.data.list.length,0);p.onUnload()
})

test('字符串0未读计数规范为数字0，正数显示角标并封顶99+',async()=>{
  const {page:p}=harness('community',{route:{mode:'messages'},api:{fetchCommunityList:async()=>({records:[{peer:{key:'u2'},lastMessage:{},unreadCount:'0'},{peer:{key:'u3'},lastMessage:{},unreadCount:'102'}],pages:1})}})
  await flush();assert.equal(p.data.list[0].unreadCount,0);assert.equal(p.data.list[1].unreadLabel,'99+');p.onUnload()
})

test('私信从服务器加载，按ID正序，标记已看到的范围，离页停止5秒轮询', async () => {
  const { page, state } = harness('messages', { api: { fetchDirectMessages: async () => ({ records: [message(1), message(2)], hasMore: false, nextBeforeId: '1' }) } })
  await flush()
  assert.equal(page.data.messages.map(row => row.id).join(','), '1,2')
  assert.equal(page.data.ready, true)
  assert.equal(state.calls.find(c => c.name === 'readDirectMessages').args[1], '2')
  assert.equal([...state.intervals.values()][0].ms, 5000)
  state.intervals.values().next().value.fn(); await flush()
  assert.equal(page.data.messages.length, 2)
  page.onHide(); assert.equal(state.intervals.size, 0)
  page.onShow(); await flush(); assert.equal(state.intervals.size, 1)
  page.onUnload(); assert.equal(state.intervals.size, 0)
})
test('私信发送失败保留草稿和幂等ID，重试成功只显示服务器确认的消息', async () => {
  let attempt = 0
  const { page, state } = harness('messages', { api: { sendDirectMessage: async () => { if (++attempt === 1) throw new Error('网络超时'); return message(9, true) } } })
  await flush(); page.onInput({ detail: { value: '  你好呀  ' } }); await page.onSend()
  assert.equal(page.data.input, '  你好呀  '); assert.equal(page.data.messages.length, 0)
  await page.onSend(); await flush()
  const sends = state.calls.filter(c => c.name === 'sendDirectMessage')
  assert.equal(sends[0].args[1].content, '你好呀')
  assert.equal(sends[0].args[1].clientRequestId, sends[1].args[1].clientRequestId)
  assert.equal(page.data.input, ''); assert.equal(page.data.messages[0].id, '9')
  page.onUnload()
})
test('私信发送连点不重复请求，加载完成前不发送', async () => {
  const load = deferred(), save = deferred()
  const { page, state } = harness('messages', { api: { fetchDirectMessages: () => load.promise, sendDirectMessage: () => save.promise } })
  page.onInput({ detail: { value: '测试' } }); await page.onSend()
  assert.equal(state.calls.filter(c => c.name === 'sendDirectMessage').length, 0)
  load.resolve({ records: [], hasMore: false }); await flush()
  const sending = page.onSend(); page.onSend()
  assert.equal(state.calls.filter(c => c.name === 'sendDirectMessage').length, 1)
  save.resolve(message(8, true)); await sending; page.onUnload()
})
test('离页后的消息响应不回填，切换账号清理旧消息和草稿', async () => {
  const late = deferred()
  const { page, state, api } = harness('messages', { api: { fetchDirectMessages: () => late.promise } })
  page.onInput({ detail: { value: '账号一草稿' } }); page.onHide()
  late.resolve({ records: [message(1)], hasMore: false }); await flush()
  assert.equal(page.data.messages.length, 0)
  state.token = 'account-two'; api.fetchDirectMessages = async () => ({ records: [message(7)], hasMore: false })
  page.onShow(); await flush()
  assert.equal(page.data.input, ''); assert.equal(page.data.messages[0].id, '7')
  page.onUnload()
})
test('发送结果晚于账号变化时不显示旧消息，也不清空新草稿', async () => {
  const late = deferred(); const { page, state } = harness('messages', { api: { sendDirectMessage: () => late.promise } })
  await flush(); page.onInput({ detail: { value: '账号一消息' } }); const sending = page.onSend()
  page.onHide(); state.token = 'account-two'; page.onShow(); await flush(); page.onInput({ detail: { value: '账号二草稿' } })
  late.resolve(message(9, true)); await sending
  assert.equal(page.data.input, '账号二草稿'); assert.equal(page.data.messages.length, 0); page.onUnload()
})
test('私信游标读取旧页并去重，保留当前消息和定位', async () => {
  const { page, state } = harness('messages', { api: { fetchDirectMessages: async (peer, params) => params.beforeId
    ? { records: [message(1), message(2)], hasMore: false, nextBeforeId: '1' }
    : { records: [message(3), message(4)], hasMore: true, nextBeforeId: '3' } } })
  await flush(); await page.onOlder()
  assert.equal(page.data.messages.map(row => row.id).join(','), '1,2,3,4'); assert.equal(page.data.scrollTarget, 'dm-3')
  assert.equal(state.calls.filter(c => c.name === 'fetchDirectMessages')[1].args[1].beforeId, '3'); page.onUnload()
})
test('文章互动禁止连点并使用服务端状态，失败不会假装点赞成功', async () => {
  const pending = deferred(); const { page, state, api } = harness('news-detail', { api: { updateNewsAction: () => pending.promise } })
  await flush(); const action = page.onLike(); page.onLike(); page.onCollect()
  assert.equal(state.calls.filter(c => c.name === 'updateNewsAction').length, 1)
  pending.resolve({ liked: true, collected: false, likeCount: 3, collectCount: 0 }); await action
  assert.equal(page.data.liked, true); assert.equal(page.data.news.likeCount, 3)
  api.updateNewsAction = async () => { throw new Error('保存失败') }
  await page.onCollect(); assert.equal(page.data.collected, false)
})
test('评论相对时间正确处理中国时区、分钟小时天数及未来时间', async () => {
  const {page,social}=harness('news-detail');const now=Date.parse('2026-10-20T12:00:00+08:00')
  assert.equal(social.relativeTime('2026-10-20T11:59:45',now),'刚刚')
  assert.equal(social.relativeTime('2026-10-20T11:53:00',now),'7分钟前')
  assert.equal(social.relativeTime('2026-10-20T08:00:00',now),'4小时前')
  assert.equal(social.relativeTime('2026-10-17T12:00:00',now),'3天前')
  assert.equal(social.relativeTime('2026-10-20T03:53:00Z',now),'7分钟前')
  assert.equal(social.relativeTime('2026-10-20T13:00:00',now),'刚刚')
  assert.equal(social.relativeTime('bad',now),'');page.onUnload()
})

test('点评论选择真实回复目标，失败重试不重复，成功显示在原评论下', async () => {
  const author={key:'u2',nickname:'🌱糖友乙',avatarUrl:'https://example.invalid/avatar.png'}
  const reply={id:'8',rootCommentId:'7',replyToCommentId:'7',author,content:'原来的回复',createdAt:new Date().toISOString(),replies:[]}
  const root={id:'7',rootCommentId:'7',author,content:'原评论',createdAt:new Date().toISOString(),replyCount:1,replies:[reply]}
  let tries=0
  const {page,state}=harness('news-detail',{api:{fetchNewsComments:async()=>({records:[root],pages:1}),addNewsComment:async(_id,payload)=>{if(!tries++)throw new Error('timeout');return {...reply,id:'9',replyToCommentId:payload.replyToCommentId,content:payload.content}}}})
  await flush();assert.equal(page.data.comments[0].avatarText,'🌱');page.onReply({currentTarget:{dataset:{id:'8'}}});assert.equal(page.data.replyTarget.id,'8');assert.equal(page.data.commentFocus,true);assert.equal(state.scrolls[0].selector,'#comment-composer')
  page.onCommentInput({detail:{value:'继续讨论'}});await page.onCommentSend();assert.equal(page.data.commentDraft,'继续讨论')
  await page.onCommentSend();const calls=state.calls.filter(c=>c.name==='addNewsComment');assert.equal(calls[0].args[1].replyToCommentId,'8');assert.equal(calls[0].args[1].clientRequestId,calls[1].args[1].clientRequestId)
  assert.equal(page.data.comments[0].replies.map(r=>r.id).join(','),'8,9');assert.equal(page.data.replyTarget,null);assert.equal(page.data.comments[0].replyCount,2)
  page.onCommentAvatarError({currentTarget:{dataset:{id:'9'}}});assert.equal(page.data.comments[0].replies[1].avatarFailed,true)
  page.onUnload();assert.equal(state.intervals.size,0)
})

test('展开回复按游标合并并防连点，切换账号清除回复草稿和目标', async () => {
  const more=deferred(),author={key:'u2',nickname:'糖友乙'}
  const make=id=>({id:String(id),rootCommentId:'7',replyToCommentId:'7',author,content:'回复'+id,createdAt:new Date().toISOString()})
  const root={id:'7',rootCommentId:'7',author,content:'原评论',replyCount:4,replies:[make(10),make(15)],replyHasMore:true,replyNextAfterId:'10'}
  const {page,state}=harness('news-detail',{api:{fetchNewsComments:async()=>({records:[root],pages:1}),fetchCommentReplies:()=>more.promise}})
  await flush();const event={currentTarget:{dataset:{id:'7'}}};const pending=page.onMoreReplies(event);page.onMoreReplies(event)
  assert.equal(state.calls.filter(c=>c.name==='fetchCommentReplies').length,1);assert.equal(state.calls.find(c=>c.name==='fetchCommentReplies').args[2].afterId,'10')
  more.resolve({records:[make(11),make(12),make(15)],hasMore:false,nextAfterId:'15'});await pending
  assert.equal(page.data.comments[0].replies.map(r=>r.id).join(','),'10,11,12,15')
  page.onReply({currentTarget:{dataset:{id:'10'}}});page.onCommentInput({detail:{value:'私密草稿'}});page.onHide();assert.equal(state.intervals.size,0)
  state.token='second';page.onShow();assert.equal(page.data.commentDraft,'');assert.equal(page.data.replyTarget,null);assert.equal(page.data.comments.length,0);page.onUnload()
})

test('评论失败保留正文，重试复用幂等ID；只能删除自己的评论', async () => {
  let n = 0; const { page, state } = harness('news-detail', { api: { addNewsComment: async () => { if (++n === 1) throw new Error('timeout'); return {} } } })
  await flush(); page.onCommentInput({ detail: { value: ' 评论内容 ' } }); await page.onCommentSend()
  assert.equal(page.data.commentDraft, ' 评论内容 ')
  await page.onCommentSend(); await flush()
  const writes = state.calls.filter(c => c.name === 'addNewsComment')
  assert.equal(writes[0].args[1].clientRequestId, writes[1].args[1].clientRequestId)
  assert.equal(page.data.commentDraft, '')
  page.setData({ comments: [{ id: '1', mine: false }, { id: '2', mine: true }] })
  page.onDeleteComment({ currentTarget: { dataset: { id: '1' } } }); assert.equal(state.modals.length, 0)
  page.onDeleteComment({ currentTarget: { dataset: { id: '2' } } }); assert.equal(state.modals.length, 1)
})
test('关注列表分页只读本人数据，搜索使用提交时的昵称且不被后续输入改写游标', async () => {
  const { page, state } = harness('community', { route: { mode: 'profiles' }, api: { fetchCommunityList: async (mode, query) => ({ records: [{ key: `u${query.pageNum}`, nickname: '用户' }], pages: 2 }) } })
  assert.equal(state.calls.length, 0)
  page.onInput({ detail: { value: '用户' } }); await page.onSearch()
  page.onInput({ detail: { value: '新输入' } }); await page.onMore()
  assert.equal(page.data.list.length, 2)
  assert.equal(state.calls[1].args[1].keyword, '用户')
  page.onOpen({ currentTarget: { dataset: { key: 'u2' } } })
  assert.match(state.navs[0].url, /community-profile.*key=u2/)
})
test('我的点赞读取真实列表，搜索分页后打开对应文章，重新进入更新取消的点赞',async()=>{
  let liked=true
  const {page,state}=harness('community',{route:{mode:'likes'},api:{fetchCommunityList:async(mode,q)=>({records:liked?[{id:String(q.pageNum),title:'控糖文章'}]:[],pages:liked?2:0})}});await flush()
  assert.equal(page.data.mode,'likes');assert.equal(state.calls[0].args[0],'likes')
  page.onInput({detail:{value:' 控糖 '}});await page.onSearch()
  page.onInput({detail:{value:'未提交'}});await page.onMore()
  assert.equal(state.calls.at(-1).args[1].keyword,'控糖');assert.equal(page.data.list.length,2)
  page.onOpen({currentTarget:{dataset:{key:'2'}}});assert.match(state.navs[0].url,/news-detail.*id=2/)
  liked=false;page.onHide();page.onShow();await flush();assert.equal(page.data.list.length,0)
  await page.onClearSearch();assert.equal(state.calls.at(-1).args[1].keyword,undefined);page.onUnload()
})

test('点赞列表迟到结果不会填入新账号',async()=>{
  const old=deferred();let count=0
  const {page,state}=harness('community',{route:{mode:'likes'},api:{fetchCommunityList:async()=>++count===1?old.promise:{records:[{id:'2',title:'新账号文章'}],pages:1}}})
  page.onHide();state.token='account-two';page.onShow();await flush()
  old.resolve({records:[{id:'1',title:'旧账号文章'}],pages:1});await flush()
  assert.equal(page.data.list.map(row=>row.id).join(','),'2');page.onUnload()
})

test('我的关注支持单字服务端搜索，翻页沿用已提交条件，清空恢复全部',async()=>{
  const {page,state}=harness('community',{route:{mode:'following'},api:{fetchCommunityList:async(_mode,q)=>({records:[{key:'u'+q.pageNum,nickname:'小林'}],pages:2})}});await flush()
  page.onInput({detail:{value:' 林 '}});await page.onSearch()
  assert.equal(state.calls.at(-1).args[1].keyword,'林');assert.equal(page.data.searchQuery,'林')
  page.onInput({detail:{value:'未提交'}});await page.onMore();assert.equal(state.calls.at(-1).args[1].keyword,'林');assert.equal(page.data.list.length,2)
  await page.onClearSearch();assert.equal(page.data.keyword,'');assert.equal(page.data.searchQuery,'');assert.equal(state.calls.at(-1).args[1].keyword,undefined)
})
test('我的收藏新搜索覆盖进行中的旧请求，迟到结果不能回填；清空找用户不发空条件请求',async()=>{
  const old=deferred();const env=harness('community',{route:{mode:'collections'},api:{fetchCommunityList:async(_mode,q)=>q.keyword==='旧'?old.promise:{records:[{id:q.keyword||'all',title:'文章'}],pages:1}}});await flush()
  env.page.onInput({detail:{value:'旧'}});const pending=env.page.onSearch()
  env.page.onInput({detail:{value:'新'}});await env.page.onSearch();assert.equal(env.page.data.list[0].id,'新')
  old.resolve({records:[{id:'old',title:'旧文章'}],pages:1});await pending;assert.equal(env.page.data.list[0].id,'新');assert.equal(env.page.data.loading,false)
  const profiles=harness('community',{route:{mode:'profiles'}});profiles.page.onInput({detail:{value:'用户'}});await profiles.page.onSearch()
  const calls=profiles.state.calls.length;await profiles.page.onClearSearch();assert.equal(profiles.state.calls.length,calls);assert.equal(profiles.page.data.list.length,0)
})
test('公开资料可以关注取消及给用户发私信，未关联用户的发布者不显示假私信', async () => {
  const { page, state } = harness('community-profile'); await flush()
  await page.onFollow(); assert.equal(page.data.profile.followed, true)
  await page.onFollow(); assert.equal(page.data.profile.followed, false)
  page.onMessage(); assert.match(state.navs[0].url, /messages.*peer=2/)
  page.setData({ profile: { key: 'b1', userId: null, followed: true } }); page.onMessage(); assert.equal(state.navs.length, 1)
  page.onMyArticles();page.onEditProfile();assert.equal(state.navs.length,1)
  page.setData({profile:{key:'u1',userId:'1',isSelf:true}});page.onMyArticles();page.onEditProfile()
  assert.match(state.navs[1].url,/community-articles/);assert.match(state.navs[2].url,/profile-edit/)
})
test('消息ID超过JS安全整数时仍按字符串正确排序和去重', () => {
  const { social, page } = harness('messages')
  const rows = social.mergeMessages([{ id: '9007199254740993', content: '旧' }], [{ id: '9007199254740992' }, { id: '9007199254740993', content: '更新' }])
  assert.equal(rows.map(row => row.id).join(','), '9007199254740992,9007199254740993')
  assert.equal(rows[1].content, '更新'); page.onUnload()
})
test('社区失效身份返回登录，旧账号401不会清空新账号的登录态', async () => {
  const { page, state, social } = harness('community-profile'); await flush()
  state.token = ''; social.failure(page, Object.assign(new Error('过期'), { code: 40100, requestToken: 'account-one' }))
  assert.equal(state.reset, 1); assert.match(state.navs[0].url, /login/)
  let token = 'old-token', sent
  const module = { exports: {} }
  const wx = { getStorageSync: () => token, removeStorageSync: () => { token = '' }, setStorageSync() {}, request: opts => { sent = opts } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/request.js'), 'utf8'), { module, wx, require: () => ({ baseUrl: 'https://example.invalid/api/v1' }) })
  const request = module.exports.get('/community/messages'); token = 'new-token'
  sent.success({ statusCode: 401, data: { code: 40100 } })
  await assert.rejects(request, error => error.code === 40100)
  assert.equal(token, 'new-token')
})

test('按社区号精确查找对方，避免同昵称找错账号', async () => {
  const { page, state } = harness('community', { route: { mode: 'profiles' } })
  page.onInput({ detail: { value: 'u9007199254740993' } }); await page.onSearch()
  assert.equal(state.calls.length, 1)
  assert.equal(state.calls[0].name, 'fetchCommunityProfile')
  assert.equal(state.calls[0].args[0], 'u9007199254740993')
  assert.equal(page.data.list[0].userId, '9007199254740993')
})

test('复制发布者关联用户的社区号，未关联用户时不复制错误账号', async () => {
  const { page, state } = harness('community-profile'); await flush()
  page.setData({ profile: { key: 'b1', userId: '2' } }); page.onCopyKey()
  assert.equal(state.clipboard[0], 'u2')
  page.setData({ profile: { key: 'b1', userId: null } }); page.onCopyKey()
  assert.equal(state.clipboard.length, 1)
})

test('私信列表在前台自动更新未读，离页停止且不会与聊天页轮询混用', async () => {
  let version = 0
  const { page, state } = harness('community', { route: { mode: 'messages' }, api: { fetchCommunityList: async () => ({ records: [{ peer: { key: 'u2', userId: '2', nickname: '用户乙' }, lastMessage: message(++version), unreadCount: version }], pages: 1 }) } })
  await flush(); assert.equal(page.data.list[0].unreadCount, 1)
  state.intervals.values().next().value.fn(); await flush()
  assert.equal(page.data.list[0].unreadCount, 2)
  assert.equal(page.data.list.length, 1)
  page.onHide(); assert.equal(state.intervals.size, 0)
  page.onShow(); await flush(); assert.equal(state.intervals.size, 1)
  page.onUnload(); assert.equal(state.intervals.size, 0)
})

test('下拉刷新保留已加载历史和当前位置，去重合并最新消息且收起刷新状态',async()=>{
 let n=0;const {page:p}=harness('messages',{api:{fetchDirectMessages:async()=>({records:++n===1?[message(2),message(3)]:[message(3),message(4)],hasMore:true,nextBeforeId:'2'})}})
 await flush();p.setData({messages:[message(1),...p.data.messages],scrollTarget:'dm-2'});await p.onRefresh()
 assert.equal(p.data.messages.map(m=>m.id).join(','),'1,2,3,4');assert.equal(p.data.scrollTarget,'dm-2');assert.equal(p.data.refreshing,false);p.onUnload()
})
test('私信双方头像打开对应公开主页，旧账号的自己头像不带入新账号',async()=>{
 const {page:p,state}=harness('messages');await flush()
 p.onAvatar({currentTarget:{dataset:{mine:true}}});p.onAvatar({currentTarget:{dataset:{mine:false}}})
 assert.match(state.navs[0].url,/key=u1$/);assert.match(state.navs[1].url,/key=u2$/)
 p.onHide();state.token='two';p.onShow();assert.equal(p.data.me,null);p.onUnload()
})
test('用户主页读取该作者的公开内容，分页去重并打开真实详情',async()=>{
 const {page:p,state}=harness('community-profile',{api:{fetchProfileArticles:async(key,q)=>({records:[{id:String(q.pageNum),title:'公开投稿',tags:[]}],pages:2})}})
 await flush();assert.equal(p.data.articles.length,1);await p.onMoreArticles();assert.equal(p.data.articles.length,2)
 assert.equal(state.calls.find(c=>c.name==='fetchProfileArticles').args[0],'u2');p.onArticle({currentTarget:{dataset:{id:'2'}}});assert.match(state.navs[0].url,/id=2$/);p.onUnload()
})
test('数字格式的回复标识归入原线程，不接受缺少目标的回复结果',async()=>{
 const root={id:7,author:{key:'u2',nickname:'用户'},replies:[]}
 const {page:p,state,api}=harness('news-detail',{api:{fetchNewsComments:async()=>({records:[root],pages:1}),addNewsComment:async()=>({id:'8',rootCommentId:7,replyToCommentId:7,content:'回复',author:{nickname:'我'}})}})
 await flush();p.onReply({currentTarget:{dataset:{id:7}}});p.onCommentInput({detail:{value:'回复'}});await p.onCommentSend()
 assert.equal(p.data.comments.length,1);assert.equal(p.data.comments[0].replies[0].id,'8')
 p.onReply({currentTarget:{dataset:{id:7}}});p.onCommentInput({detail:{value:'第二次回复'}});api.addNewsComment=async()=>({id:'9'})
 await p.onCommentSend();assert.equal(p.data.commentDraft,'第二次回复');assert.equal(p.data.replyTarget.id,'7');assert.match(state.toasts.at(-1).title,/回复结果异常/);p.onUnload()
})

test('松手刷新至少保留600毫秒三点状态，慢请求完成前不收起，连拉只刷新一次',async()=>{
  const slow=deferred(),{page:p,state,api}=harness('messages',{manualTimeouts:true});await flush()
  api.fetchDirectMessages=()=>slow.promise
  p.onRefresherPulling();assert.equal(p.data.pulling,true)
  const refresh=p.onRefresh();p.onRefresh();assert.equal(p.data.refreshing,true);assert.equal(p.data.pulling,false)
  const timers=[...state.timeouts.values()];assert.equal(timers.length,1);assert.equal(timers[0].ms,600)
  timers[0].fn();await flush();assert.equal(p.data.refreshing,true)
  slow.resolve({records:[message(9)],hasMore:false});await refresh
  assert.equal(p.data.refreshing,false);assert.equal(p.data.messages[0].id,'9');assert.equal(state.calls.filter(c=>c.name==='fetchDirectMessages').length,2);p.onUnload()
})
test('快速刷新也等待三点反馈结束，离页会取消反馈且晚到请求不能回填',async()=>{
  const {page:p,state,api}=harness('messages',{manualTimeouts:true});await flush()
  const fast=p.onRefresh();await flush();assert.equal(p.data.refreshing,true);[...state.timeouts.values()][0].fn();await fast;assert.equal(p.data.refreshing,false)
  const slow=deferred();api.fetchDirectMessages=()=>slow.promise
  const next=p.onRefresh();p.onHide();assert.equal(p.data.refreshing,false);assert.equal(state.timeouts.size,0)
  slow.resolve({records:[message(99)],hasMore:false});await next;assert.equal(p.data.messages.length,0)
})
test('轮询期间下拉会等待原请求后刷新，保持当前位置且不提前关闭提示',async()=>{
  const initial=deferred();const {page:p,state,api}=harness('messages',{manualTimeouts:true,api:{fetchDirectMessages:()=>initial.promise}})
  p.setData({scrollTarget:'dm-keep'});const refresh=p.onRefresh()
  api.fetchDirectMessages=async()=>({records:[message(2)],hasMore:false})
  initial.resolve({records:[message(1)],hasMore:false});await flush()
  assert.equal(state.calls.filter(c=>c.name==='fetchDirectMessages').length,2);assert.equal(p.data.scrollTarget,'dm-keep')
  ;[...state.timeouts.values()][0].fn();await refresh;assert.equal(p.data.messages.map(m=>m.id).join(','),'1,2');p.onUnload()
})
test('仅在消息底部向上拉出现阻尼，松手或取消回弹，不请求或修改消息',async()=>{
  const {page:p,state}=harness('messages',{api:{fetchDirectMessages:async()=>({records:[message(1)],hasMore:false})}});await flush()
  const calls=state.calls.length,rows=JSON.stringify(p.data.messages),touch=(x,y)=>({touches:[{clientX:x,clientY:y}]})
  p.onElasticStart(touch(10,200));p.onElasticMove(touch(10,100));assert.equal(p.data.bottomPull,0)
  p.onMessageLower();p.onElasticStart(touch(10,200));p.onElasticMove(touch(10,100));assert.equal(p.data.bottomPull,32)
  p.onElasticMove(touch(10,-500));assert.equal(p.data.bottomPull,64)
  p.onElasticEnd();assert.equal(p.data.bottomPull,0);assert.equal(p.data.edgeReturning,true)
  p.onElasticStart(touch(10,200));p.onElasticMove(touch(100,180));assert.equal(p.data.bottomPull,0)
  p.onElasticMove(touch(10,100));assert.equal(p.data.bottomPull,32);p.onHide();assert.equal(p.data.bottomPull,0)
  assert.equal(state.calls.length,calls);assert.equal(JSON.stringify(p.data.messages),rows)
})

const focusComment=(id,rootId=id,content='对应评论')=>({id:String(id),content,createdAt:'2026-10-23T12:00:00',author:{key:'u2',nickname:'糖友'},rootCommentId:String(rootId),replyToCommentId:String(rootId)===String(id)?null:String(rootId),replies:[],replyCount:0,replyHasMore:false,replyNextAfterId:null})

test('收到的评论通知带目标编号跳转，点赞通知仍打开文章',async()=>{
  const {page:p,state}=harness('information',{route:{tab:'comments'},api:{fetchInteractionNotices:async()=>({records:[{id:'1',kind:'COMMENT',newsId:'10',commentId:'9007199254740993',actor:{key:'u2'},createdAt:'2026-10-23T12:00:00'}],pages:1})}});await flush()
  p.onOpen({currentTarget:{dataset:{id:'1'}}});assert.equal(state.navs.at(-1).url,'/pages/news-detail/news-detail?id=10&comments=1&commentId=9007199254740993')
  p.setData({activeTab:'likes',list:[{rowKey:'2',kind:'LIKE',newsId:'10'}]});p.onOpen({currentTarget:{dataset:{id:'2'}}});assert.equal(state.navs.at(-1).url,'/pages/news-detail/news-detail?id=10');p.onUnload()
})
test('评论通知定位分页外根评论和折叠回复，不等待封面且继续回复分页不丢目标',async()=>{
  const cover=deferred(),target=focusComment('90','1'),root={...focusComment('1'),replies:[focusComment('2','1'),focusComment('3','1'),focusComment('4','1'),target],replyCount:90,replyHasMore:true,replyNextAfterId:'4'}
  const {page:p,state}=harness('news-detail',{route:{id:'10',commentId:'90',comments:'1'},cover:()=>cover.promise,api:{fetchNewsComments:async(id,q)=>({records:q.pageNum===1?[focusComment('200')]:[{...root,replies:root.replies.slice(0,3)}],pages:2}),fetchCommentContext:async()=>({commentId:'90',root}),fetchCommentReplies:async()=>({records:[focusComment('5','1')],hasMore:true,nextAfterId:'5'})}})
  await flush();assert.equal(state.scrolls.at(-1).selector,'#comment-90');assert.equal(p.data.highlightedCommentId,'90');assert.equal(p.findComment('90').rootCommentId,'1');assert.equal(p.data.commentFocus,false);assert.equal(p.data.comments[0].id,'1')
  await p.onMoreComments();assert.equal(p.data.comments.filter(c=>c.id==='1').length,1);assert.ok(p.findComment('90'))
  await p.onMoreReplies({currentTarget:{dataset:{id:'1'}}});assert.equal(state.calls.find(c=>c.name==='fetchCommentReplies').args[2].afterId,'4');assert.equal(p.data.comments.find(c=>c.id==='1').replies.filter(r=>r.id==='90').length,1)
  const count=state.scrolls.length;p.loadDetail();await flush();assert.equal(state.scrolls.length,count);p.onUnload();cover.resolve('cover')
})
test('评论先返回时等文章节点就绪再精确滚动，隐藏页面后排队滚动失效',async()=>{
  const detail=deferred(),{page:p,state}=harness('news-detail',{manualNextTick:true,route:{id:'10',commentId:'90'},api:{fetchNewsDetail:()=>detail.promise,fetchCommentContext:async()=>({commentId:'90',root:focusComment('90')})}})
  await flush();assert.equal(state.scrolls.length,0);assert.equal(p.data.highlightedCommentId,'90');detail.resolve({id:'10',title:'文章',commentCount:1});await flush();assert.equal(state.scrolls.length,0);assert.ok(state.ticks.length)
  p.onHide();state.ticks.forEach(fn=>fn());assert.equal(state.scrolls.length,0);p.onUnload()
})
test('目标删除有明确提示，网络失败可重试成功定位，不误跳其他评论',async()=>{
  const {page:p,state,api}=harness('news-detail',{route:{id:'10',commentId:'90'}});await flush();assert.equal(p.data.commentTargetError,'该评论已删除或暂不可见');assert.ok(state.scrolls.some(s=>s.selector==='#article-comments'));assert.ok(!state.scrolls.some(s=>s.selector==='#comment-90'))
  api.fetchCommentContext=async()=>{throw new Error('offline')};await p.onRetryCommentTarget();assert.equal(p.data.commentTargetError,'评论定位失败，点击重试')
  api.fetchCommentContext=async()=>({commentId:'90',root:focusComment('90')});await p.onRetryCommentTarget();assert.equal(p.data.commentTargetError,'');assert.equal(state.scrolls.at(-1).selector,'#comment-90');p.onUnload()
})
test('换账号后迟到的评论上下文不能回填或重新滚动',async()=>{
  const old=deferred();let requests=0
  const {page:p,state}=harness('news-detail',{route:{id:'10',commentId:'90'},api:{fetchCommentContext:()=>++requests===1?old.promise:Promise.resolve({commentId:'90',root:focusComment('90','90','当前账号可见')})}})
  await flush();p.onHide();state.token='two';p.onShow();await flush();assert.equal(p.findComment('90').content,'当前账号可见')
  const count=state.scrolls.length;old.resolve({commentId:'90',root:focusComment('90','90','旧账号内容')});await flush();assert.equal(p.findComment('90').content,'当前账号可见');assert.equal(state.scrolls.length,count);p.onUnload()
})

test('从评论入口加载后定位评论区，不等待封面，不弹键盘，后续刷新不重复定位',async()=>{
  const cover=deferred(),{page:p,state}=harness('news-detail',{route:{id:'10',comments:'1'},cover:()=>cover.promise})
  await flush();assert.equal(p.data.loading,false);assert.equal(state.scrolls.length,1);assert.equal(state.scrolls[0].selector,'#article-comments');assert.equal(p.data.commentFocus,false)
  cover.resolve('wxfile://cover.jpg');await flush();assert.equal(p.data.news.cover,'wxfile://cover.jpg')
  await p.loadDetail();assert.equal(state.scrolls.length,1)
  p.onComments();assert.equal(state.scrolls.length,2);assert.equal(state.navs.length,0);p.onUnload()
})
test('普通正文入口不自动滚动，文章失败或离页后的布局回调也不跳转',async()=>{
  const normal=harness('news-detail');await flush();assert.equal(normal.state.scrolls.length,0);normal.page.onUnload()
  const failed=harness('news-detail',{route:{id:'10',comments:'1'},api:{fetchNewsDetail:async()=>{throw new Error('文章不可见')}}});await flush();assert.equal(failed.state.scrolls.length,0);failed.page.onUnload()
  const late=harness('news-detail',{route:{id:'10',comments:'1'},manualNextTick:true});await flush();assert.equal(late.state.ticks.length,1)
  late.page.onHide();late.state.ticks[0]();assert.equal(late.state.scrolls.length,0);late.page.onUnload()
})
test('详情点赞收藏依服务端结果给出底部反馈，失败保留状态且没有成功提示',async()=>{
  let liked=false,collected=false,fail=false
  const {page:p,state}=harness('news-detail',{api:{updateNewsAction:async(id,patch)=>{
    if(fail)throw new Error('网络异常');if('liked' in patch)liked=patch.liked;if('collected' in patch)collected=patch.collected
    return{liked,collected,likeCount:liked?1:0,collectCount:collected?1:0}
  }}});await flush()
  await p.onLike();await p.onCollect();assert.equal(p.data.liked,true);assert.equal(p.data.collected,true)
  await p.onLike();await p.onCollect();assert.equal(state.feedback.join(','),'点赞成功,收藏成功,已取消点赞,已取消收藏')
  fail=true;await p.onLike();assert.equal(state.feedback.length,4);assert.equal(p.data.liked,false);assert.match(state.toasts.at(-1).title,/网络异常/);p.onUnload()
})
test('文章及个人资料的关注取消都有底部反馈，旧账号迟到结果不提示成功',async()=>{
  const profile=harness('community-profile');await flush();await profile.page.onFollow();await profile.page.onFollow()
  assert.equal(profile.state.feedback.join(','),'关注成功,取消关注成功');profile.page.onUnload()
  const late=deferred(),detail=harness('news-detail',{api:{fetchNewsDetail:async()=>({id:'10',author:{key:'u2',followed:false}}),setCommunityFollowing:()=>late.promise}})
  await flush();const pending=detail.page.onFollowAuthor();detail.page.onHide();detail.state.token='other';late.resolve({key:'u2',followed:true});await pending;assert.equal(detail.state.feedback.length,0);detail.page.onUnload()
  const article=harness('news-detail',{api:{fetchNewsDetail:async()=>({id:'10',author:{key:'u2',followed:false}})}})
  await flush();await article.page.onFollowAuthor();await article.page.onFollowAuthor();assert.equal(article.state.feedback.join(','),'关注成功,取消关注成功');article.page.onUnload()
})
test('评论及线程回复成功显示对应反馈，回复目标异常保留草稿且不显示成功',async()=>{
  const {page:p,state,api}=harness('news-detail',{api:{fetchNewsComments:async()=>({records:[{id:'7',author:{nickname:'糖友'},replies:[]}],pages:1}),addNewsComment:async()=>({id:'8',rootCommentId:'7',replyToCommentId:'7',author:{nickname:'我'}})}})
  await flush();p.onReply({currentTarget:{dataset:{id:'7'}}});p.onCommentInput({detail:{value:'回复内容'}});await p.onCommentSend();assert.equal(state.feedback.at(-1),'回复成功')
  p.onCommentInput({detail:{value:'普通评论'}});api.addNewsComment=async()=>({id:'9',content:'普通评论'});await p.onCommentSend();assert.equal(state.feedback.at(-1),'评论成功')
  p.onReply({currentTarget:{dataset:{id:'7'}}});p.onCommentInput({detail:{value:'不应变成主评论'}});api.addNewsComment=async()=>({id:'10'});await p.onCommentSend()
  assert.equal(state.feedback.length,2);assert.equal(p.data.commentDraft,'不应变成主评论');p.onUnload()
})
