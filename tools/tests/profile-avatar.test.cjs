const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const person={communityKey:'u1',nickname:'糖友',avatarUrl:'https://example.invalid/old.png',avatarText:'糖',diabetesType:'2型糖尿病',age:30,height:170,weight:65,targetFasting:6,targetPostprandial:8}
function harness(overrides={}) {
 const state={token:'one',calls:[],toasts:[],saved:[],timers:[],navs:[]}
 const wx={chooseMedia:o=>o.success({tempFiles:[{tempFilePath:'wxfile://new-avatar.jpg',size:100}]}),showToast:o=>state.toasts.push(o),navigateBack:()=>state.navs.push('back'),navigateTo:o=>{state.navs.push(o);if(o.complete)o.complete()}}
 const api={fetchMe:async()=>({...person}),updateProfile:async()=>({updated:true}),saveHealthProfile:async()=>({updated:true}),...overrides}
 const calls=Object.fromEntries(Object.entries(api).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
 const media={BIZ_TYPE:{AVATAR:1},MAX_IMAGE_BYTES:5242880,uploadMediaFile:async(...args)=>{state.calls.push({key:'upload',args});return overrides.upload?overrides.upload(...args):{id:'101',fileUrl:'https://example.invalid/registered.png'}}}
 const deps={'../../utils/profile-medications':require('../../utils/profile-medications'),'../../services/api':calls,'../../utils/storage':{getUserInfo:()=>({...person}),saveUserInfo:me=>state.saved.push(me)},'../../utils/display':{applyDisplayToCurrentPage(){}},'../../utils/media':media,'../../utils/request':{getToken:()=>state.token},'../../utils/mappers':{DIABETES_TYPE_TEXT:['未填写','1型糖尿病','2型糖尿病'],diabetesCode:value=>value==='2型糖尿病'?2:0}}
 let def;vm.runInNewContext(fs.readFileSync(path.join(root,'pages/profile-edit/profile-edit.js'),'utf8'),{Page:x=>def=x,wx,require:key=>{assert.ok(deps[key],key);return deps[key]},setTimeout:fn=>{state.timers.push(fn);return state.timers.length},clearTimeout(){}})
 const p={...def,data:JSON.parse(JSON.stringify(def.data)),setData:patch=>Object.assign(p.data,patch)};p.onLoad();p.onShow()
 return{p,state,wx}
}

test('运动习惯可回填、编辑保存和清空，迟到资料不覆盖已输入内容',async()=>{
 const {p,state}=harness({fetchMe:async()=>({...person,exercise:'每周散步三次'})});await flush()
 assert.equal(p.data.form.exercise,'每周散步三次')
 p.onField({currentTarget:{dataset:{key:'exercise'}},detail:{value:'周末骑行，每次40分钟'}})
 await p.onSave();assert.equal(state.calls.find(call=>call.key==='saveHealthProfile').args[0].exerciseHabit,'周末骑行，每次40分钟')
 p.onField({currentTarget:{dataset:{key:'exercise'}},detail:{value:''}})
 await p.onSave();assert.equal(state.calls.filter(call=>call.key==='saveHealthProfile').at(-1).args[0].exerciseHabit,null)
 p.onUnload()
 const late=deferred(),second=harness({fetchMe:()=>late.promise})
 second.p.onField({currentTarget:{dataset:{key:'exercise'}},detail:{value:'自行填写的运动记录'}})
 late.resolve({...person,exercise:'服务器旧记录'});await flush()
 assert.equal(second.p.data.form.exercise,'自行填写的运动记录');second.p.onUnload()
})

test('其他胰岛素与已选药物、其他用药一并保存，再次回填仍可编辑',async()=>{
 const {p,state}=harness();await flush()
 p.onMedicationTap({currentTarget:{dataset:{name:'二甲双胍'}}})
 p.onOtherMedication();p.onOtherMedicationInput({detail:{value:'原有自填记录'}})
 p.onOtherInsulin()
 await p.onSave();assert.equal(state.calls.some(call=>call.key==='saveHealthProfile'),false)
 assert.match(state.toasts.at(-1).title,/请填写其他胰岛素/)
 p.onOtherInsulinInput({detail:{value:'自填名称甲；自填名称乙'}})
 await p.onSave()
 const medication=state.calls.find(call=>call.key==='saveHealthProfile').args[0].medication
 assert.ok(medication.includes('二甲双胍'));assert.ok(medication.includes('原有自填记录'))
 assert.ok(medication.includes('其他胰岛素：自填名称甲'));assert.ok(medication.includes('其他胰岛素：自填名称乙'))
 p.onUnload()
 const next=harness({fetchMe:async()=>({...person,medication})});await flush()
 assert.equal(next.p.data.otherInsulinEnabled,true)
 assert.equal(next.p.data.otherInsulin,'自填名称甲；自填名称乙')
 assert.equal(next.p.data.otherMedication,'原有自填记录')
 assert.ok(next.p.data.selectedMedications.includes('二甲双胍'))
 next.p.onOtherInsulin();await next.p.onSave()
 const updated=next.state.calls.find(call=>call.key==='saveHealthProfile').args[0].medication
 assert.equal(updated.includes('其他胰岛素：'),false)
 assert.ok(updated.includes('二甲双胍'));assert.ok(updated.includes('原有自填记录'));next.p.onUnload()
})

test('其他胰岛素迟到资料不覆盖手动输入，换账号清除旧用药选项',async()=>{
 const late=deferred(),{p,state}=harness({fetchMe:()=>late.promise})
 p.onOtherInsulin();p.onOtherInsulinInput({detail:{value:'当前输入'}})
 late.resolve({...person,medication:'其他胰岛素：旧记录'});await flush()
 assert.equal(p.data.otherInsulin,'当前输入')
 state.token='two';p.onShow()
 assert.equal(p.data.otherInsulin,'');assert.equal(p.data.otherInsulinEnabled,false)
 assert.equal(p.data.selectedMedications.length,0);p.onUnload()
})

test('其他胰岛素仍受合计256字限制，历史自由文本不推断为胰岛素',async()=>{
 const {p,state}=harness({fetchMe:async()=>({...person,medication:'历史未知药名 每日2次'})});await flush()
 assert.equal(p.data.otherInsulinEnabled,false)
 const original=p.data.form.medication
 p.onOtherInsulin();p.onOtherInsulinInput({detail:{value:'甲'.repeat(256)}})
 assert.equal(p.data.otherInsulin,'')
 assert.equal(p.data.form.medication,original)
 assert.match(state.toasts.at(-1).title,/256/);p.onUnload()
})
test('头像走AVATAR上传登记，阻止提前保存，资料只提交登记返回的地址',async()=>{
 const upload=deferred(),{p,state}=harness({upload:()=>upload.promise});await flush()
 const task=p.onChooseAvatar();await flush();assert.equal(p.data.uploadingAvatar,true);assert.equal(p.data.avatarPreview,'wxfile://new-avatar.jpg')
 await p.onSave();assert.equal(state.calls.filter(c=>c.key==='updateProfile').length,0)
 upload.resolve({id:'101',fileUrl:'https://example.invalid/registered.png'});await task
 assert.equal(p.data.uploadingAvatar,false);assert.equal(p.data.avatarPreview,'');assert.equal(state.calls.find(c=>c.key==='upload').args[0],1)
 await p.onSave();assert.equal(state.calls.find(c=>c.key==='updateProfile').args[0].avatarUrl,'https://example.invalid/registered.png')
 assert.equal(state.calls.find(c=>c.key==='saveHealthProfile').args[0].targetFasting,6);p.onUnload()
})

test('手机号行进入绑定面板，返回只刷新号码且保留未保存资料',async()=>{
 let phone='';const {p,state}=harness({fetchMe:async()=>({...person,phone})});await flush()
 p.onField({currentTarget:{dataset:{key:'nickname'}},detail:{value:'未保存昵称'}})
 p.onBindPhone();assert.match(state.navs[0].url,/account-security.*bind=phone/)
 p.onHide();phone='13800000000';p.onShow();await flush()
 assert.equal(p.data.form.phone,phone);assert.equal(p.data.form.nickname,'未保存昵称');p.onUnload()
})

test('绑定页面仅在显式phone入口自动展开，不自动发送验证码',()=>{
 let page
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/account-security/account-security.js'),'utf8'),{Page:value=>page=value,require:()=>({})})
 const instance={...page,data:{...page.data},setData(values){Object.assign(this.data,values)}}
 instance.onLoad({});assert.equal(instance.data.panel,false)
 instance.onLoad({bind:'phone'});assert.equal(instance.data.panel,true);assert.equal(instance.data.emailPanel,false)
 assert.equal(instance.data.smsCooldown,0);assert.equal(instance.data.newPhone,'')
 const template=fs.readFileSync(path.join(root,'pages/profile-edit/profile-edit.wxml'),'utf8')
 assert.match(template,/class="form-item profile-link" bindtap="onBindPhone"/)
})

test('确诊年月使用日期选择并保存YYYY-MM，未来月份无效且可清空',async()=>{
 const {p,state}=harness();await flush()
 p.onDiagnosisChange({detail:{value:'2021-06'}});assert.equal(p.data.form.confirmDate,'2021-06')
 p.onDiagnosisChange({detail:{value:'2999-01'}});assert.equal(p.data.form.confirmDate,'2021-06')
 await p.onSave();assert.equal(state.calls.find(c=>c.key==='saveHealthProfile').args[0].diagnosedYm,'2021-06')
 p.onClearDiagnosis();assert.equal(p.data.form.confirmDate,'');p.onUnload()
 const template=fs.readFileSync(path.join(root,'pages/profile-edit/profile-edit.wxml'),'utf8')
 assert.match(template,/mode="date" fields="month"/);assert.match(template,/class="calendar-icon"/)
})

test('常见用药多选加其他按原字段保存，切换类型不清空药物',async()=>{
 const {p,state}=harness();await flush()
 const choose=name=>p.onMedicationTap({currentTarget:{dataset:{name}}})
 choose('二甲双胍');choose('甘精胰岛素');p.onOtherMedication();p.onOtherMedicationInput({detail:{value:'自填药物'}})
 p.onDiabetesChange({detail:{value:'1'}})
 await p.onSave();const text=state.calls.find(c=>c.key==='saveHealthProfile').args[0].medication
 assert.ok(text.includes('二甲双胍'));assert.ok(text.includes('甘精胰岛素'));assert.ok(text.includes('自填药物'))
 choose('二甲双胍');assert.ok(!p.data.form.medication.includes('二甲双胍'));p.onUnload()
})

test('旧用药自由文本及剂量不改写，初始请求迟到不覆盖已选药或其他输入状态',async()=>{
 const original='二甲双胍 每日2次；自定义记录',existing=harness({fetchMe:async()=>({...person,medication:original})});await flush()
 assert.equal(existing.p.data.otherMedicationEnabled,true);await existing.p.onSave()
 assert.equal(existing.state.calls.find(c=>c.key==='saveHealthProfile').args[0].medication,original);existing.p.onUnload()
 const slow=deferred(),{p}=harness({fetchMe:()=>slow.promise})
 p.onOtherMedication();slow.resolve({...person,medication:'二甲双胍'});await flush()
 assert.equal(p.data.otherMedicationEnabled,true);assert.equal(p.data.selectedMedications.length,0);p.onUnload()
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
