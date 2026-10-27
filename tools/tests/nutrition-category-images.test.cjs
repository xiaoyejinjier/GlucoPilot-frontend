const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function page(){
  const config={baseUrl:'https://api.example.test/api/v1',fallbackLocal:false},images={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/food-images.js'),'utf8'),{module:images,require:()=>config})
  const requests=[],foodRequests=[],state={stopped:0,updates:0,toasts:[]};let definition
  const dependencies={
    '../../utils/constants':{FOOD_CATEGORIES:['主食类','坚果类']},'../../utils/food-db':{},'../../utils/display':{applyDisplayToCurrentPage(){}},
    '../../services/api':{fetchFoodCategories:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),fetchFoods:params=>new Promise((resolve,reject)=>foodRequests.push({params,resolve,reject}))},'../../utils/config':config,'../../utils/food-images':images.exports
  }
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/nutrition/nutrition.js'),'utf8'),{Page:value=>definition=value,wx:{stopPullDownRefresh:()=>state.stopped++,showToast:value=>state.toasts.push(value)},require:name=>{assert.ok(dependencies[name],name);return dependencies[name]}})
  const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){state.updates++;for(const [key,value] of Object.entries(patch)){const nested=key.match(/^categories\[(\d+)\]\.icon$/);if(nested)this.data.categories[Number(nested[1])].icon=value;else this.data[key]=value}}}
  return {p,requests,foodRequests,state,config,images:images.exports}
}
const category=(imageUrl,id='4',categoryName='水果类')=>({id,categoryName,imageUrl,sortNo:4})

test('分类优先读取管理端保存的共享配图，下拉重新获取新图而不是固定内置图',async()=>{
  const {p,requests,state}=page();p.onShow();requests[0].resolve([category('/api/v1/foods/images/14')]);await Promise.resolve();await Promise.resolve()
  assert.equal(p.data.categories[0].icon,'https://api.example.test/api/v1/foods/images/14');assert.equal(p.data.categories[0].id,'4')
  const refresh=p.onPullDownRefresh();requests[1].resolve([category('/api/v1/foods/images/21')]);await refresh
  assert.equal(p.data.categories[0].icon,'https://api.example.test/api/v1/foods/images/21');assert.equal(state.stopped,1)
})
test('管理端选择的内置图、完整地址与旧地址正确映射，空图沿用同款默认图',()=>{
  const {images}=page()
  assert.equal(images.getFoodImage('','水果类','/images/foods/banana.svg'),'/assets/foods/banana.svg')
  assert.equal(images.getFoodImage('','水果类','/img/food-banana.svg'),'/assets/foods/banana.svg')
  assert.equal(images.getFoodImage('','主食类','/img/food-bun.svg'),'/assets/foods/steamed-bun.svg')
  assert.equal(images.getFoodImage('','水果类','https://cdn.example.test/grape.jpg'),'https://cdn.example.test/grape.jpg')
  assert.equal(images.getFoodImage('','坚果类',''),'/assets/foods/almond.svg')
})
test('旧请求和旧图片错误不能覆盖管理员刚换的新图，真正加载失败才回落',async()=>{
  const {p,requests,state}=page();const old=p.loadCategories(),latest=p.loadCategories()
  requests[1].resolve([category('/api/v1/foods/images/21')]);await latest
  requests[0].resolve([category('/api/v1/foods/images/14')]);await old
  const current=p.data.categories[0].icon;p.onCategoryImageError({currentTarget:{dataset:{id:'4',src:'https://api.example.test/api/v1/foods/images/14'}}});assert.equal(p.data.categories[0].icon,current)
  p.onCategoryImageError({currentTarget:{dataset:{id:'4',src:current}}});assert.equal(p.data.categories[0].icon,'/assets/foods/apple.svg')
  const updates=state.updates;p.onCategoryImageError({currentTarget:{dataset:{id:'4',src:'/assets/foods/apple.svg'}}});assert.equal(state.updates,updates)
})
test('分类清空同步移除旧项，刷新失败结束动画，离开页面丢弃迟到数据',async()=>{
  const {p,requests,state}=page();const first=p.loadCategories();requests[0].resolve([]);await first;assert.equal(p.data.categories.length,0)
  const refresh=p.onPullDownRefresh();requests[1].reject(new Error('offline'));await refresh;assert.equal(state.stopped,1)
  const late=p.loadCategories();p.onHide();requests[2].resolve([category('/api/v1/foods/images/14')]);await late;assert.equal(p.data.categories.length,0)
})

test('在模块已加载后切换真机服务器，分类和食品图片使用当前地址',()=>{
  const {images,config}=page()
  assert.equal(images.getFoodImage('','水果类','/api/v1/foods/images/39'),'https://api.example.test/api/v1/foods/images/39')
  config.baseUrl='https://phone.example.test/gateway/api/v1/'
  assert.equal(images.getFoodImage('','水果类','/api/v1/foods/images/39'),'https://phone.example.test/gateway/api/v1/foods/images/39')
  assert.equal(images.getFoodImage('小笼包','主食类','/api/v1/foods/26/image'),'https://phone.example.test/gateway/api/v1/foods/26/image')
})

