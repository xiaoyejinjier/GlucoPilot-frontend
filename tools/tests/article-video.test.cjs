const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),root=path.resolve(__dirname,'../..')
function moduleHarness(){
  let definition;const state={token:'one',downloads:[],removed:[],pauses:[],aborts:0}
  const wx={downloadFile:options=>{state.downloads.push(options);return{abort(){state.aborts++}}},getFileSystemManager:()=>({unlink:options=>state.removed.push(options.filePath)}),createVideoContext:(_id,component)=>({pause:()=>state.pauses.push(component.data.mediaId)})}
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/article-video/article-video.js'),'utf8'),{Component:value=>definition=value,wx,require:name=>name.endsWith('config')?{baseUrl:'https://example.test/api/v1'}:{getToken:()=>state.token}})
  function create(id='7',lazy=true){const c={...definition.methods,data:{...definition.data,mediaId:id,lazy},setData:values=>Object.assign(c.data,values)};definition.lifetimes.attached.call(c);return c}
  return{state,definition,create}
}
test('社区视频点击才鉴权下载，详情默认加载，原地播放不冒泡跳文章',()=>{
  const {state,create}=moduleHarness(),c=create();assert.equal(state.downloads.length,0);c.activate();assert.equal(state.downloads.length,1);assert.equal(state.downloads[0].header.Authorization,'Bearer one');assert.match(state.downloads[0].url,/article-videos\/7$/)
  state.downloads[0].success({statusCode:200,tempFilePath:'video.mp4'});assert.equal(c.data.source,'video.mp4');assert.equal(c.data.requested,true);create('8',false);assert.equal(state.downloads.length,2)
  const template=fs.readFileSync(path.join(root,'components/article-video/article-video.wxml'),'utf8');assert.match(template,/catchtap="stopPropagation"/);assert.match(template,/autoplay="\{\{lazy && requested\}\}"/)
})
test('切换视频暂停上一个，离页暂停，换账号清掉旧视频而不自动下载列表视频',()=>{
  const {state,create,definition}=moduleHarness(),a=create('7'),b=create('8');a.activate();state.downloads[0].success({statusCode:200,tempFilePath:'first.mp4'});a.onPlay();b.onPlay();assert.ok(state.pauses.includes('7'))
  definition.pageLifetimes.hide.call(a);assert.equal(a.data.requested,false);state.token='two';definition.pageLifetimes.show.call(a);assert.equal(a.data.source,'');assert.ok(state.removed.includes('first.mp4'));assert.equal(state.downloads.length,1)
})
test('账号或媒体变化丢弃迟到私有文件，加载失败只在用户重试时再请求',()=>{
  const {state,create,definition}=moduleHarness(),c=create();c.activate();state.token='two';state.downloads[0].success({statusCode:200,tempFilePath:'old-private.mp4'});assert.equal(c.data.source,'');assert.ok(state.removed.includes('old-private.mp4'))
  c.activate();state.downloads[1].success({statusCode:500,tempFilePath:'error.tmp'});assert.equal(c.data.error,true);assert.equal(c.data.source,'');c.activate();assert.equal(state.downloads.length,3)
  c.data.mediaId='9';definition.properties.mediaId.observer.call(c);state.downloads[2].success({statusCode:200,tempFilePath:'old-clip.mp4'});assert.equal(c.data.source,'');assert.equal(c.data.requested,false);assert.ok(state.removed.includes('old-clip.mp4'));definition.lifetimes.detached.call(c)
})

function attachCover(parent,state){
  let definition
  const wx={downloadFile:options=>{state.downloads.push(options);return{abort(){state.aborts++}}},getFileSystemManager:()=>({unlink:options=>state.removed.push(options.filePath)})}
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/article-video-cover/article-video-cover.js'),'utf8'),{Component:value=>definition=value,wx,require:name=>name.endsWith('config')?{baseUrl:'https://example.test/api/v1'}:{getToken:()=>state.token}})
  const c={...definition.methods,data:{...definition.data,mediaId:parent.data.mediaId,variant:'player'},setData:values=>Object.assign(c.data,values),triggerEvent:(name,detail)=>{assert.equal(name,'coverchange');parent.onCoverChange({detail})}}
  definition.lifetimes.attached.call(c);return{c,definition}
}

