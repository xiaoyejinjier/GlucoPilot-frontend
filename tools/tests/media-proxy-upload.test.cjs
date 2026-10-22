const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function harness(uploadUrl){
 const calls=[],bytes=Uint8Array.from([255,216,255,224,0,128,254]).buffer
 const api={createMediaUploadCredential:async(...args)=>{calls.push({step:'credential',args});return{uploadUrl,storageKey:'1/2026/10/2/avatar.jpg'}},registerMediaFile:async payload=>{calls.push({step:'register',payload});return{id:'1',fileUrl:'/api/v1/media-files/avatars/1'}}}
 const module={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../utils/media.js'),'utf8'),{module,require:()=>api,Uint8Array,wx:{getFileSystemManager:()=>({readFile:options=>options.success({data:bytes})}),request:options=>{calls.push({step:'put',options});options.success({statusCode:204})}}})
 return{api:module.exports,calls,bytes}
}
for(const provider of ['local','minio'])test(provider+'同源上传保持二进制字节及octet-stream，204后才登记',async()=>{
 const {api,calls,bytes}=harness('https://backend.example.test/api/v1/media-files/'+provider+'-uploads/one-time-token')
 const result=await api.uploadMediaFile(api.BIZ_TYPE.AVATAR,'wxfile://avatar.jpg')
 assert.equal(result.id,'1');assert.deepEqual(calls.map(c=>c.step),['credential','put','register']);assert.equal(calls[1].options.header['Content-Type'],'application/octet-stream');assert.equal(calls[1].options.data,bytes);assert.equal(calls[2].payload.sizeBytes,7);assert.equal(calls[2].payload.mimeType,'image/jpeg')
})
test('外部预签名上传不注入Content-Type以免破坏签名',async()=>{
 const {api,calls}=harness('https://storage.example.test/private/object?signature=example')
 await api.uploadChatImage('wxfile://chat.jpg');assert.deepEqual(Object.keys(calls[1].options.header),[])
})
