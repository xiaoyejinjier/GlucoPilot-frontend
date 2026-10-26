const config = require('../../utils/config')
const { getToken } = require('../../utils/request')
let activePlayer = null
Component({
  properties:{ mediaId:{ type:String, value:'', observer(){ if (this._ready) { this.pause(); this.setData({requested:false,poster:''}); this.load() } } }, mode:{ type:String, value:'widthFix' }, lazy:{type:Boolean,value:false} },
  data:{ source:'',poster:'',error:false,requested:false },
  lifetimes:{ attached(){ this._ready = true; this.load() }, detached(){ this.pause(); if(activePlayer===this)activePlayer=null;this._ready = false; this.clear() } },
  pageLifetimes:{ hide(){ this.pause();this._hidden = true;this.setData({requested:false,poster:''});if(this.data.lazy||!this.data.source)this.clear() }, show(){ this._hidden = false; if (this._ready && (!this.data.source || this._sourceToken !== getToken())) this.load() } },
  methods:{
    stopPropagation(){},
    onCoverChange(e){const detail=e.detail||{};if(this._ready&&!this._hidden&&detail.mediaId===this.data.mediaId)this.setData({poster:detail.source||''})},
    activate(){if(!this._ready||this._hidden||this._loading)return;this.setData({requested:true});this.load()},
    pause(){if(typeof wx.createVideoContext==='function')wx.createVideoContext('article-video-player',this).pause()},
    onPlay(){if(activePlayer&&activePlayer!==this)activePlayer.pause();activePlayer=this},
    remove(path){ if (path) wx.getFileSystemManager().unlink({ filePath:path, fail(){} }) },
    clear(){ this._version = (this._version || 0) + 1; this._loading=false; if (this._task) this._task.abort(); this._task = null; this.remove(this.data.source); this.setData({ source:'' }) },
    load(){
      if (!this._ready || this._hidden) return
      this.clear(); this.setData({ error:false })
      if(this.data.lazy&&!this.data.requested)return
      const id = this.data.mediaId, token = getToken(), version = this._version
      if (!/^[1-9]\d{0,18}$/.test(id) || !token) return this.failed()
      const issue = typeof config.connectionIssue === 'function' && config.connectionIssue()
      if (issue) return this.failed()
      this._loading=true
      this._task = wx.downloadFile({ url:`${config.baseUrl}/community/article-videos/${encodeURIComponent(id)}`, header:{ Authorization:`Bearer ${token}` }, timeout:60000,
        success:result => {
          if (!this._ready || this._hidden || version !== this._version || token !== getToken()) { this.remove(result.tempFilePath); if(this._ready&&version===this._version)this._loading=false; return }
          if (result.statusCode !== 200) { this.remove(result.tempFilePath); this.failed(); return }
          this._loading=false;this._sourceToken = token; this.setData({ source:result.tempFilePath,error:false })
        }, fail:() => { if (this._ready && !this._hidden && version === this._version && token===getToken()) this.failed() } })
    },
    failed(){ this._loading=false;this.remove(this.data.source); this.setData({ error:true,source:'' }) },
    preview(){this.activate()}
  }
})
