const api = require('../../services/api')
const social = require('../../utils/community')
const notices = require('../../utils/message-notifications')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const TABS = [{key:'messages',label:'私信',symbol:'✉'},{key:'likes',kind:'LIKE',label:'点赞',symbol:'♡'},{key:'collections',kind:'COLLECT',label:'收藏',symbol:'☆'},{key:'comments',kind:'COMMENT',label:'收到的评论',symbol:'评'},{key:'follows',kind:'FOLLOW',label:'新关注我的',symbol:'友'}]
Page({
  data:{displayStyle:'',tabs:TABS,activeTab:'messages',informationCounts:{},list:[],loading:false,error:'',pageNum:0,hasMore:false},
  onLoad(options){if(TABS.some(tab=>tab.key===options.tab))this.setData({activeTab:options.tab})},
  onShow(){if(!getApp().checkLogin())return;social.begin(this);applyDisplayToCurrentPage();this._busy=false;this.setData({list:[],pageNum:0,hasMore:false,loading:false,error:''});this.load(true);this._timer=setInterval(()=>{if(this.data.pageNum<=1)this.load(true,true)},5000)},
  onHide(){social.end(this);this._run=(this._run||0)+1;this._busy=false;if(this._timer)clearInterval(this._timer);this._timer=null},onUnload(){this.onHide()},
  onTab(e){const key=e.currentTarget.dataset.key;if(key===this.data.activeTab||!TABS.some(t=>t.key===key))return;this._run=(this._run||0)+1;this._busy=false;this.setData({activeTab:key,list:[],pageNum:0,hasMore:false});this.load(true)},
  async load(reset,quiet=false){if(!social.active(this)||this._busy||(!reset&&!this.data.hasMore))return;this._busy=true;const version=this._communityVersion,run=this._run=(this._run||0)+1,tab=TABS.find(t=>t.key===this.data.activeTab),pageNum=reset?1:this.data.pageNum+1;this.setData({error:'',...(!quiet?{loading:true}:{})});
    try{const page=tab.kind?await api.fetchInteractionNotices(tab.kind,{pageNum,pageSize:20}):await api.fetchCommunityList('messages',{pageNum,pageSize:20});if(!social.active(this,version)||run!==this._run)return;
      const records=page.records.map(item=>tab.kind?{...item,rowKey:item.id,timeLabel:social.relativeTime(item.createdAt),action:tab.kind==='LIKE'?'赞了你的文章':tab.kind==='COLLECT'?'收藏了你的文章':tab.kind==='COMMENT'?'评论了你':'关注了你'}:{...item,rowKey:item.peer.key,unreadCount:notices.count(item.unreadCount),unreadLabel:notices.label(item.unreadCount),timeLabel:social.timeLabel(item.lastMessage&&item.lastMessage.createdAt)});
      const map=new Map((reset?[]:this.data.list).map(item=>[item.rowKey,item]));records.forEach(item=>map.set(item.rowKey,item));this.setData({list:Array.from(map.values()),pageNum,hasMore:pageNum<Number(page.pages)});
      if(tab.kind&&records.length)await api.readInteractionNotices(tab.kind,records[0].id);if(social.active(this,version)&&run===this._run)notices.refresh();
    }catch(error){if(social.active(this,version,error)&&run===this._run){this.setData({error:error.message||'信息加载失败，请重试'});if(error.code===40100)social.failure(this,error,version)}}finally{if(social.active(this,version)&&run===this._run){this._busy=false;this.setData({loading:false})}}},
  onOpen(e){const item=this.data.list.find(row=>row.rowKey===String(e.currentTarget.dataset.id));if(!item||!social.active(this))return;if(this.data.activeTab==='messages')wx.navigateTo({url:`/pages/messages/messages?peer=${item.peer.userId}`});else if(item.kind==='FOLLOW')wx.navigateTo({url:`/pages/community-profile/community-profile?key=${item.actor.key}`});else {const target=item.kind==='COMMENT'?'&comments=1'+(/^[1-9]\d{0,18}$/.test(String(item.commentId||''))?`&commentId=${item.commentId}`:''):'';wx.navigateTo({url:`/pages/news-detail/news-detail?id=${item.newsId}${target}`})}},
  onReports(){if(social.active(this))wx.navigateTo({url:'/pages/community-reports/community-reports'})},
  onMore(){return this.load(false)},onRetry(){return this.load(true)},onReachBottom(){this.load(false)},async onPullDownRefresh(){try{await this.load(true);notices.refresh()}finally{wx.stopPullDownRefresh()}}
})
