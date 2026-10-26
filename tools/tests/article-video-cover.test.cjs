const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function harness(id='9007199254740993') {
  let definition
  const state={token:'owner-one',downloads:[],removed:[],aborts:0,events:[]}
  const wx={downloadFile:options=>{state.downloads.push(options);return{abort(){state.aborts++}}},getFileSystemManager:()=>({unlink:options=>state.removed.push(options.filePath)})}
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/article-video-cover/article-video-cover.js'),'utf8'),{Component:value=>definition=value,wx,require:name=>name.endsWith('config')?{baseUrl:'https://example.test/api/v1'}:{getToken:()=>state.token}})
  const c={...definition.methods,data:{...definition.data,mediaId:id},setData:values=>Object.assign(c.data,values),triggerEvent:(name,detail)=>state.events.push({name,detail})}
  definition.lifetimes.attached.call(c)
  return{state,c,definition}
}

test('我的文章和草稿只请求小图，保留长ID与身份，不创建播放器，不抢占整卡点击',()=>{
  const {state}=harness();assert.equal(state.downloads.length,1)
  assert.equal(state.downloads[0].url,'https://example.test/api/v1/community/article-videos/9007199254740993/cover')
  assert.equal(state.downloads[0].header.Authorization,'Bearer owner-one')
  const template=fs.readFileSync(path.join(root,'components/article-video-cover/article-video-cover.wxml'),'utf8')
  assert.doesNotMatch(template,/<video\b|bindtap="(?:play|preview)"/)
  const page=fs.readFileSync(path.join(root,'pages/community-articles/community-articles.wxml'),'utf8')
  assert.ok(page.indexOf('item.videos.length')<page.indexOf('item.images.length'));assert.match(page,/<article-video-cover media-id="\{\{item.videos\[0\].mediaId\}\}"/)
})

test('加载失败可重试，不把接口错误响应当封面，无令牌不请求',()=>{
  const {state,c}=harness();state.downloads[0].success({statusCode:400,tempFilePath:'error.json'})
  assert.equal(c.data.error,true);assert.equal(c.data.source,'');assert.ok(state.removed.includes('error.json'))
  c.retry();assert.equal(state.downloads.length,2);state.downloads[1].success({statusCode:200,tempFilePath:'frame.jpg'})
  assert.equal(c.data.source,'frame.jpg');assert.equal(c.data.error,false)
  c.failed();assert.ok(state.removed.includes('frame.jpg'));state.token='';c.retry();assert.equal(state.downloads.length,2)
})

test('媒体和账号变化不展示迟到旧封面，隐藏与卸载清理私有临时图',()=>{
  const {state,c,definition}=harness();state.token='owner-two'
  state.downloads[0].success({statusCode:200,tempFilePath:'old-user.jpg'});assert.equal(c.data.source,'');assert.ok(state.removed.includes('old-user.jpg'))
  c.load();c.data.mediaId='8';definition.properties.mediaId.observer.call(c)
  state.downloads[1].success({statusCode:200,tempFilePath:'old-media.jpg'});assert.ok(state.removed.includes('old-media.jpg'));assert.equal(c.data.source,'')
  state.downloads[2].success({statusCode:200,tempFilePath:'current.jpg'});definition.pageLifetimes.hide.call(c)
  assert.equal(c.data.source,'');assert.ok(state.removed.includes('current.jpg'));assert.ok(state.aborts>0)
  definition.pageLifetimes.show.call(c);assert.equal(state.downloads.length,4);definition.lifetimes.detached.call(c)
  state.downloads[3].success({statusCode:200,tempFilePath:'after-detach.jpg'});assert.ok(state.removed.includes('after-detach.jpg'));assert.equal(c.data.source,'')
})
