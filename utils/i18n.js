const catalog = require('./locales/en')
const content = require('./content-localization')
const KEY = 'appLocale'
const instances = new Set()
let installed = false
let nativeNavigationBarTitle
function getLocale() {
  try { return wx.getStorageSync(KEY) === 'en' ? 'en' : 'zh-CN' } catch (_) { return 'zh-CN' }
}
function t(value, locale) { return catalog.t(value, locale || getLocale()) }
function sync(instance) {
  if (!instance || typeof instance.setData !== 'function') return
  const locale = getLocale()
  if (!instance.data || instance.data.locale !== locale) instance.setData({ locale })
}
function titleFor(page) {
  const route=String(page.route||'').replace(/^\//,'')
  const title=page._i18nTitle || catalog.titles[route]
  const setTitle=nativeNavigationBarTitle || wx.setNavigationBarTitle
  if(title&&typeof setTitle==='function')setTitle.call(wx,{title:page._i18nTitle&&rawTitle(route)?content.title(page,title,getLocale()):t(title)})
}
function rawTitle(route){return route==='pages/messages/messages'||route==='pages/news-detail/news-detail'}
function setLocale(locale) {
  const next=locale==='en'?'en':'zh-CN'
  wx.setStorageSync(KEY,next)
  for(const instance of instances)sync(instance)
  try{const pages=getCurrentPages();for(const page of pages)sync(page);if(pages.length)titleFor(pages[pages.length-1])}catch(_){}
  return next
}
function wrapPage(original) {
  return function(options){
    const lifecycle={}
    for(const name of ['onLoad','onShow','onHide','onUnload'])lifecycle[name]=options[name]
    return original({...options,data:{...(options.data||{}),locale:getLocale()},
      onLoad(...args){instances.add(this);content.attach(this,titleFor);sync(this);return lifecycle.onLoad&&lifecycle.onLoad.apply(this,args)},
      onShow(...args){instances.add(this);content.attach(this,titleFor);sync(this);content.start(this);titleFor(this);return lifecycle.onShow&&lifecycle.onShow.apply(this,args)},
      onHide(...args){content.stop(this);return lifecycle.onHide&&lifecycle.onHide.apply(this,args)},
      onUnload(...args){content.stop(this);instances.delete(this);return lifecycle.onUnload&&lifecycle.onUnload.apply(this,args)},
      retryContentTranslations(){content.retry(this)}
    })
  }
}
function wrapComponent(original) {
  return function(options){
    const lives=options.lifetimes||{},pageLives=options.pageLifetimes||{}
    const attached=lives.attached||options.attached,detached=lives.detached||options.detached,show=pageLives.show
    return original({...options,data:{...(options.data||{}),locale:getLocale()},
      lifetimes:{...lives,attached(...args){instances.add(this);sync(this);return attached&&attached.apply(this,args)},detached(...args){instances.delete(this);return detached&&detached.apply(this,args)}},
      pageLifetimes:{...pageLives,show(...args){sync(this);return show&&show.apply(this,args)}}
    })
  }
}
function install() {
  if(installed)return
  installed=true
  // Keep canonical titles; apply separate translations only when an exact source matches.
  if(typeof wx.setNavigationBarTitle==='function'){
    nativeNavigationBarTitle=wx.setNavigationBarTitle
    wx.setNavigationBarTitle=function(options){
      if(!options)return nativeNavigationBarTitle.call(wx,options)
      let page
      try{const pages=getCurrentPages();page=pages[pages.length-1]}catch(_){}
      if(page)page._i18nTitle=options.title
      const route=String(page&&page.route||'').replace(/^\//,'')
      return nativeNavigationBarTitle.call(wx,{...options,title:rawTitle(route)&&page?content.title(page,options.title,getLocale()):t(options.title)})
    }
  }
  for(const method of ['showToast','showLoading','showModal','showActionSheet']){
    if(typeof wx[method]!=='function')continue
    const original=wx[method]
    wx[method]=function(options){
      if(!options)return original.call(wx,options)
      const next={...options}
      for(const key of ['title','content','confirmText','cancelText'])if(typeof next[key]==='string')next[key]=t(next[key])
      if(Array.isArray(next.itemList))next.itemList=next.itemList.map(item=>t(item))
      return original.call(wx,next)
    }
  }
}
module.exports={getLocale,setLocale,t,wrapPage,wrapComponent,install}
