const config = require('../../utils/config')
const { getToken } = require('../../utils/request')
Component({
  properties:{ mediaId:{ type:String, value:'', observer(){ if (this._ready) this.load() } }, mode:{ type:String, value:'widthFix' } },
  data:{ source:'',error:false },
  lifetimes:{ attached(){ this._ready = true; this.load() }, detached(){ this._ready = false; this.clear() } },
  pageLifetimes:{ hide(){ this._hidden = true }, show(){ this._hidden = false; if (this._ready && (!this.data.source || this._sourceToken !== getToken())) this.load() } },
  methods:{
    remove(path){ if (path) wx.getFileSystemManager().unlink({ filePath:path, fail(){} }) },
    clear(){ this._version = (this._version || 0) + 1; if (this._task) this._task.abort(); this._task = null; this.remove(this.data.source); this.setData({ source:'' }) },
    load(){
      if (!this._ready || this._hidden) return
      this.clear(); this.setData({ error:false })
      const id = this.data.mediaId, token = getToken(), version = this._version
      if (!/^[1-9]\d{0,18}$/.test(id) || !token) return this.failed()
      const issue = typeof config.connectionIssue === 'function' && config.connectionIssue()
      if (issue) return this.failed()
      this._task = wx.downloadFile({ url:`${config.baseUrl}/community/article-videos/${encodeURIComponent(id)}`, header:{ Authorization:`Bearer ${token}` }, timeout:60000,
        success:result => {
          if (!this._ready || this._hidden || version !== this._version || token !== getToken()) { this.remove(result.tempFilePath); return }
          if (result.statusCode !== 200) { this.remove(result.tempFilePath); this.failed(); return }
          this._sourceToken = token; this.setData({ source:result.tempFilePath,error:false })
        }, fail:() => { if (this._ready && version === this._version) this.failed() } })
    },
    failed(){ this.remove(this.data.source); this.setData({ error:true,source:'' }) },
    preview(){ if (this.data.source && getToken() === this._sourceToken) wx.previewImage({ urls:[this.data.source],current:this.data.source }); else this.clear() }
  }
})
