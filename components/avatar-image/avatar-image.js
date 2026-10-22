const { loadRemoteImage, invalidateRemoteImage } = require('../../utils/remote-image')
const { getToken } = require('../../utils/request')

Component({
  properties: {
    src: { type:String,value:'',observer(){ if(this._ready)this.load() } },
    text: { type:String,value:'友' },
    mode: { type:String,value:'aspectFill' }
  },
  data: { source:'',error:false },
  lifetimes: {
    attached(){ this._ready=true;this._hidden=false;this.load() },
    detached(){ this._ready=false;this._version=(this._version||0)+1 }
  },
  pageLifetimes: {
    hide(){ this._hidden=true;this._version=(this._version||0)+1 },
    show(){ this._hidden=false;if(this._ready)this.load() }
  },
  methods: {
    async load(){
      if(!this._ready||this._hidden)return
      const version=this._version=(this._version||0)+1,source=this.data.src,token=getToken()
      this.setData({source:'',error:false})
      if(!source)return
      let path=''
      try { path=await loadRemoteImage(source) } catch (_) { /* Keep the fallback visible until the next load. */ }
      if(!this._ready||this._hidden||version!==this._version||source!==this.data.src||token!==getToken())return
      this.setData({source:path||'',error:!path})
    },
    onImageError(){
      invalidateRemoteImage(this.data.src)
      this.setData({source:'',error:true})
    }
  }
})
