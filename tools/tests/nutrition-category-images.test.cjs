const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function page(){
  const config={baseUrl:'https://api.example.test/api/v1',fallbackLocal:false},images={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/food-images.js'),'utf8'),{module:images,require:()=>config})
  const requests=[],state={stopped:0,updates:0};let definition
  const dependencies={
    '../../utils/constants':{FOOD_CATEGORIES:['主食类','坚果类']},'../../utils/food-db':{},'../../utils/display':{applyDisplayToCurrentPage(){}},
    '../../services/api':{fetchFoodCategories:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))},'../../utils/config':config,'../../utils/food-images':images.exports
  }
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/nutrition/nutrition.js'),'utf8'),{Page:value=>definition=value,wx:{stopPullDownRefresh:()=>state.stopped++},require:name=>{assert.ok(dependencies[name],name);return dependencies[name]}})
  const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){state.updates++;for(const [key,value] of Object.entries(patch)){const nested=key.match(/^categories\[(\d+)\]\.icon$/);if(nested)this.data.categories[Number(nested[1])].icon=value;else this.data[key]=value}}}
  return {p,requests,state,images:images.exports}
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
