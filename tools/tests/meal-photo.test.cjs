const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function harness(){
 let definition
 const state={token:'one',downloads:[],removed:[],previews:[],aborts:0}
 const wx={downloadFile:options=>{state.downloads.push(options);return{abort(){state.aborts++}}},getFileSystemManager:()=>({unlink:options=>state.removed.push(options.filePath)}),previewImage:options=>state.previews.push(options)}
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/meal-photo/meal-photo.js'),'utf8'),{Component:value=>definition=value,wx,
  require:name=>name.endsWith('config')?{baseUrl:'https://example.test/api/v1'}:{getToken:()=>state.token}})
 const c={...definition.methods,data:{...definition.data,mediaId:'9007199254740993'},setData:values=>Object.assign(c.data,values)}
 definition.lifetimes.attached.call(c)
 return{c,state,definition}
}
test('正餐图通过当前API带Bearer下载，预览只使用本地临时图片且保留长ID',()=>{
 const {c,state}=harness();assert.equal(state.downloads[0].url,'https://example.test/api/v1/meal-records/images/9007199254740993')
 assert.equal(state.downloads[0].header.Authorization,'Bearer one');c.preview();assert.equal(state.previews.length,0)
 c.load();state.downloads[1].success({statusCode:200,tempFilePath:'wxfile://meal.jpg'});c.preview()
 assert.equal(state.previews[0].current,'wxfile://meal.jpg');assert.equal(state.previews[0].urls[0],'wxfile://meal.jpg')
})
test('照片读取失败可重试，错误响应不作为图片显示',()=>{
 const {c,state}=harness();state.downloads[0].success({statusCode:403,tempFilePath:'error.json'})
 assert.equal(c.data.source,'');assert.equal(c.data.error,true);assert.ok(state.removed.includes('error.json'))
 c.load();state.downloads[1].success({statusCode:200,tempFilePath:'meal.jpg'});assert.equal(c.data.source,'meal.jpg');assert.equal(c.data.error,false)
})
test('换媒体、隐藏、卸载和换账号使旧请求失效并回收私有图片',()=>{
 const {c,state,definition}=harness();state.token='two';state.downloads[0].success({statusCode:200,tempFilePath:'old-account.jpg'})
 assert.equal(c.data.source,'');assert.ok(state.removed.includes('old-account.jpg'))
 c.load();c.data.mediaId='2';definition.properties.mediaId.observer.call(c)
 state.downloads[1].success({statusCode:200,tempFilePath:'old-media.jpg'});assert.ok(state.removed.includes('old-media.jpg'))
 state.downloads[2].success({statusCode:200,tempFilePath:'current.jpg'});definition.pageLifetimes.hide.call(c)
 assert.equal(c.data.source,'');assert.ok(state.removed.includes('current.jpg'));assert.ok(state.aborts>0)
 definition.pageLifetimes.show.call(c);definition.lifetimes.detached.call(c)
 state.downloads[3].success({statusCode:200,tempFilePath:'after-detach.jpg'});assert.ok(state.removed.includes('after-detach.jpg'))
})
test('退出登录后不预览已有照片，也不下载新照片',()=>{
 const {c,state}=harness();state.downloads[0].success({statusCode:200,tempFilePath:'private.jpg'});state.token=''
 c.preview();assert.equal(state.previews.length,0);assert.equal(c.data.source,'');c.load();assert.equal(state.downloads.length,1)
})
