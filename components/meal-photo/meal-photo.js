const config = require('../../utils/config')
const { getToken } = require('../../utils/request')
Component({
  properties: { mediaId: { type:String,value:'',observer(){if(this._ready)this.load()} } },
  data: { source:'',error:false },
  lifetimes: {
    attached(){this._ready=true;this.load()},
    detached(){this._ready=false;this.clear()}
  },
  pageLifetimes: {
    hide(){this._hidden=true;this.clear()},
    show(){this._hidden=false;if(this._ready&&(!this.data.source||this._token!==getToken()))this.load()}
  },
  methods: {
    remove(path){if(path)wx.getFileSystemManager().unlink({filePath:path,fail(){}})},
    clear(){
      this._version=(this._version||0)+1
      if(this._task)this._task.abort()
      this._task=null;this._token='';this.remove(this.data.source);this.setData({source:''})
    },
    load(){
      if(!this._ready||this._hidden)return
      this.clear();this.setData({error:false})
      const id=this.data.mediaId,token=getToken(),version=this._version
      if(!/^[1-9]\d{0,18}$/.test(id)||!token||(typeof config.connectionIssue==='function'&&config.connectionIssue()))return this.failed()
      this._task=wx.downloadFile({
        url:`${config.baseUrl}/meal-records/images/${encodeURIComponent(id)}`,
        header:{Authorization:`Bearer ${token}`},timeout:30000,
        success:result=>{
          if(!this._ready||this._hidden||version!==this._version||token!==getToken()){this.remove(result.tempFilePath);return}
          if(result.statusCode!==200||!result.tempFilePath){this.remove(result.tempFilePath);this.failed();return}
          this._token=token;this.setData({source:result.tempFilePath,error:false})
        },
        fail:()=>{if(this._ready&&!this._hidden&&version===this._version&&token===getToken())this.failed()}
      })
    },
    failed(){this.remove(this.data.source);this.setData({source:'',error:true})},
    preview(){
      if(this.data.source&&this._token===getToken()&&!this._hidden)wx.previewImage({current:this.data.source,urls:[this.data.source]})
      else this.clear()
    }
  }
})
