const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}

/** 封禁提示页：客服邮箱/电话逐行复制与关闭退出。 */
function harness(options={}){
  const state={clipboard:[],toasts:[],navs:[],reset:0,cleared:0,logout:0}
  const deps={
    '../../utils/config':{supportContact:options.contact!==undefined?options.contact:{email:'support@example.com',phone:'400-000-0000'}},
    '../../services/api':{logoutRemote:async()=>{state.logout++}},
    '../../utils/storage':{clearAccountCache(){state.cleared++}},
    '../../utils/display':{applyDisplayToCurrentPage(){}},
    '../../utils/i18n':{getLocale:()=> 'zh',t:v=>v}
  }
  const wx={
    setClipboardData:o=>{state.clipboard.push(o.data);if(o.success)o.success()},
    showToast:o=>state.toasts.push(o.title),
    reLaunch:o=>state.navs.push(o.url)
  }
  const app={resetLoginState(){state.reset++}}
  let def
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/account-disabled/account-disabled.js'),'utf8'),{
    Page:x=>def=x,getApp:()=>app,wx,require:k=>{assert.ok(deps[k],k);return deps[k]}
  })
  const p={...def,data:JSON.parse(JSON.stringify(def.data))}
  p.setData=function(v){Object.assign(this.data,v)}
  p.onShow()
  return {p,state}
}

test('封禁提示页：展示客服邮箱与电话，逐行复制并提示复制结果',()=>{
  const {p,state}=harness()
  assert.equal(p.data.emailText,'support@example.com')
  assert.equal(p.data.phoneText,'400-000-0000')

  p.onCopy({currentTarget:{dataset:{type:'email'}}})
  assert.deepEqual(state.clipboard,['support@example.com'])
  assert.equal(state.toasts.at(-1),'邮箱复制成功')

  p.onCopy({currentTarget:{dataset:{type:'phone'}}})
  assert.deepEqual(state.clipboard,['support@example.com','400-000-0000'])
  assert.equal(state.toasts.at(-1),'电话复制成功')
})

test('封禁提示页：未配置联系方式时展示占位且不复制',()=>{
  const {p,state}=harness({contact:{email:'',phone:''}})
  assert.equal(p.data.email,'')
  assert.equal(p.data.phone,'')
  assert.equal(p.data.emailText,'—')
  assert.equal(p.data.phoneText,'—')
  p.onCopy({currentTarget:{dataset:{type:'email'}}})
  assert.equal(state.clipboard.length,0)
  assert.equal(state.toasts.length,0)
})

test('封禁提示页：关闭后撤销会话、清账号缓存并回登录页',async()=>{
  const {p,state}=harness()
  p.onClose()
  await flush()
  assert.equal(state.logout,1)
  assert.equal(state.reset,1)
  assert.equal(state.cleared,1)
  assert.equal(state.navs[0],'/pages/login/login')
})