test('食品搜索空结果不伪造本地食品，旧查询不能覆盖刚更新的照片',async()=>{
  const {p,foodRequests,state}=page()
  const old=p.query({keyword:'米饭'}),newer=p.query({keyword:'小笼包'})
  foodRequests[1].resolve({records:[{id:'26',image:'new-photo'}]});await newer
  foodRequests[0].resolve({records:[{id:'1',image:'old-photo'}]});await old
  assert.equal(p.data.searchResults[0].id,'26')
  p.onImageError({currentTarget:{dataset:{index:0,src:'old-photo'}}});assert.equal(p.data.searchResults[0].image,'new-photo')
  const empty=p.query({keyword:'不存在'});foodRequests[2].resolve({records:[]});await empty
  assert.equal(p.data.searchResults.length,0)
  const error=p.query({keyword:'小笼包'});foodRequests[3].reject(new Error('offline'));await error
  assert.equal(p.data.searchResults.length,0);assert.equal(state.toasts.length,1)
})

test('下拉及重新进入会同时刷新当前食品，离页与清空搜索丢弃迟到结果',async()=>{
  const {p,requests,foodRequests,state}=page()
  p.data.categoryMeta=[category('/api/v1/foods/images/39')]
  p.onCategoryTap({currentTarget:{dataset:{cat:'水果类'}}})
  foodRequests[0].resolve({records:[{id:'23',image:'old'}]});await Promise.resolve();await Promise.resolve()
  const refresh=p.onPullDownRefresh();requests[0].resolve([category('/api/v1/foods/images/40')]);await Promise.resolve();await Promise.resolve()
  assert.equal(foodRequests[1].params.categoryId,'4')
  foodRequests[1].resolve({records:[{id:'23',image:'new'}]});await refresh
  assert.equal(p.data.searchResults[0].image,'new');assert.equal(state.stopped,1)
  const late=p.query({keyword:'水果'});p.onSearch({detail:{value:''}});foodRequests[2].resolve({records:[{id:'bad'}]});await late
  assert.equal(p.data.searchResults.length,0)
  const hidden=p.query({keyword:'水果'});p.onHide();foodRequests[3].resolve({records:[{id:'bad'}]});await hidden
  assert.equal(p.data.searchResults.length,0)
})

test('独立分类列表每次进入与下拉读取新图，隐藏、旧错误与空结果不恢复示例',async()=>{
  const cats=[],foods=[],state={stopped:0,toasts:0};let definition
  const deps={
    '../../utils/display':{applyDisplayToCurrentPage(){}},
    '../../utils/food-images':{DEFAULT_FOOD_IMAGE:'/fallback.svg'},
    '../../services/api':{
      fetchFoodCategories:()=>new Promise((resolve,reject)=>cats.push({resolve,reject})),
      fetchFoods:()=>new Promise((resolve,reject)=>foods.push({resolve,reject}))
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/nutrition-list/nutrition-list.js'),'utf8'),{
    Page:value=>definition=value,require:name=>{assert.ok(deps[name],name);return deps[name]},
    wx:{setNavigationBarTitle(){},stopPullDownRefresh(){state.stopped++},showToast(){state.toasts++}}
  })
  const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.assign(this.data,patch)}}
  p.onLoad({category:encodeURIComponent('水果类')})
  const first=p.onShow();cats[0].resolve([category('/api/v1/foods/images/39')]);await Promise.resolve();await Promise.resolve()
  foods[0].resolve({records:[{id:'23',image:'first'}]});await first;assert.equal(p.data.list[0].image,'first')
  const refresh=p.onPullDownRefresh();cats[1].resolve([category('/api/v1/foods/images/40')]);await Promise.resolve();await Promise.resolve()
  foods[1].resolve({records:[{id:'23',image:'latest'}]});await refresh
  assert.equal(state.stopped,1);assert.equal(p.data.list[0].image,'latest')
  p.onImageError({currentTarget:{dataset:{index:0,src:'first'}}});assert.equal(p.data.list[0].image,'latest')
  const empty=p.onShow();cats[2].resolve([category('')]);await Promise.resolve();await Promise.resolve()
  foods[2].resolve({records:[]});await empty;assert.equal(p.data.list.length,0)
  const hidden=p.onShow();p.onHide();cats[3].resolve([category('')]);await hidden
  assert.equal(foods.length,3)
  const missing=p.onShow();cats[4].resolve([]);await missing;assert.equal(p.data.list.length,0)
  const failed=p.onShow();cats[5].reject(new Error('offline'));await failed
  assert.equal(p.data.list.length,0);assert.equal(state.toasts,1)
})
