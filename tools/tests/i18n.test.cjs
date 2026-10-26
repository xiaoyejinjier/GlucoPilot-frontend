const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),catalog=require('../../utils/locales/en')
function runtime(initial='zh-CN'){
  const storage=new Map([['appLocale',initial]]),calls=[],pages=[]
  const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),setNavigationBarTitle:o=>calls.push(['title',o])}
  for(const method of ['showToast','showModal','showLoading','showActionSheet'])wx[method]=o=>calls.push([method,o])
  const module={exports:{}}
  const content={attach(){},start(){},stop(){},retry(){},title:(_page,raw)=>raw}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/i18n.js'),'utf8'),{module,require:name=>name==='./content-localization'?content:catalog,wx,getCurrentPages:()=>pages})
  return{i18n:module.exports,wx,storage,calls,pages}
}
function instance(definition){return{...definition,data:structuredClone(definition.data),updates:0,setData(data){this.updates++;Object.assign(this.data,data)}}}
test('中英文切换持久保存，缓存页面和组件同步，卸载后不再更新，业务数据不变',()=>{
  const {i18n,storage,pages}=runtime(),seen=[]
  let pageDef,componentDef
  i18n.wrapPage(d=>pageDef=d)({data:{title:'我的真实标题',body:'公开',visibility:'FRIENDS'},onLoad(arg){seen.push(arg)},onUnload(){seen.push('unload')}})
  i18n.wrapComponent(d=>componentDef=d)({data:{input:'早餐'},lifetimes:{attached(){seen.push('attach')},detached(){seen.push('detach')}},pageLifetimes:{show(){seen.push('show')}}})
  const page=instance(pageDef),component=instance(componentDef)
  page.route='pages/settings/settings';pages.push(page)
  page.onLoad('options');component.lifetimes.attached.call(component)
  i18n.setLocale('en')
  assert.equal(page.data.locale,'en');assert.equal(component.data.locale,'en');assert.equal(storage.get('appLocale'),'en')
  assert.equal(page.data.body,'公开');assert.equal(page.data.visibility,'FRIENDS');assert.equal(component.data.input,'早餐')
  const count=component.updates;component.lifetimes.detached.call(component);page.onUnload();pages.pop()
  i18n.setLocale('zh-CN');assert.equal(component.updates,count);assert.equal(page.data.locale,'en')
  assert.deepEqual(seen,['options','attach','detach','unload'])
  assert.equal(runtime(storage.get('appLocale')).i18n.getLocale(),'zh-CN')
  assert.equal(runtime('en').i18n.getLocale(),'en')
})
test('原生提示跟随语言，动作索引、回调、输入默认值和原参数保持原值',()=>{
  const {i18n,wx,calls}=runtime('en');i18n.install();i18n.install()
  const success=()=>{},options={title:'退出登录',content:'确定要退出当前账号吗？',confirmText:'确定',cancelText:'取消',placeholderText:'用户原文',success}
  wx.showModal(options);assert.equal(calls[0][1].title,'Log out');assert.equal(calls[0][1].confirmText,'Confirm')
  assert.equal(calls[0][1].success,success);assert.equal(calls[0][1].placeholderText,'用户原文');assert.equal(options.title,'退出登录')
  const items=['举报','减少此类内容'];wx.showActionSheet({itemList:items,success})
  assert.deepEqual(Array.from(calls[1][1].itemList),['Report','Show less like this']);assert.deepEqual(items,['举报','减少此类内容'])
  i18n.setLocale('zh-CN');wx.showToast({title:'保存成功'});assert.equal(calls.at(-1)[1].title,'保存成功')
})
test('页面恢复同步原生标题，保留原生命周期、返回值和异常',()=>{
  const {i18n,calls}=runtime('en');let definition
  i18n.wrapPage(d=>definition=d)({data:{},onShow(){return 42}})
  const page=instance(definition);page.route='pages/devices/devices'
  assert.equal(page.onShow(),42);assert.equal(calls[0][1].title,'Devices')
})
test('动态标题切换语言或从缓存返回不丢失，文章名和对方昵称保留原文',()=>{
  const {i18n,wx,calls,pages}=runtime('en');i18n.install()
  let definition;i18n.wrapPage(d=>definition=d)({data:{}})
  const page=instance(definition);page.route='pages/community/community';pages.push(page)
  wx.setNavigationBarTitle({title:'我的收藏'});assert.equal(calls.at(-1)[1].title,'Saved')
  page.onShow();assert.equal(calls.at(-1)[1].title,'Saved')
  i18n.setLocale('zh-CN');assert.equal(calls.at(-1)[1].title,'我的收藏')
  page.route='pages/messages/messages';wx.setNavigationBarTitle({title:'我的收藏'});i18n.setLocale('en');page.onShow()
  assert.equal(calls.at(-1)[1].title,'我的收藏')
  page.route='pages/news-detail/news-detail';wx.setNavigationBarTitle({title:'记录'});page.onShow();assert.equal(calls.at(-1)[1].title,'记录')
})
test('JS和WXS同源，所有内置文案中英文一致，日期计数和复合状态没有中文残留',()=>{
  const generated=require('../build-i18n.cjs').build()
  for(const [file,content] of Object.entries(generated))assert.equal(fs.readFileSync(path.join(root,file),'utf8'),content,file)
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/i18n.wxs'),'utf8'),{module,getRegExp:RegExp})
  for(const [zh,en] of Object.entries(catalog.messages)){
    assert.equal(catalog.t(zh,'zh-CN'),zh)
    assert.equal(catalog.t(zh,'en'),en)
    assert.equal(module.exports.t(zh,'en'),en)
  }
  const examples=['3天前','2026 年 10 月','2026年10月指标','2026年10月22日','5 次浏览','已选 3 / 50 位好友','控糖科普 · 图文 · 3天前 · 5次浏览','已保存 · 血糖 6 条 / 饮食 3 条','当前：字号 标准 · 主题 经典蓝','SN：ABC-100','当前节点：早餐前','# 饮食控糖','第 2 版','这条文章有什么问题？','文章举报 · #3','正在录音… 5s / 60s']
  for(const example of examples){assert.doesNotMatch(catalog.t(example,'en'),/[一-龥]/,example);assert.equal(module.exports.t(example,'en'),catalog.t(example,'en'))}
  assert.equal(catalog.t(0,'en'),0);assert.equal(catalog.t(null,'en'),null)
  assert.equal(catalog.tag({code:'diet',name:'饮食控糖'},'en'),'Food & glucose')
  assert.equal(catalog.tag({code:'custom-1',name:'饮食控糖'},'en'),'饮食控糖')
  const options=['1型糖尿病','2型糖尿病','其他']
  assert.deepEqual(catalog.list(options,'en'),['Type 1 diabetes','Type 2 diabetes','Other']);assert.equal(options[0],'1型糖尿病')
  for(const title of Object.values(catalog.titles))assert.doesNotMatch(catalog.t(title,'en'),/[一-龥]/)
})
test('文章读取独立译文，评论私信和输入保留原文，欢迎模板显式传语言',()=>{
  const read=name=>fs.readFileSync(path.join(root,'pages',name,name+'.wxml'),'utf8')
  assert.ok(read('news-detail').includes("'ARTICLE_PREVIEW', news.id, 'title', news.title, locale"));assert.ok(read('news-detail').includes("'ARTICLE_BODY', news.id, 'body', news.contentBody, locale"))
  assert.ok(read('news-detail').includes('wx:if="{{news.contentHtml}}"'));assert.ok(read('news-detail').includes('wx:elif="{{news.contentBody}}"'))
  assert.ok(read('messages').includes('{{item.content}}'));assert.ok(read('voice').includes('{{item.content}}'))
  assert.ok(read('community-compose').includes('value="{{body}}"'));assert.ok(read('community-compose').includes('# {{item}}'))
  assert.ok(read('community-reports').includes('{{item.resolutionNote}}'))
  assert.equal((read('voice').match(/locale: locale/g)||[]).length,2)
})
test('设置语言立即切换并保留其他入口，非法值和重复点击不会重复保存',()=>{
  const env=runtime();let definition,toasts=0
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/settings/settings.js'),'utf8'),{Page:d=>definition=d,wx:{showToast(){toasts++}},require:name=>name.endsWith('/i18n')?env.i18n:{applyDisplayToCurrentPage(){}}})
  const page=instance(definition);page.onLanguage({currentTarget:{dataset:{locale:'en'}}});assert.equal(page.data.locale,'en');assert.equal(toasts,1)
  page.onLanguage({currentTarget:{dataset:{locale:'en'}}});page.onLanguage({currentTarget:{dataset:{locale:'invalid'}}});assert.equal(toasts,1)
})
test('英文小语示例填写对应英文问题，等待用户发送；手动输入仍保留原文',()=>{
  let definition,sends=0
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/voice/voice.js'),'utf8'),{
    Page:d=>definition=d,getApp:()=>({}),require:name=>name.endsWith('/locales/en')?catalog:{}
  })
  const page=instance(definition);page.data.locale='en';page.onSend=()=>sends++
  page.onSuggestionTap({currentTarget:{dataset:{index:0}}})
  assert.equal(page.data.inputValue,'What does a fasting glucose of 5.2 mean?');assert.equal(sends,0)
  page.onInput({detail:{value:'我的原始问题 ** 5.2'}});assert.equal(page.data.inputValue,'我的原始问题 ** 5.2')
})
test('所有页面接入语言模板，内置静态展示文案都有英文，不把中文硬编码留在页面上',()=>{
  function walk(folder){for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){
    const rel=folder+'/'+entry.name
    if(entry.isDirectory()){walk(rel);continue}
    if(!rel.endsWith('.wxml')||rel.includes('/chat-markdown/'))continue
    const text=fs.readFileSync(path.join(root,rel),'utf8')
    if(/i18n\.(t|tag|list)\(/.test(text))assert.match(text,/<wxs module="i18n" src="\/utils\/i18n\.wxs"/,rel)
    for(const match of text.matchAll(/i18n\.t\(\(?(['"])([^'"\n]*[一-龥][^'"\n]*)\1/g))assert.doesNotMatch(catalog.t(match[2],'en'),/[一-龥]/,rel+': '+match[2])
    const literal=text.replace(/{{[\s\S]*?}}/g,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/简体中文/g,'')
    assert.doesNotMatch(literal,/[一-龥]/,rel)
  }}
  for(const folder of ['pages','components','custom-tab-bar'])walk(folder)
})
