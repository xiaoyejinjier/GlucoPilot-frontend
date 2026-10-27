const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
test('点赞与收藏列表均带登录鉴权并映射真实文章，拒绝未知列表类型',async()=>{
  const calls=[],module={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../services/api.js'),'utf8'),{module,require:name=>{
    if(name==='../utils/request')return {get:async(...args)=>{calls.push(args);return{records:[{id:'19',title:'科学控糖',coverUrl:'/api/v1/cms/images/10',channelCode:4}],pages:'1',total:'1'}}}
    if(name==='../utils/config')return{baseUrl:'https://api.example/api/v1'}
    return {}
  }})
  for(const mode of ['likes','collections']){
    const page=await module.exports.fetchCommunityList(mode,{pageNum:1,pageSize:20,keyword:'控糖'})
    assert.equal(calls.at(-1)[0],'/community/'+mode);assert.equal(calls.at(-1)[1].keyword,'控糖');assert.equal(calls.at(-1)[2].auth,true)
    assert.equal(page.records[0].id,'19');assert.equal(page.records[0].cover,'https://api.example/api/v1/cms/images/10');assert.equal(page.records[0].channel,'控糖科普')
  }
  await assert.rejects(module.exports.fetchCommunityList('invalid',{}));assert.equal(calls.length,2)
})
