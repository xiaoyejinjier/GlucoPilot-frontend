const api=require('../../services/wallet')
const social=require('../../utils/community')
const {money}=require('../../utils/consultation')
const {applyDisplayToCurrentPage}=require('../../utils/display')
const {statusLabel,validPayee}=require('../../utils/withdrawal')
function cents(value){const s=String(value||'').trim();if(!/^\d{1,7}(\.\d{1,2})?$/.test(s))return null;const [whole,part='']=s.split('.');const n=Number(whole)*100+Number((part+'00').slice(0,2));return n>=10&&n<=100000000?n:null}
Page({
  data:{displayStyle:'',loading:false,posting:false,eligible:false,available:'—',availableCents:0,frozen:'—',amount:'',payeeUserId:'',transferEnabled:false,records:[],hasMore:false,pageNum:0,error:''},
  onShow(){if(!getApp().checkLogin())return;const old=this._communityToken;social.begin(this);applyDisplayToCurrentPage();if(old!==this._communityToken){this._attempt=null;this.setData({amount:'',payeeUserId:'',posting:false,records:[]})}this.load()},
  onHide(){social.end(this);this._run=(this._run||0)+1},onUnload(){this.onHide()},
  async load(more=false,refresh=false){
    if(!social.active(this)||this.data.posting||(more&&(this.data.loading||!this.data.hasMore)))return
    const version=this._communityVersion,run=this._run=(this._run||0)+1,pageNum=more?this.data.pageNum+1:1
    this.setData({loading:true,error:'',...(!more?{eligible:false,available:'—',availableCents:0,frozen:'—',records:[]}: {})})
    try{if(refresh)await api.refreshWithdrawals();if(!social.active(this,version)||run!==this._run)return
      const [summary,page]=await Promise.all([api.withdrawalSummary(),api.withdrawals({pageNum,pageSize:10})]);if(!social.active(this,version)||run!==this._run)return
      this.setData({eligible:summary.eligible===true,transferEnabled:summary.transferEnabled===true,available:money(summary.availableCents),availableCents:Number(summary.availableCents),frozen:money(summary.frozenCents),records:(more?this.data.records:[]).concat((page.records||[]).map(row=>({...row,statusLabel:statusLabel(row),amountLabel:money(row.amountCents),timeLabel:social.timeLabel(row.createdAt)}))),hasMore:pageNum<Number(page.pages),pageNum})
    }catch(error){if(social.active(this,version)&&run===this._run){this.setData({error:error.message||'提现记录加载失败，请重试'});social.failure(this,error,version)}}
    finally{if(social.active(this,version)&&run===this._run)this.setData({loading:false})}
  },
  onAmount(event){if(!this.data.posting){this._attempt=null;this.setData({amount:event.detail.value})}},
  onPayee(event){if(!this.data.posting){this._attempt=null;this.setData({payeeUserId:String(event.detail.value||'').trim()})}},
  onAll(){if(!this.data.posting){this._attempt=null;this.setData({amount:money(this.data.availableCents)})}},
  onApply(){if(!social.active(this)||this.data.loading||this.data.posting||!this.data.eligible)return
    const amount=cents(this.data.amount);if(amount===null||amount>this.data.availableCents){wx.showToast({title:'请输入可提现范围内的金额，至少0.10元，最多两位小数',icon:'none'});return}
    if(!validPayee(this.data.payeeUserId)){wx.showToast({title:'请填写支付宝沙箱买家UID',icon:'none'});return}
    if(!this.data.transferEnabled){wx.showToast({title:'支付宝沙箱转账尚未配置',icon:'none'});return}
    const version=this._communityVersion
    wx.showModal({title:'确认沙箱提现',content:'提交后冻结对应问诊收入，审核通过后第5个工作日转入填写的支付宝沙箱账号，仅测试资金。',confirmText:'提交申请',success:result=>{if(result.confirm&&social.active(this,version))this.submit(amount)}})
  },
  async submit(amount){if(!social.active(this)||this.data.posting)return;const version=this._communityVersion
    if(!this._attempt||this._attempt.amountCents!==amount||this._attempt.payeeUserId!==this.data.payeeUserId)this._attempt={amountCents:amount,clientRequestId:social.requestId(),payeeUserId:this.data.payeeUserId}
    this.setData({posting:true})
    try{await api.withdraw(this._attempt);if(!social.active(this,version))return;this._attempt=null;this.setData({posting:false,amount:''});wx.showToast({title:'提现申请已提交',icon:'success'});await this.load()}
    catch(error){if(social.active(this,version))social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({posting:false})}
  },
  onBindPayee(event){
    if(!social.active(this)||this.data.loading||this.data.posting)return
    const no=String(event.currentTarget.dataset.order||'')
    const row=this.data.records.find(item=>item.orderNo===no)
    if(!row||row.transferStartedAt||!['PENDING','APPROVED'].includes(row.status))return
    if(!validPayee(this.data.payeeUserId)){wx.showToast({title:'请先在上方填写支付宝沙箱买家UID',icon:'none'});return}
    const version=this._communityVersion,payeeUserId=this.data.payeeUserId
    wx.showModal({title:'确认沙箱收款账号',content:payeeUserId,success:async result=>{
      if(!result.confirm||!social.active(this,version)||this.data.posting)return
      this.setData({posting:true})
      try{await api.withdrawalRecipient(no,{payeeUserId});if(social.active(this,version)){this.setData({posting:false});await this.load()}}
      catch(error){social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({posting:false})}
    }})
  },
  onRefresh(){return this.load(false,true)},
  onMore(){return this.load(true)},onRetry(){return this.load()},onReachBottom(){return this.load(true)},
  async onPullDownRefresh(){try{await this.onRefresh()}finally{wx.stopPullDownRefresh()}}
})
