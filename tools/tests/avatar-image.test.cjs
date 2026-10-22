const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function images(){
 const config={baseUrl:'http://current.example.test:8080/api/v1'},calls=[],files=new Set(),mod={exports:{}}
 const wx={downloadFile:options=>calls.push(options),getFileSystemManager:()=>({access:options=>files.has(options.path)?options.success():options.fail()})}
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/remote-image.js'),'utf8'),{module:mod,wx,require:key=>{assert.equal(key,'./config');return config}})
 return {...mod.exports,config,calls,files}
}
const avatar='http://127.0.0.1:8080/api/v1/media-files/local-objects?key=1%2Fowner%2Favatar.jpg'

test('旧回环地址、旧网络地址和相对本地图像地址跟随当前API，保留对象键；云图片与临时路径保持原值',()=>{
 const i=images(),expected=i.config.baseUrl+'/media-files/local-objects?key=1%2Fowner%2Favatar.jpg'
 assert.equal(i.resolveImageUrl(avatar),expected)
 assert.equal(i.resolveImageUrl(avatar.replace('127.0.0.1','old-network.example.test')),expected)
 assert.equal(i.resolveImageUrl(avatar.replace('http://127.0.0.1:8080','')),expected)
 assert.equal(i.resolveImageUrl('/api/v1/media-files/avatars/50'),i.config.baseUrl+'/media-files/avatars/50')
 for(const value of ['https://bucket.example.test/avatar.jpg?signature=example','wxfile://tmp-avatar.jpg','/assets/avatar.png'])assert.equal(i.resolveImageUrl(value),value)
 i.config.baseUrl='https://new.example.test/api/v1/'
 assert.equal(i.resolveImageUrl(avatar),'https://new.example.test/api/v1/media-files/local-objects?key=1%2Fowner%2Favatar.jpg')
})

test('头像通过downloadFile下载，重复展示合并请求，缓存文件确实存在时才复用',async()=>{
 const i=images(),one=i.loadRemoteImage(avatar),two=i.loadRemoteImage(avatar)
 assert.equal(i.calls.length,1);assert.match(i.calls[0].url,/current\.example\.test/)
 i.files.add('wxfile://current.jpg');i.calls[0].success({statusCode:200,tempFilePath:'wxfile://current.jpg'})
 assert.equal(await one,'wxfile://current.jpg');assert.equal(await two,'wxfile://current.jpg')
 assert.equal(await i.loadRemoteImage(avatar),'wxfile://current.jpg');assert.equal(i.calls.length,1)
 i.files.clear();const next=i.loadRemoteImage(avatar);await flush();assert.equal(i.calls.length,2)
 i.calls[1].success({statusCode:200,tempFilePath:'wxfile://refreshed.jpg'});assert.equal(await next,'wxfile://refreshed.jpg')
})

test('404和下载失败不缓存假图片，临时文件失效或图片解码失败后下次重新下载',async()=>{
 const i=images();let task=i.loadRemoteImage(avatar)
 i.calls[0].success({statusCode:404,tempFilePath:'wxfile://error.json'});assert.equal(await task,i.resolveImageUrl(avatar))
 task=i.loadRemoteImage(avatar);assert.equal(i.calls.length,2);i.calls[1].fail();await task
 task=i.loadRemoteImage(avatar);i.calls[2].success({statusCode:200,tempFilePath:'wxfile://bad-image.jpg'});await task
 i.files.add('wxfile://bad-image.jpg');i.invalidateRemoteImage(avatar)
 task=i.loadRemoteImage(avatar);assert.equal(i.calls.length,4);i.calls[3].success({statusCode:200,tempFilePath:'wxfile://good-image.jpg'});await task
})

function component(){
 let definition,token='one';const loads=[],invalid=[]
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/avatar-image/avatar-image.js'),'utf8'),{
  Component:value=>definition=value,
  require:key=>key.endsWith('request')?{getToken:()=>token}:{loadRemoteImage:source=>{const task=deferred();loads.push({source,...task});return task.promise},invalidateRemoteImage:source=>invalid.push(source)}
 })
 const instance={...definition.methods,data:{src:avatar,source:'',error:false},setData:data=>Object.assign(instance.data,data)}
 definition.lifetimes.attached.call(instance)
 return {definition,instance,loads,invalid,setToken:value=>{token=value}}
}

test('头像属性变化、切换账号或组件离页后，迟到下载不能覆盖当前头像',async()=>{
 const c=component(),p=c.instance
 p.data.src='https://images.example.test/new.jpg';const newer=p.load()
 c.loads[1].resolve('wxfile://new.jpg');await newer
 c.loads[0].resolve('wxfile://old.jpg');await flush();assert.equal(p.data.source,'wxfile://new.jpg')
 const pending=p.load();c.setToken('two');c.loads[2].resolve('wxfile://old-account.jpg');await pending;assert.equal(p.data.source,'')
 const detached=p.load();c.definition.lifetimes.detached.call(p);c.loads[3].resolve('wxfile://detached.jpg');await detached;assert.equal(p.data.source,'')
})

test('重新进入页面会重新校验头像缓存，图片失败显示占位且保留原始登记URL',async()=>{
 const c=component(),p=c.instance
 c.loads[0].resolve('wxfile://first.jpg');await flush();assert.equal(p.data.source,'wxfile://first.jpg')
 p.onImageError();assert.equal(p.data.error,true);assert.equal(p.data.src,avatar);assert.equal(c.invalid[0],avatar)
 c.definition.pageLifetimes.hide.call(p);c.definition.pageLifetimes.show.call(p)
 assert.equal(c.loads.length,2);c.loads[1].resolve('wxfile://new-session.jpg');await flush();assert.equal(p.data.source,'wxfile://new-session.jpg')
 assert.equal(p.data.error,false);assert.equal(p.data.src,avatar)
})
