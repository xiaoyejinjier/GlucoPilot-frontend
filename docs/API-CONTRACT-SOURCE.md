# 接口契约来源

权威仓库：https://github.com/xiaoyejinjier/GlucoPilot-backend
权威文件：docs/API-CONTRACT.md
调用方发布前应在验收记录中登记对应后端提交 SHA 和镜像标签。
用户端 /api/v1/**，管理端 /admin/v1/**；响应 { code, message, data, requestId }，成功码 0。

2026-10-27 本人点赞：GET /community/likes 需登录，支持 PageQuery 和可选 keyword（最多80字）；仅本人仍点赞且可读、已发布、未隐藏的文章，结构沿用收藏列表。复用 news_user_action，无迁移；区别于信息中心收到的点赞通知，详见权威契约“本人点赞列表”。

2026-10-26食品图片同步：用户端foods列表/详情imageUrl对AI_REVIEWED且上架的来源实拍优先返回/api/v1/foods/{foodId}/image；入口只读已审核公开食品，分类禁用/下架/删除立即404，no-store，不公开原健康媒体地址。分类仍共用food_category.image_url。两类相对地址每次按当前config.baseUrl解析；营养库进入/下拉刷新当前查询，空结果不补本地示例，失败提示重试，旧请求及旧图错误不覆盖新图。无新增数据库迁移。

2026-10-20返回保护：发文返回时可选择放弃未保存修改或保存草稿后离开；保存失败保留编辑器。草稿/{id}/publish成功即关闭草稿，无需等待审核；拒绝后在我的文章修改重投，失败发布不关闭。小程序通过来源页事件即时移除同账号已发布草稿，服务端列表仍为最终数据源。接口及数据库结构不变。

2026-10-20修复：头像使用原bizType=1三步上传，仅登记返回的fileUrl可提交PATCH /users/me/profile，本地路径只预览；未修改头像省略avatarUrl，清空空串，上传失败/账号变化不提交旧文件。草稿500修复MySQL DATETIME的LocalDateTime/Timestamp兼容，接口与数据库结构不变；真实MySQL事务验证通过且已回滚。详见权威契约“个人头像与草稿修复”。

2026-10-20 V35：回复使用POST /news/{id}/comments/{targetId}/replies明确绑定评论；GET /community/tags/mine读取本人已用标签，GET /community/profiles/{key}/articles仅列已公开内容。投稿/草稿增加videoMediaIds，详情增加videos:[{mediaId}]，有有效媒体可空正文；视频bizType=8、MP4≤20MB，GET /community/article-videos/{mediaId}带Bearer下载临时播放，不经匿名对象地址。完整字段、所有权、幂等与审核约束见权威契约“回复、投稿媒体与用户主页”。

2026-10-20后续：V34新增本人/community/drafts草稿CRUD及/{id}/publish（revision/clientRequestId），保存不改变公开文章、发布仍进两级审核；/community/information/summary汇总私信及四类互动，/community/notifications按kind分页，/read通过kind/throughId仅标记本人已读。信息页分类为私信、点赞、收藏、收到的评论、新关注我的，记录页仅显示非零提醒。/data-export-tasks创建/历史、/{id}/generate生成、/{id}/file下载真实XLSX，所有C端操作限定本人，不使用演示内容。字段、权限、版本与幂等以权威契约“草稿箱、信息中心、真实导出与用户详情”为准。

2026-10-20：新增GET /community/messages/unread汇总本人全会话未读；前台轮询、不展示0，消息确认读后刷新。私信语音沿用/speech-transcriptions，确认后走原文本私信接口。投稿/编辑增加imageMediaIds（最多6张），媒体bizType=7；文章详情images含mediaId，通过带Token的/community/article-images/{mediaId}下载。V33及所有权、审核可见性、图片顺序/幂等语义见权威契约“私信提醒、语音表情及文章配图”。

2026-10-19 双账号：GET /users/me增加communityKey（本人公开社区号）；前端支持复制并按u开头社区号调用现有公开资料接口精确查找。微信登录JSON协议不变，后端支持真实code兑换，凭据仅服务端配置；相关启用边界见WECHAT-LOGIN.md。

2026-10-19 社区互动：沿用PUT /news/{id}/actions设置点赞/收藏；新增/community/profiles、following、collections、messages及/news/{id}/comments，详情增加author/commentCount。公开资料key以u/b区分C端用户/发布者；私信与评论用clientRequestId防重复，不传senderId。完整字段、权限、分页、幂等与V29迁移见权威契约“社区互动与用户私信”，联调步骤见COMMUNITY.md。

2026-10-19 小语简化：进入后仅使用POST /chat-sessions/current（不传forceNew）恢复当前对话，再通过GET /chat-sessions/{sessionId}/messages读取此前消息；保留同一对话内游标分页。用户端移除新建及自选历史列表流程，已有后端会话接口和数据不变。

2026-10-16 新增语音草稿：POST /speech-transcriptions，鉴权JSON请求`{audioBase64,format:"mp3",durationMs}`；MP3≤512KiB、500～60000ms，返回`{text}`。仅转写、不自动发送，用户审阅/修改后确认才走已有文本消息接口。详细限制和错误码见权威契约“小语语音转文字草稿”。需要配套更新后端。

## 合入备注（邮箱登录 / 设备 payload）

权威契约见 backend 仓 `docs/API-CONTRACT.md`。邮箱：`POST /api/v1/auth/email/codes`、`POST /api/v1/auth/email/sessions`、`PATCH /api/v1/users/me/email`。设备同步请求体改为 `{ provider, deviceSn?, payload }`；MOCK 使用 `payload.readings`。
# 2026-10-26 推荐吃法预测曲线

权威契约见 backend/docs/API-CONTRACT.md“正餐推荐预测与实测血糖分离”。GET /api/v1/glucose-records/summary 的 week.points 新增 predictedAvg（可空）和 predictionCount（0–3）；前端映射为独立 predictedValue，实测 value/周摘要语义不变。推荐预测只取 predictSuggest；不足三餐按已有有效推荐预测取均值，无有效预测保留空值。记录页“已记”统计六个有效实测加三个已保存正餐，共九时段；曲线参考虚线依次连接早前实测→早后推荐预测→中前实测→中后推荐预测→晚前实测→晚后推荐预测，餐后使用白底空心点。缺失值跳过，不填零或回退餐后实测；没有正餐预测时不画参考虚线。周图继续连接预测日均值。

2026-10-26：正餐详情保留 mediaId，mediaUrl 改为 `/api/v1/meal-records/images/{mediaId}`，需本人 Bearer，照片组件从当前 API 下载临时图并预览，不直连私有 MinIO。确诊日期沿用 YYYY-MM，药物多选与其他备注合并到原 medication 字段；手机号行跳账号安全 `?bind=phone`，仍使用验证码绑定流程。