test('社区进入先读首帧小图，点击才读原视频，下载期间保留封面且连点不重复下载',()=>{
  const {state,create}=moduleHarness(),player=create('9007199254740993'),cover=attachCover(player,state)
  assert.equal(state.downloads.length,1);assert.match(state.downloads[0].url,/article-videos\/9007199254740993\/cover$/)
  assert.equal(state.downloads[0].header.Authorization,'Bearer one');state.downloads[0].success({statusCode:200,tempFilePath:'first-frame.jpg'})
  assert.equal(player.data.poster,'first-frame.jpg');assert.equal(player.data.source,'');assert.equal(player.data.requested,false)
  player.activate();player.activate();assert.equal(state.downloads.length,2);assert.match(state.downloads[1].url,/article-videos\/9007199254740993$/)
  assert.equal(player.data.poster,'first-frame.jpg');state.downloads[1].success({statusCode:200,tempFilePath:'clip.mp4'})
  assert.equal(player.data.source,'clip.mp4');assert.equal(cover.c.data.source,'first-frame.jpg')
  const template=fs.readFileSync(path.join(root,'components/article-video/article-video.wxml'),'utf8')
  assert.match(template,/poster="\{\{poster\}\}"/);assert.match(template,/hidden="\{\{!!source\}\}"/);assert.match(template,/bind:coverchange="onCoverChange"/)
})

test('列表离开会清理视频和封面、暂停播放；返回恢复首帧而不自动重播',()=>{
  const {state,create,definition}=moduleHarness(),player=create(),cover=attachCover(player,state)
  state.downloads[0].success({statusCode:200,tempFilePath:'frame.jpg'});player.activate();state.downloads[1].success({statusCode:200,tempFilePath:'clip.mp4'});player.onPlay()
  definition.pageLifetimes.hide.call(player);cover.definition.pageLifetimes.hide.call(cover.c)
  assert.equal(player.data.source,'');assert.equal(player.data.poster,'');assert.ok(state.removed.includes('clip.mp4'));assert.ok(state.removed.includes('frame.jpg'));assert.ok(state.pauses.includes('7'))
  definition.pageLifetimes.show.call(player);cover.definition.pageLifetimes.show.call(cover.c)
  assert.equal(state.downloads.length,3);assert.match(state.downloads[2].url,/\/cover$/);assert.equal(player.data.requested,false)
  state.downloads[2].success({statusCode:200,tempFilePath:'fresh.jpg'});assert.equal(player.data.poster,'fresh.jpg');assert.equal(player.data.source,'')
})

test('视频失败保留首帧供重试，封面错误和换账号的迟到封面不会当作poster',()=>{
  const {state,create}=moduleHarness(),player=create(),cover=attachCover(player,state)
  state.downloads[0].success({statusCode:200,tempFilePath:'frame.jpg'});player.activate();state.downloads[1].success({statusCode:500,tempFilePath:'error.json'})
  assert.equal(player.data.error,true);assert.equal(player.data.poster,'frame.jpg');assert.equal(player.data.source,'');player.activate();assert.equal(state.downloads.length,3)
  cover.c.failed();assert.equal(player.data.poster,'');cover.c.retry();state.token='two';state.downloads[3].success({statusCode:200,tempFilePath:'old-account.jpg'})
  assert.equal(player.data.poster,'');assert.ok(state.removed.includes('old-account.jpg'));player.onCoverChange({detail:{mediaId:'8',source:'other-video.jpg'}});assert.equal(player.data.poster,'')
})
