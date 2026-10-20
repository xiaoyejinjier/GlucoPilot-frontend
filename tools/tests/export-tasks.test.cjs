const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
function harness(options={}){
  let definition;const state={token:'one',calls:[],toasts:[],opened:[]},request={getToken:()=>state.token}
  const wx={getWindowInfo:()=>({windowWidth:390}),showToast:v=>state.toasts.push(v),openDocument:v=>state.opened.push(v),navigateBack(){},setClipboardData(){}}
  const social={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/community.js'),'utf8'),{module:social,wx,getApp:()=>({}),require:()=>request})
  const defaults={fetchExportTasks:async()=>({records:[{id:'7',status:'done',glucoseCount:0,mealCount:0}],pages:1}),createExportTask:async payload=>({...payload,id:'7'}),generateExportTask:async()=>({id:'7',status:'done',startDate:'2026-10-01',endDate:'2026-10-07',glucoseCount:0,mealCount:0}),...options}
  const api=Object.fromEntries(Object.entries(defaults).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
  const dependencies={'../../services/api':api,'../../utils/community':social.exports,'../../utils/display':{applyDisplayToCurrentPage(){}},'../../utils/request':request,'../../utils/export-download':{downloadExport:async id=>{state.calls.push({key:'download',args:[id]});return 'real-export.xlsx'}}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/export-data/export-data.js'),'utf8'),{Page:value=>definition=value,wx,getApp:()=>({checkLogin:()=>!!state.token}),require:key=>{assert.ok(dependencies[key],key);return dependencies[key]},setTimeout,clearTimeout})
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.assign(this.data,patch)}};page.onLoad();page.onShow();return{page,state}
}
test('导出调用真实任务创建和生成，空数据保持0，不制造示例记录，下载使用对应任务',async()=>{
  const {page:p,state}=harness();await flush();await p.onConfirm()
  assert.equal(state.calls.filter(c=>c.key==='createExportTask').length,1);assert.equal(state.calls.filter(c=>c.key==='generateExportTask').length,1);assert.equal(p.data.previewCount,0);assert.match(p.data.exportText,/血糖记录 0 条/);assert.doesNotMatch(p.data.exportText,/示例|5\.8/)
  const payload=state.calls.find(c=>c.key==='createExportTask').args[0];assert.ok(payload.startDate<=payload.endDate);assert.match(payload.clientRequestId,/^[A-Za-z0-9_-]{8,64}$/)
  await p.onDownload({currentTarget:{dataset:{id:'7'}}});assert.equal(state.opened[0].fileType,'xlsx');assert.equal(state.opened[0].filePath,'real-export.xlsx');p.onUnload()
})
test('导出失败保留请求标识重试，账号变化不显示迟到的记录摘要',async()=>{
  let attempts=0;const {page:p,state}=harness({generateExportTask:async()=>{if(!attempts++)throw new Error('offline');return{id:'7',status:'done',startDate:'2026-10-01',endDate:'2026-10-07',glucoseCount:1,mealCount:2}}})
  await p.onConfirm();assert.equal(p.data.exportText,'');await p.onConfirm();const creates=state.calls.filter(c=>c.key==='createExportTask');assert.equal(creates[0].args[0].clientRequestId,creates[1].args[0].clientRequestId)
  p.onHide();state.token='two';p.onShow();assert.equal(p.data.exportText,'');p.onUnload()
})
test('XLSX下载携带当前身份，旧账号回调不保留或打开文件',async()=>{
  let result,token='one';const removed=[],module={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/export-download.js'),'utf8'),{module,wx:{downloadFile:options=>{result=options},getFileSystemManager:()=>({unlink:v=>removed.push(v.filePath)})},require:key=>key==='./config'?{baseUrl:'https://example.test/api/v1'}:{getToken:()=>token}})
  const task=module.exports.downloadExport('7');assert.equal(result.header.Authorization,'Bearer one');assert.match(result.url,/data-export-tasks\/7\/file$/);token='two';result.success({statusCode:200,tempFilePath:'private-old.xlsx'});await assert.rejects(task);assert.deepEqual(removed,['private-old.xlsx'])
})
