const api=require('../../services/api')
const {getToken}=require('../../utils/request')
Component({
  properties:{visible:{type:Boolean,value:false},value:{type:String,value:'PUBLIC'},viewerIds:{type:Array,value:[]},busy:{type:Boolean,value:false},displayStyle:{type:String,value:''}},
  observers:{'visible,value,viewerIds'(open){if(open)this.begin();else this.invalidate()}},
  data:{mode:'PUBLIC',selectedIds:[],friends:[],keyword:'',pageNum:0,hasMore:false,loading:false,error:'',options:[{value:'PUBLIC',title:'公开',note:'审核通过后，所有人可见',symbol:'◎'},{value:'PRIVATE',title:'仅自己可见',note:'作为自己的私密记录',symbol:'◇'},{value:'FRIENDS',title:'指定好友可见',note:'从互相关注的好友中选择',symbol:'♧'}]},
  lifetimes:{detached(){this.invalidate()}},pageLifetimes:{hide(){this.invalidate()}},
  methods:{
    begin(){this._open=true;this._token=getToken();this._request=(this._request||0)+1;this.setData({mode:this.data.value||'PUBLIC',selectedIds:(this.data.viewerIds||[]).map(String),friends:[],keyword:'',pageNum:0,hasMore:false,loading:false,error:''});if(this.data.mode==='FRIENDS')this.loadFriends(true)},
    invalidate(){this._open=false;this._request=(this._request||0)+1},
    current(run=this._request){return this._open&&this.data.visible&&!!this._token&&this._token===getToken()&&run===this._request},
    onMode(event){if(this.data.busy)return;const mode=event.currentTarget.dataset.value;if(!this.data.options.some(o=>o.value===mode))return;this.setData({mode});if(mode==='FRIENDS'&&!this.data.pageNum)this.loadFriends(true)},
    onKeyword(event){this.setData({keyword:event.detail.value})},
    onSearch(){this.loadFriends(true)},onMore(){this.loadFriends(false)},onRetry(){this.loadFriends(true)},
    async loadFriends(reset){if(!this.current()||(!reset&&(this.data.loading||!this.data.hasMore)))return;const run=this._request=(this._request||0)+1,pageNum=reset?1:this.data.pageNum+1;this.setData({loading:true,error:''});
      try{const page=await api.fetchMutualFriends({pageNum,pageSize:20,keyword:this.data.keyword.trim()});if(!this.current(run))return;const map=new Map((reset?[]:this.data.friends).map(row=>[row.userId,row]));for(const row of page.records||[])map.set(String(row.userId),{...row,userId:String(row.userId),selected:this.data.selectedIds.includes(String(row.userId))});this.setData({friends:[...map.values()],pageNum,hasMore:pageNum<Number(page.pages)})}
      catch(error){if(this.current(run))this.setData({error:error.message||'好友列表加载失败，请重试'})}
      finally{if(this.current(run))this.setData({loading:false})}
    },
    onFriend(event){if(!this.current()||this.data.busy)return;const id=String(event.currentTarget.dataset.id);if(!this.data.friends.some(row=>row.userId===id))return;let ids=this.data.selectedIds;if(ids.includes(id))ids=ids.filter(value=>value!==id);else{if(ids.length>=50)return wx.showToast({title:'最多选择50位好友',icon:'none'});ids=[...ids,id]}this.setData({selectedIds:ids,friends:this.data.friends.map(row=>({...row,selected:ids.includes(row.userId)}))})},
    onClear(){if(!this.data.busy)this.setData({selectedIds:[],friends:this.data.friends.map(row=>({...row,selected:false}))})},
    confirm(){if(!this.current()||this.data.busy)return;if(this.data.mode==='FRIENDS'&&!this.data.selectedIds.length)return wx.showToast({title:'请至少选择一位好友',icon:'none'});this.triggerEvent('confirm',{visibility:this.data.mode,viewerIds:this.data.mode==='FRIENDS'?[...this.data.selectedIds]:[]})},
    close(){if(!this.data.busy)this.triggerEvent('close')},stopTouch(){}
  }
})
