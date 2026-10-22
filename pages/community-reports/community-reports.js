const api=require('../../services/api')
const social=require('../../utils/community')
const notices=require('../../utils/message-notifications')
const {applyDisplayToCurrentPage}=require('../../utils/display')
const TYPES={ARTICLE:'文章',COMMENT:'评论',USER:'用户',MESSAGE:'私信'}
const REASONS={MISINFORMATION:'健康信息不实',SPAM:'广告或垃圾信息',ABUSE:'攻击辱骂',PRIVACY:'泄露隐私',OTHER:'其他问题'}
const RESULTS={DISMISS:'核查后未发现违规',HIDE_ARTICLE:'已下架文章',HIDE_COMMENT:'已隐藏评论',RESOLVE:'已完成处理'}
function decorate(item){return{...item,id:String(item.id),typeLabel:TYPES[item.targetType]||'内容',reasonLabel:REASONS[item.reason]||'其他问题',
  targetLabel:item.targetTitle||`举报的${TYPES[item.targetType]||'内容'} #${item.targetId}`,statusLabel:item.state==='OPEN'?'处理中':'已处理',
  resultLabel:RESULTS[item.resolution]||'处理结果',unread:item.state!=='OPEN'&&!!item.resolvedAt&&!item.feedbackRead,
  timeLabel:social.timeLabel(item.createdAt),resolvedLabel:social.timeLabel(item.resolvedAt)}}
Page({
  data:{displayStyle:'',list:[],selected:null,detailMode:false,loading:false,error:'',readError:false,pageNum:0,hasMore:false},
  onLoad(options){this._id=/^[1-9]\d{0,18}$/.test(String(options.id||''))?String(options.id):'';this.setData({detailMode:!!this._id});if(this._id)wx.setNavigationBarTitle({title:'举报处理反馈'})},
  onShow(){if(!getApp().checkLogin())return;social.begin(this);applyDisplayToCurrentPage();this.setData({list:[],selected:null,pageNum:0,hasMore:false,loading:false,error:'',readError:false});this.load(true)},
  onHide(){social.end(this);this._run=(this._run||0)+1;this._busy=false;this._reading=false},onUnload(){this.onHide()},
  async load(reset){
    if(!social.active(this)||this._busy||(!reset&&!this.data.hasMore))return
    this._busy=true;const version=this._communityVersion,run=this._run=(this._run||0)+1,pageNum=reset?1:this.data.pageNum+1
    this.setData({loading:true,error:''})
    try{
      if(this._id){
        const result=await api.fetchReportFeedback(this._id);if(!social.active(this,version)||run!==this._run)return
        this.setData({selected:decorate(result)},()=>{if(social.active(this,version)&&run===this._run)this.markRead()})
      }else{
        const page=await api.fetchMyReports({pageNum,pageSize:15});if(!social.active(this,version)||run!==this._run)return
        const all=new Map((reset?[]:this.data.list).map(row=>[row.id,row]));page.records.forEach(row=>all.set(String(row.id),decorate(row)))
        this.setData({list:Array.from(all.values()),pageNum,hasMore:pageNum<Number(page.pages)})
      }
    }catch(error){if(social.active(this,version,error)&&run===this._run){this.setData({error:error.message||'举报记录加载失败，请重试'});if(error.code===40100)social.failure(this,error,version)}}
    finally{if(social.active(this,version)&&run===this._run){this._busy=false;this.setData({loading:false})}}
  },
  async markRead(){
    const item=this.data.selected;if(!social.active(this)||!item||!item.unread||this._reading)return
    this._reading=true;const version=this._communityVersion;this.setData({readError:false})
    try{await api.readReportFeedback(item.id);if(!social.active(this,version))return;this.setData({selected:{...this.data.selected,feedbackRead:true,unread:false}});notices.refresh()}
    catch(error){if(social.active(this,version,error)){this.setData({readError:true});if(error.code===40100)social.failure(this,error,version)}}
    finally{if(social.active(this,version))this._reading=false}
  },
  onOpen(e){const id=String(e.currentTarget.dataset.id);if(social.active(this)&&this.data.list.some(row=>row.id===id))wx.navigateTo({url:`/pages/community-reports/community-reports?id=${id}`})},
  onRetry(){return this.load(true)},onMore(){return this.load(false)},onReachBottom(){if(!this._id)this.load(false)},
  async onPullDownRefresh(){try{await this.load(true)}finally{wx.stopPullDownRefresh()}}
})
