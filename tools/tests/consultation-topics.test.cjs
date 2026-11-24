const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
test('常用标签按用户和API环境隔离，空选择有效，失效编码自动过滤',()=>{
 const storage=new Map(),config={baseUrl:'environment-a'};let user={communityKey:'u1'}
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../utils/consultation-topics.js'),'utf8'),{module,wx:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v)},require:k=>k==='./config'?config:k==='./tag-images'?require('../../utils/tag-images'):{getUserInfo:()=>user}})
 const s=module.exports,catalog=[{code:'GLUCOSE',name:'血糖波动'},{code:'EXERCISE',name:'运动控糖'}]
 s.save(['EXERCISE']);assert.equal(s.read(catalog)[0].code,'EXERCISE')
 user={communityKey:'u2'};assert.equal(s.read(catalog)[0].code,'GLUCOSE')
 user={communityKey:'u1'};config.baseUrl='environment-b';assert.equal(s.read(catalog)[0].code,'GLUCOSE')
 config.baseUrl='environment-a';assert.equal(s.read(catalog)[0].code,'EXERCISE')
 s.save([]);assert.equal(s.read(catalog).length,0)
 s.save(['EXERCISE','GLUCOSE','EXERCISE','NOT_ACTIVE']);assert.equal(s.read(catalog).length,2)
 user=null;const size=storage.size;s.save(['EXERCISE']);assert.equal(storage.size,size)
})
