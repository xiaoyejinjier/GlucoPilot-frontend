const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const person={communityKey:'u1',nickname:'糖友',avatarUrl:'https://example.invalid/old.png',avatarText:'糖',diabetesType:'2型糖尿病',age:30,height:170,weight:65,targetFasting:6,targetPostprandial:8}
function harness(overrides={}) {
 const state={token:'one',calls:[],toasts:[],saved:[],timers:[],navs:[]}
 const wx={chooseMedia:o=>o.success({tempFiles:[{tempFilePath:'wxfile://new-avatar.jpg',size:100}]}),showToast:o=>state.toasts.push(o),navigateBack:()=>state.navs.push('back')}
 const api={fetchMe:async()=>({...person}),updateProfile:async()=>({updated:true}),saveHealthProfile:async()=>({updated:true}),...overrides}
 const calls=Object.fromEntries(Object.entries(api).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
 const media={BIZ_TYPE:{AVATAR:1},MAX_IMAGE_BYTES:5242880,uploadMediaFile:async(...args)=>{state.calls.push({key:'upload',args});return overrides.upload?overrides.upload(...args):{id:'101',fileUrl:'https://example.invalid/registered.png'}}}
 const deps={'../../services/api':calls,'../../utils/storage':{getUserInfo:()=>({...person}),saveUserInfo:me=>state.saved.push(me)},'../../utils/display':{applyDisplayToCurrentPage(){}},'../../utils/media':media,'../../utils/request':{getToken:()=>state.token},'../../utils/mappers':{DIABETES_TYPE_TEXT:['未填写','1型糖尿病','2型糖尿病'],diabetesCode:value=>value==='2型糖尿病'?2:0}}
 let def;vm.runInNewContext(fs.readFileSync(path.join(root,'pages/profile-edit/profile-edit.js'),'utf8'),{Page:x=>def=x,wx,require:key=>{assert.ok(deps[key],key);return deps[key]},setTimeout:fn=>{state.timers.push(fn);return state.timers.length},clearTimeout(){}})
 const p={...def,data:JSON.parse(JSON.stringify(def.data)),setData:patch=>Object.assign(p.data,patch)};p.onLoad();p.onShow()
 return{p,state,wx}
}
test('头像走AVATAR上传登记，阻止提前保存，资料只提交登记返回的地址',async()=>{
 const upload=deferred(),{p,state}=harness({upload:()=>upload.promise});await flush()
 const task=p.onChooseAvatar();await flush();assert.equal(p.data.uploadingAvatar,true);assert.equal(p.data.avatarPreview,'wxfile://new-avatar.jpg')
 await p.onSave();assert.equal(state.calls.filter(c=>c.key==='updateProfile').length,0)
 upload.resolve({id:'101',fileUrl:'https://example.invalid/registered.png'});await task
 assert.equal(p.data.uploadingAvatar,false);assert.equal(p.data.avatarPreview,'');assert.equal(state.calls.find(c=>c.key==='upload').args[0],1)
 await p.onSave();assert.equal(state.calls.find(c=>c.key==='updateProfile').args[0].avatarUrl,'https://example.invalid/registered.png')
 assert.equal(state.calls.find(c=>c.key==='saveHealthProfile').args[0].targetFasting,6);p.onUnload()
})
test('未修改头像不重提旧URL，清空头像明确提交空串',async()=>{
 const {p,state}=harness();await flush();await p.onSave()
 assert.equal(Object.hasOwn(state.calls.find(c=>c.key==='updateProfile').args[0],'avatarUrl'),false)
 p.onClearAvatar();await p.onSave();assert.equal(state.calls.filter(c=>c.key==='updateProfile').at(-1).args[0].avatarUrl,'');p.onUnload()
})

test('个性签名作为本人资料保存，电话号码展示不通过资料接口修改',async()=>{
 const {p,state}=harness();await flush()
 p.onField({currentTarget:{dataset:{key:'bio'}},detail:{value:'  认真记录每一天  '}})
 p.setData({form:{...p.data.form,phone:'13800000000'}});await p.onSave()
 const payload=state.calls.find(c=>c.key==='updateProfile').args[0]
 assert.equal(payload.bio,'认真记录每一天');assert.equal(Object.hasOwn(payload,'phone'),false);p.onUnload()
})

test('MinIO私有桶的稳定头像路径可以保存，临时显示地址不替代登记身份',async()=>{
 const {p,state}=harness({upload:async()=>({id:'101',fileUrl:'/api/v1/media-files/avatars/101'})});await flush()
 await p.onChooseAvatar();assert.equal(p.data.form.avatarUrl,'/api/v1/media-files/avatars/101');assert.equal(p.data.avatarPreview,'')
 await p.onSave();assert.equal(state.calls.find(c=>c.key==='updateProfile').args[0].avatarUrl,'/api/v1/media-files/avatars/101');p.onUnload()
})
test('头像上传失败保留原图，取消或不合法返回不提交手机路径',async()=>{
 const {p,state}=harness({upload:async()=>{throw Error('对象存储暂不可用')}});await flush();await p.onChooseAvatar()
 assert.equal(p.data.form.avatarUrl,person.avatarUrl);assert.equal(p.data.avatarPreview,'');assert.equal(p.data.uploadingAvatar,false);assert.match(state.toasts.at(-1).title,/对象存储/)
 await p.onSave();assert.equal(Object.hasOwn(state.calls.find(c=>c.key==='updateProfile').args[0],'avatarUrl'),false);p.onUnload()
 const invalid=harness({upload:async()=>({fileUrl:'wxfile://local.jpg'})});await flush();await invalid.p.onChooseAvatar();assert.equal(invalid.p.data.form.avatarUrl,person.avatarUrl);invalid.p.onUnload()
})
test('换账号或页面销毁后迟到头像不能回填，后续资料保存和导航也隔离',async()=>{
 const slow=deferred(),{p,state}=harness({upload:()=>slow.promise});await flush();const task=p.onChooseAvatar();await flush()
 const option=state.calls.find(c=>c.key==='upload').args[2];assert.equal(option.isCurrent(),true)
 state.token='two';assert.equal(option.isCurrent(),false);p.onShow();await flush()
 slow.resolve({fileUrl:'https://example.invalid/old-user-upload.png'});await task;assert.notEqual(p.data.form.avatarUrl,'https://example.invalid/old-user-upload.png')
 const another=deferred(),gone=harness({upload:()=>another.promise});await flush();const pending=gone.p.onChooseAvatar();await flush();gone.p.onUnload();another.resolve({fileUrl:'https://example.invalid/leaked.png'});await pending;assert.notEqual(gone.p.data.form.avatarUrl,'https://example.invalid/leaked.png');p.onUnload()
})
test('初始资料迟到不会覆盖已编辑昵称或刚上传头像',async()=>{
 const load=deferred(),{p}=harness({fetchMe:()=>load.promise})
 p.onField({currentTarget:{dataset:{key:'nickname'}},detail:{value:'新的昵称'}});await p.onChooseAvatar()
 load.resolve({...person,nickname:'服务器原昵称'});await flush();assert.equal(p.data.form.nickname,'新的昵称');assert.equal(p.data.form.avatarUrl,'https://example.invalid/registered.png');p.onUnload()
})
test('头像上传链路在账号改变后停止登记，不能用新账号登记旧文件',async()=>{
 let current=true;const calls=[],put=deferred(),mod={exports:{}}
 const bytes=new Uint8Array([0xff,0xd8,0xff,1]).buffer
 const wx={getFileSystemManager:()=>({readFile:o=>o.success({data:bytes})}),request:o=>{calls.push('put');put.promise.then(()=>o.success({statusCode:200}))}}
 const api={createMediaUploadCredential:async()=>{calls.push('credential');return{uploadUrl:'https://example.invalid/signed',storageKey:'old-key'}},registerMediaFile:async()=>{calls.push('register');return{}}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/media.js'),'utf8'),{module:mod,require:()=>api,wx,Uint8Array})
 const task=mod.exports.uploadMediaFile(1,'local-avatar.jpg',{isCurrent:()=>current});await flush();assert.deepEqual(calls,['credential','put']);current=false;put.resolve()
 await assert.rejects(task,/账号或页面已变化/);assert.equal(calls.includes('register'),false)
})
