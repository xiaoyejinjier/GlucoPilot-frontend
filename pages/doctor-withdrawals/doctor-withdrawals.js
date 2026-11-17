const api=require('../../services/wallet')
const social=require('../../utils/community')
const {money}=require('../../utils/consultation')
const {applyDisplayToCurrentPage}=require('../../utils/display')
const labels={PENDING:'待审核',APPROVED:'待发放',REJECTED:'已拒绝',COMPLETED:'已模拟发放'}
function cents(value){const s=String(value||'').trim();if(!/^\d{1,7}(\.\d{1,2})?$/.test(s))return null;const [whole,part='']=s.split('.');const n=Number(whole)*100+Number((part+'00').slice(0,2));return n>=1&&n<=100000000?n:null}
Page({
  data:{displayStyle:'',loading:false,posting:false,eligible:false,available:'—',availableCents:0,frozen:'—',amount:'',records:[],hasMore:false,pageNum:0,error:''},
  onShow(){if(!getApp().checkLogin())return;const old=this._communityToken;social.begin(this);applyDisplayToCurrentPage();if(old!==this._communityToken){this._attempt=null;this.setData({amount:'',records:[]})}this.load()},
  onHide(){social.end(this);this._run=(this._run||0)+1},onUnload(){this.onHide()},
  async load(more=false){
    if(!social.active(this)||this.data.posting||(more&&(this.data.loading||!this.data.hasMore)))return
    const version=this._communityVersion,run=this._run=(this._run||0)+1,pageNum=more?this.data.pageNum+1:1
    this.setData({loading:true,error:'',...(!more?{eligible:false,available:'—',frozen:'—',records:[]}: {})})
    try{const [summary,page]=await Promise.all([api.withdrawalSummary(),api.withdrawals({pageNum,pageSize:10})]);if(!social.active(this,version)||run!==this._run)return
      this.setData({eligible:summary.eligible===true,available:money(summary.availableCents),availableCents:Number(summary.availableCents),frozen:money(summary.frozenCents),records:(more?this.data.records:[]).concat((page.records||[]).map(row=>({...row,statusLabel:labels[row.status]||row.status,amountLabel:money(row.amountCents),timeLabel:social.timeLabel(row.createdAt)}))),hasMore:pageNum<Number(page.pages),pageNum})
    }catch(error){if(social.active(this,version)&&run===this._run){this.setData({error:error.message||'提现记录加载失败，请重试'});social.failure(this,error,version)}}
    finally{if(social.active(this,version)&&run===this._run)this.setData({loading:false})}
  },
  onAmount(event){if(!this.data.posting){this._attempt=null;this.setData({amount:event.detail.value})}},
  onAll(){if(!this.data.posting){this._attempt=null;this.setData({amount:money(this.data.availableCents)})}},
  onApply(){if(!social.active(this)||this.data.loading||this.data.posting||!this.data.eligible)return
    const amount=cents(this.data.amount);if(amount===null||amount>this.data.availableCents){wx.showToast({title:'请输入可提现范围内的金额，最多两位小数',icon:'none'});return}
    const version=this._communityVersion
    wx.showModal({title:'确认沙箱提现',content:'提交后冻结对应问诊收入，审核通过后5个工作日模拟发放，不涉及真实转账。',confirmText:'提交申请',success:result=>{if(result.confirm&&social.active(this,version))this.submit(amount)}})
  },
  async submit(amount){if(!social.active(this)||this.data.posting)return;const version=this._communityVersion
    if(!this._attempt||this._attempt.amountCents!==amount)this._attempt={amountCents:amount,clientRequestId:social.requestId()}
    this.setData({posting:true})
    try{await api.withdraw(this._attempt);if(!social.active(this,version))return;this._attempt=null;this.setData({posting:false,amount:''});wx.showToast({title:'提现申请已提交',icon:'success'});await this.load()}
    catch(error){if(social.active(this,version))social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({posting:false})}
  },
  onMore(){return this.load(true)},onRetry(){return this.load()},onReachBottom(){return this.load(true)},
  async onPullDownRefresh(){try{await this.load()}finally{wx.stopPullDownRefresh()}}
})
