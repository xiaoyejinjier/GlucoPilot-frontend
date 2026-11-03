const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
function harness(){
  const config={baseUrl:'http://current.example.test:8080/api/v1'},downloads=[],files=new Set(),module={exports:{}}
  const wx={downloadFile:options=>downloads.push(options),getFileSystemManager:()=>({access:o=>files.has(o.path)?o.success():o.fail()})}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/remote-image.js'),'utf8'),{module,wx,require:name=>{assert.equal(name,'./config');return config}})
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/food-image/food-image.js'),'utf8'),{Component:c=>definition=c,require:()=>module.exports})
  function create(src){
    const c={...definition.methods,data:{...JSON.parse(JSON.stringify(definition.data)),src,mode:'aspectFill',revision:0},setData:patch=>Object.assign(c.data,patch)}
    definition.lifetimes.attached.call(c);return c
  }
  return{config,downloads,files,images:module.exports,definition,create}
}

test('营养库分类及食品图先通过downloadFile读取当前后端，支持真机和开发工具临时路径',async()=>{
  const h=harness(),category=h.create('/api/v1/foods/images/39'),food=h.create('http://old.example.test/api/v1/foods/26/image')
  assert.equal(category.data.loading,true);assert.equal(category.data.source,'')
  assert.equal(h.downloads[0].url,h.config.baseUrl+'/foods/images/39')
  assert.equal(h.downloads[1].url,h.config.baseUrl+'/foods/26/image')
  h.downloads[0].success({statusCode:200,tempFilePath:'wxfile://category.jpg'})
  h.downloads[1].success({statusCode:200,tempFilePath:'http://tmp/food.jpg'})
  await flush()
  assert.equal(category.data.source,'wxfile://category.jpg');assert.equal(category.data.error,false)
  assert.equal(food.data.source,'http://tmp/food.jpg');assert.equal(food.data.loading,false)
  assert.equal(food.data.src,'http://old.example.test/api/v1/foods/26/image')
})

test('食品图失败保留真实图片身份，点重试成功恢复，不把错误响应或原网络URL交给image',async()=>{
  const h=harness(),c=h.create('/api/v1/foods/images/67')
  h.downloads[0].success({statusCode:500,tempFilePath:'wxfile://error.json'});await flush()
  assert.equal(c.data.error,true);assert.equal(c.data.source,'')
  const task=c.onRetry();c.onRetry()
  assert.equal(h.downloads.length,2)
  h.downloads[1].success({statusCode:200,tempFilePath:'wxfile://restored.jpg'});await task
  assert.equal(c.data.source,'wxfile://restored.jpg');assert.equal(c.data.src,'/api/v1/foods/images/67')
  c.onImageError({currentTarget:{dataset:{src:'wxfile://restored.jpg'}}})
  const retry=c.onRetry();h.downloads[2].fail();await retry
  assert.equal(c.data.source,'');assert.equal(c.data.error,true)
})

test('共享图片合并下载，临时文件清理后重新下载，刷新同一地址可恢复失败图片',async()=>{
  const h=harness(),a=h.create('/api/v1/foods/images/39'),b=h.create('/api/v1/foods/images/39')
  assert.equal(h.downloads.length,1)
  h.files.add('wxfile://first.jpg');h.downloads[0].success({statusCode:200,tempFilePath:'wxfile://first.jpg'});await flush()
  assert.equal(a.data.source,b.data.source)
  h.files.clear()
  h.definition.properties.revision.observer.call(a);await flush()
  assert.equal(h.downloads.length,2)
  h.downloads[1].fail();await flush();assert.equal(a.data.error,true)
  h.definition.properties.revision.observer.call(a);await flush()
  h.downloads[2].success({statusCode:200,tempFilePath:'wxfile://fresh.jpg'});await flush()
  assert.equal(a.data.source,'wxfile://fresh.jpg')
})

test('管理员换图、离页及切换后端时旧下载结果不能覆盖新图',async()=>{
  const h=harness(),c=h.create('/api/v1/foods/images/14')
  c.data.src='/api/v1/foods/images/21';h.definition.properties.src.observer.call(c)
  h.downloads[1].success({statusCode:200,tempFilePath:'wxfile://new.jpg'});await flush()
  h.downloads[0].success({statusCode:200,tempFilePath:'wxfile://old.jpg'});await flush()
  assert.equal(c.data.source,'wxfile://new.jpg')
  c.onImageError({currentTarget:{dataset:{src:'wxfile://old.jpg'}}});assert.equal(c.data.source,'wxfile://new.jpg')
  const pending=c.load();await flush();h.definition.pageLifetimes.hide.call(c)
  h.downloads[2].success({statusCode:200,tempFilePath:'wxfile://hidden.jpg'});await pending
  assert.equal(c.data.source,'')
  h.config.baseUrl='https://new.example.test/gateway/api/v1'
  h.definition.pageLifetimes.show.call(c);await flush()
  assert.equal(h.downloads[3].url,'https://new.example.test/gateway/api/v1/foods/images/21')
  h.definition.lifetimes.detached.call(c)
  h.downloads[3].success({statusCode:200,tempFilePath:'wxfile://detached.jpg'});await flush()
  assert.equal(c.data.source,'')
})

test('食品稳定地址跟随当前服务，外部CDN及本地资源保持原样，页面均登记下载组件',async()=>{
  const h=harness()
  assert.equal(h.images.resolveImageUrl('http://127.0.0.1:8080/api/v1/foods/images/39?v=2'),h.config.baseUrl+'/foods/images/39?v=2')
  const cdn='https://cdn.example.test/photo.jpg?signature=example'
  assert.equal(h.images.resolveImageUrl(cdn),cdn)
  const local=h.create('/assets/foods/apple.svg');await flush()
  assert.equal(local.data.source,'/assets/foods/apple.svg');assert.equal(h.downloads.length,0)
  for(const name of ['nutrition','nutrition-list']){
    const config=JSON.parse(fs.readFileSync(path.join(root,`pages/${name}/${name}.json`),'utf8'))
    assert.equal(config.usingComponents['food-image'],'/components/food-image/food-image')
    const template=fs.readFileSync(path.join(root,`pages/${name}/${name}.wxml`),'utf8')
    assert.match(template,/<food-image\b[^>]*revision=/)
    assert.equal(/<image\b/.test(template),false)
  }
})

test('批量食物照片限制同时下载数量，失败释放位置，队列最终全部完成',async()=>{
  const h=harness(),components=Array.from({length:12},(_,i)=>h.create(`/api/v1/foods/images/${i+1}`))
  assert.equal(h.downloads.length,5)
  h.downloads[0].fail();await flush()
  assert.equal(h.downloads.length,6)
  for(let i=1;i<12;i++){
    assert.ok(h.downloads[i],`download ${i} must be queued`)
    h.downloads[i].success({statusCode:200,tempFilePath:`wxfile://image-${i}.jpg`})
  }
  await flush()
  assert.equal(components[0].data.error,true)
  assert.equal(components.slice(1).every(c=>!!c.data.source&&!c.data.loading),true)
})
