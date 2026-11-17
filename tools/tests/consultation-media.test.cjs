const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
test('问诊图片仅向当前API主机携带本人Token下载，失败不能回退公开地址',async()=>{
 const state={token:'one',calls:[]},config={baseUrl:'https://api.example.test/api/v1'},mod={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../utils/consultation-media.js'),'utf8'),{module:mod,require:key=>key==='./config'?config:{getToken:()=>state.token},wx:{downloadFile:args=>state.calls.push(args)}})
 await assert.rejects(mod.exports.loadPhoto('https://untrusted.example/image.jpg'),/地址无效/);assert.equal(state.calls.length,0)
 const pending=mod.exports.loadPhoto('/api/v1/consultations/8/images/10');assert.equal(state.calls[0].url,'https://api.example.test/api/v1/consultations/8/images/10');assert.equal(state.calls[0].header.Authorization,'Bearer one')
 state.calls[0].success({statusCode:500,tempFilePath:'bad.jpg'});await assert.rejects(pending,/加载失败/)
 config.baseUrl='https://new.example.test/api/v1';const next=mod.exports.loadPhoto('/api/v1/consultation-media/10');assert.match(state.calls[1].url,/new.example.test/)
 state.token='two';state.calls[1].success({statusCode:200,tempFilePath:'private-old.jpg'});await assert.rejects(next,/登录状态已变化/)
})
