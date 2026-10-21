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
  const state = { token: 'account-one', calls: [], toasts: [], navs: [], scrolls: [], intervals: new Map(), timeouts:new Map(), modals: [], clipboard: [], reset: 0, speech:[] }
  const app = { checkLogin: () => !!state.token, resetLoginState() { state.token = ''; state.reset++ } }
  const request = { getToken: () => state.token }
  const wx = { showToast: v => state.toasts.push(v), navigateTo: v => state.navs.push(v), reLaunch: v => state.navs.push(v),
    setNavigationBarTitle() {}, pageScrollTo(v) { state.scrolls.push(v);if(v.complete)v.complete() }, showModal: v => state.modals.push(v), setClipboardData: v => state.clipboard.push(v.data) }
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
    fetchNewsDetail: async () => ({ id: '10', title: '真实文章', liked: false, collected: false, likeCount: 0, collectCount: 0, commentCount: 0 }),
    fetchNewsComments: async () => ({ records: [], pages: 0 }), addNewsComment: async () => ({}), deleteNewsComment: async () => ({}),
    fetchCommentReplies: async () => ({ records: [], hasMore:false, nextAfterId:null }),
    updateNewsAction: async (id, payload) => ({ liked: !!payload.liked, collected: !!payload.collected, likeCount: payload.liked ? 1 : 0, collectCount: payload.collected ? 1 : 0 }),
    ...options.api
  }
  const api = Object.fromEntries(Object.keys(implementations).map(key => [key, (...args) => { state.calls.push({ name: key, args }); return implementations[key](...args) }]))
  let definition, timerId = 0
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page: v => { definition = v }, wx, getApp: () => app,
    setInterval: (fn, ms) => { state.intervals.set(++timerId, { fn, ms }); return timerId }, clearInterval: id => state.intervals.delete(id),
    setTimeout:(fn,ms)=>{if(!options.manualTimeouts){fn();return 0}const id=++timerId;state.timeouts.set(id,{fn:()=>{state.timeouts.delete(id);fn()},ms});return id},
    clearTimeout:id=>state.timeouts.delete(id),
    require: key => ({ '../../services/api': api, '../../utils/community': socialModule.exports,
      '../../utils/request': request, '../../utils/message-notifications':{refresh:()=>state.calls.push({name:'refreshUnread'}),count:v=>Math.max(0,Number(v)||0),label:v=>Number(v)>99?'99+':Number(v)>0?String(v):''}, '../../utils/remote-image':{mapField:async rows=>rows,loadRemoteImage:async url=>url}, '../../utils/display': { applyDisplayToCurrentPage() {} } }[key])
  })
  const page = { ...definition, selectComponent:()=>({beginHold:()=>state.speech.push('start'),endHold:cancel=>state.speech.push(cancel?'cancel':'stop')}), data: JSON.parse(JSON.stringify(definition.data)), setData(patch,callback) {
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
  await flush();assert.equal(p.data.tabs.map(t=>t.label).join(','),'私信,点赞,收藏,收到的评论,新关注我的');assert.equal(p.data.list[0].action,'赞了你的文章')
  assert.deepEqual(state.calls.find(c=>c.name==='readInteractionNotices').args,['LIKE','90'])
  p.onOpen({currentTarget:{dataset:{id:'90'}}});assert.match(state.navs[0].url,/news-detail.*id=10/)
  p.onTab({currentTarget:{dataset:{key:'follows'}}});await flush();p.onOpen({currentTarget:{dataset:{id:'90'}}});assert.match(state.navs[1].url,/community-profile.*key=u2/)
  assert.equal(state.intervals.size,1);p.onHide();assert.equal(state.intervals.size,0)
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
test('公开资料可以关注取消及给用户发私信，未关联用户的发布者不显示假私信', async () => {
  const { page, state } = harness('community-profile'); await flush()
  await page.onFollow(); assert.equal(page.data.profile.followed, true)
  await page.onFollow(); assert.equal(page.data.profile.followed, false)
  page.onMessage(); assert.match(state.navs[0].url, /messages.*peer=2/)
  page.setData({ profile: { key: 'b1', userId: null, followed: true } }); page.onMessage(); assert.equal(state.navs.length, 1)
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
