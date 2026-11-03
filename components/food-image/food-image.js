const { loadRemoteImage, resolveImageUrl, invalidateRemoteImage } = require('../../utils/remote-image')

Component({
  properties: {
    src: { type:String, value:'', observer(){ if(this._ready)this.load() } },
    mode: { type:String, value:'aspectFill' },
    revision: { type:Number, value:0, observer(){ if(this._ready)this.load() } }
  },
  data: { source:'', loading:false, error:false },
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
      const version=this._version=(this._version||0)+1,original=this.data.src
      const url=resolveImageUrl(original)
      this.setData({source:'',loading:!!url,error:!url})
      if(!url)return
      let path=''
      try { path=await loadRemoteImage(url) } catch (_) {}
      if(!this._ready||this._hidden||version!==this._version||original!==this.data.src||url!==resolveImageUrl(this.data.src))return
      // A failed download returns its URL. Keep a retry control instead of direct LAN loading.
      const downloaded=!!path&&(!/^https?:\/\//i.test(url)||path!==url)
      this.setData({source:downloaded?path:'',loading:false,error:!downloaded})
    },
    onImageError(event){
      const failed=event&&event.currentTarget&&event.currentTarget.dataset.src
      if(!this._ready||this._hidden||(failed&&failed!==this.data.source))return
      invalidateRemoteImage(this.data.src)
      this.setData({source:'',loading:false,error:true})
    },
    onRetry(){
      if(this.data.loading||!this._ready||this._hidden)return
      invalidateRemoteImage(this.data.src)
      return this.load()
    }
  }
})
