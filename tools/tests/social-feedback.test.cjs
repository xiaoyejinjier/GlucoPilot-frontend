const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function component(name){
  let definition,id=0;const timers=new Map(),listeners=new Set()
  const wx={onKeyboardHeightChange:fn=>listeners.add(fn),offKeyboardHeightChange:fn=>listeners.delete(fn)}
  vm.runInNewContext(fs.readFileSync(path.join(root,`components/${name}/${name}.js`),'utf8'),{Component:value=>definition=value,wx,
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:key=>timers.delete(key)})
  const instance={...definition.methods,data:JSON.parse(JSON.stringify(definition.data)),setData(values,callback){Object.assign(this.data,values);if(callback)callback()}}
  return{instance,definition,timers,listeners}
}
test('底部提示连续操作替换为最新结果，旧定时器不会提前关闭新提示',()=>{
  const {instance:c,definition:d,timers}=component('social-feedback');d.lifetimes.attached.call(c)
  c.show('点赞成功');assert.equal(c.data.visible,true);assert.equal(c.data.message,'点赞成功')
  const old=[...timers.values()][0];assert.equal(old.ms,1800)
  c.show('收藏成功');assert.equal(timers.size,1);old.fn();assert.equal(c.data.visible,true);assert.equal(c.data.message,'收藏成功')
  ;[...timers.values()][0].fn();assert.equal(c.data.visible,false);d.lifetimes.detached.call(c)
})
test('底部提示避开键盘，隐藏及卸载时注销监听清理计时，旧回调不能重新弹出',()=>{
  const {instance:c,definition:d,timers,listeners}=component('social-feedback');d.lifetimes.attached.call(c);d.pageLifetimes.show.call(c)
  assert.equal(listeners.size,1);const listener=[...listeners][0];listener({height:280});assert.equal(c.data.keyboardHeight,280)
  c.show('评论成功');const late=[...timers.values()][0];d.pageLifetimes.hide.call(c);assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.equal(c.data.visible,false)
  c.show('迟到提示');listener({height:400});late.fn();assert.equal(c.data.visible,false);assert.equal(c.data.keyboardHeight,0)
  d.pageLifetimes.show.call(c);c.show('关注成功');assert.equal(c.data.visible,true);d.lifetimes.detached.call(c);assert.equal(listeners.size,0);assert.equal(timers.size,0)
})
test('点赞收藏仅显式触发序号变化时播放，同值回填和其他按钮不联动，离页停止动画',()=>{
  const {instance:c,definition:d,timers}=component('social-action')
  c.data.pulse=0;d.observers.pulse.call(c,0);assert.equal(c.data.pulsing,false);assert.equal(timers.size,0)
  d.lifetimes.attached.call(c);d.observers.pulse.call(c,0);assert.equal(c.data.pulsing,false)
  d.observers.pulse.call(c,1);assert.equal(c.data.pulsing,true)
  const old=[...timers.values()][0];old.fn();assert.equal(c.data.pulsing,false);d.observers.pulse.call(c,1);assert.equal(c.data.pulsing,false)
  d.observers.pulse.call(c,2);old.fn();assert.equal(c.data.pulsing,true)
  const other=component('social-action');other.instance.data.pulse=0;other.definition.lifetimes.attached.call(other.instance);other.definition.observers.pulse.call(other.instance,0);assert.equal(other.instance.data.pulsing,false)
  d.pageLifetimes.hide.call(c);assert.equal(c.data.pulsing,false);assert.equal(timers.size,0);d.observers.pulse.call(c,3);assert.equal(c.data.pulsing,false)
  d.pageLifetimes.show.call(c);d.observers.pulse.call(c,3);assert.equal(c.data.pulsing,false);d.observers.pulse.call(c,4);assert.equal(c.data.pulsing,true);d.lifetimes.detached.call(c);assert.equal(timers.size,0)
})
