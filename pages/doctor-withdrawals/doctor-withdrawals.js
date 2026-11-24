const api=require('../../services/wallet')
const social=require('../../utils/community')
const {money}=require('../../utils/consultation')
const {applyDisplayToCurrentPage}=require('../../utils/display')
const {statusLabel,validPayee,canEditRecipient}=require('../../utils/withdrawal')
function cents(value){const s=String(value||'').trim();if(!/^\d{1,7}(\.\d{1,2})?$/.test(s))return null;const [whole,part='']=s.split('.');const n=Number(whole)*100+Number((part+'00').slice(0,2));return n>=10&&n<=100000000?n:null}
function masked(value){return validPayee(value)?String(value).slice(0,4)+' **** '+String(value).slice(-4):''}
Page({
  data:{displayStyle:'',loading:false,posting:false,eligible:false,available:'—',availableCents:0,frozen:'—',amount:'',payeeUserId:'',payeeMasked:'',payeeSource:'',payeeEditing:true,payeeLoading:false,payeeHint:'',transferEnabled:false,records:[],hasMore:false,pageNum:0,error:''},
  onShow(){if(!getApp().checkLogin())return;const old=this._communityToken;social.begin(this);applyDisplayToCurrentPage();if(old!==this._communityToken){this._attempt=null;this._payeeEdited=false;this._recipientDrafts={};this._recipientDialog=null;this.setData({amount:'',payeeUserId:'',payeeMasked:'',payeeSource:'',payeeEditing:true,payeeLoading:false,payeeHint:'',posting:false,records:[]})}this.load()},
  onHide(){social.end(this);this._recipientDialog=null;this._run=(this._run||0)+1;this._recipientRun=(this._recipientRun||0)+1;this.setData({payeeLoading:false})},onUnload(){this.onHide()},
  async load(more=false,refresh=false){
    if(!social.active(this)||this.data.posting||(more&&(this.data.loading||!this.data.hasMore)))return
    const version=this._communityVersion,run=this._run=(this._run||0)+1,pageNum=more?this.data.pageNum+1:1
    this.setData({loading:true,error:'',...(!more?{eligible:false,available:'—',availableCents:0,frozen:'—',records:[]}: {})})
    try{if(refresh)await api.refreshWithdrawals();if(!social.active(this,version)||run!==this._run)return
      const [summary,page]=await Promise.all([api.withdrawalSummary(),api.withdrawals({pageNum,pageSize:10})]);if(!social.active(this,version)||run!==this._run)return
      this.setData({eligible:summary.eligible===true,transferEnabled:summary.transferEnabled===true,available:money(summary.availableCents),availableCents:Number(summary.availableCents),frozen:money(summary.frozenCents),records:(more?this.data.records:[]).concat((page.records||[]).map(row=>({...row,canEditRecipient:canEditRecipient(row),statusLabel:statusLabel(row),amountLabel:money(row.amountCents),timeLabel:social.timeLabel(row.createdAt)}))),hasMore:pageNum<Number(page.pages),pageNum})
      if(summary.eligible===true&&summary.transferEnabled===true&&!validPayee(this.data.payeeUserId)&&!this._payeeEdited)void this.resolvePayee()
    }catch(error){if(social.active(this,version)&&run===this._run){this.setData({error:error.message||'提现记录加载失败，请重试'});social.failure(this,error,version)}}
    finally{if(social.active(this,version)&&run===this._run)this.setData({loading:false})}
  },
  onAmount(event){if(!this.data.posting){this._attempt=null;this.setData({amount:event.detail.value})}},
  onPayee(event){if(!this.data.posting){this._attempt=null;this._payeeEdited=true;const value=String(event.detail.value||'').trim();this.setData({payeeUserId:value,payeeMasked:masked(value),payeeSource:'MANUAL'})}},
  onChangePayee(){if(this.data.posting)return;this._payeeEdited=true;this._recipientRun=(this._recipientRun||0)+1;this._attempt=null;this.setData({payeeEditing:true,payeeLoading:false})},
  onResolvePayee(){if(this.data.posting)return;this._payeeEdited=false;return this.resolvePayee()},
  async resolvePayee(){
    if(!social.active(this)||this.data.payeeLoading||this.data.posting)return
    const version=this._communityVersion,run=this._recipientRun=(this._recipientRun||0)+1
    this.setData({payeeLoading:true,payeeHint:''})
    try{
      const result=await api.defaultWithdrawalRecipient()
      if(!social.active(this,version)||run!==this._recipientRun||this._payeeEdited)return
      if(validPayee(result.payeeUserId)){
        this._attempt=null
        this.setData({payeeUserId:result.payeeUserId,payeeMasked:masked(result.payeeUserId),payeeSource:result.source,payeeEditing:false})
      }else this.setData({payeeEditing:true,payeeHint:'暂无可用收款账号，可手动填写一次。'})
    }catch(error){if(social.active(this,version)&&run===this._recipientRun)this.setData({payeeHint:'暂未识别到收款账号，可重试或手动填写。',payeeEditing:true})}
    finally{if(social.active(this,version)&&run===this._recipientRun)this.setData({payeeLoading:false})}
  },
  onAll(){if(!this.data.posting){this._attempt=null;this.setData({amount:money(this.data.availableCents)})}},
  onApply(){if(!social.active(this)||this.data.loading||this.data.posting||!this.data.eligible)return
    const amount=cents(this.data.amount);if(amount===null||amount>this.data.availableCents){wx.showToast({title:'请输入可提现范围内的金额，至少0.10元，最多两位小数',icon:'none'});return}
    if(!validPayee(this.data.payeeUserId)){wx.showToast({title:this.data.payeeLoading?'正在识别收款账号，请稍候':'请填写支付宝用户ID',icon:'none'});return}
    if(!this.data.transferEnabled){wx.showToast({title:'提现服务暂不可用，请稍后重试',icon:'none'});return}
    const version=this._communityVersion
    wx.showModal({title:'确认提现',content:`收款账号：${masked(this.data.payeeUserId)}。提交后冻结对应问诊收入，审核通过后第5个工作日转入此支付宝账号。`,confirmText:'提交申请',success:result=>{if(result.confirm&&social.active(this,version))this.submit(amount)}})
  },
  async submit(amount){if(!social.active(this)||this.data.posting)return;const version=this._communityVersion
    if(!this._attempt||this._attempt.amountCents!==amount||this._attempt.payeeUserId!==this.data.payeeUserId)this._attempt={amountCents:amount,clientRequestId:social.requestId(),payeeUserId:this.data.payeeUserId}
    this.setData({posting:true})
    try{await api.withdraw(this._attempt);if(!social.active(this,version))return;this._attempt=null;this.setData({posting:false,amount:''});wx.showToast({title:'提现申请已提交',icon:'success'});await this.load()}
    catch(error){if(social.active(this,version))social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({posting:false})}
  },
  onBindPayee(event) {
    if (!social.active(this) || this.data.loading || this.data.posting || this._recipientDialog) return
    const no = String(event.currentTarget.dataset.order || '')
    const row = this.data.records.find(item => item.orderNo === no)
    if (!canEditRecipient(row)) return
    const version = this._communityVersion
    const dialog = { no, version }
    this._recipientDialog = dialog
    // 编辑当前提现记录，不使用上方“新申请”的收款账号代替。
    wx.showModal({
      title: row.payeeUserId ? '修改收款账号' : '补充收款账号',
      editable: true,
      placeholderText: '2088…',
      content: (this._recipientDrafts || {})[no] || row.payeeUserId || '',
      confirmText: '保存',
      success: async result => {
        if (this._recipientDialog !== dialog) return
        this._recipientDialog = null
        if (!result.confirm || !social.active(this, version) || this.data.posting || this.data.loading) return
        const payeeUserId = String(result.content || '').trim()
        if (!validPayee(payeeUserId)) {
          wx.showToast({ title: '请填写有效的支付宝用户ID', icon: 'none' }); return
        }
        const current = this.data.records.find(item => item.orderNo === no)
        if (!canEditRecipient(current)) {
          wx.showToast({ title: '该提现已开始出款或已结束，不能修改收款账号', icon: 'none' }); return
        }
        if (current.payeeUserId === payeeUserId) return
        this._recipientDrafts = { ...(this._recipientDrafts || {}), [no]: payeeUserId }
        this.setData({ posting: true })
        try {
          await api.withdrawalRecipient(no, { payeeUserId })
          if (!social.active(this, version)) return
          delete this._recipientDrafts[no]
          this.setData({ posting: false })
          wx.showToast({ title: '收款账号已更新', icon: 'success' })
          await this.load()
        } catch (error) {
          if (!social.active(this, version)) return
          this.setData({ posting: false })
          social.failure(this, error, version)
          // 编辑期间后台可能已开始发放，刷新后收起失效入口。
          if ([40000, 40400, 40900].includes(error.code) || [400, 404, 409].includes(error.statusCode)) await this.load()
        } finally {
          if (social.active(this, version)) this.setData({ posting: false })
        }
      },
      fail: () => { if (this._recipientDialog === dialog) this._recipientDialog = null }
    })
  },
  onRefresh(){return this.load(false,true)},
  onMore(){return this.load(true)},onRetry(){return this.load()},onReachBottom(){return this.load(true)},
  async onPullDownRefresh(){try{await this.onRefresh()}finally{wx.stopPullDownRefresh()}}
})
