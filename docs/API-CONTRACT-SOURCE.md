# 接口契约来源

权威仓库：https://github.com/xiaoyejinjier/GlucoPilot-backend
权威文件：docs/API-CONTRACT.md
调用方发布前应在验收记录中登记对应后端提交 SHA 和镜像标签。
用户端 /api/v1/**，管理端 /admin/v1/**；响应 { code, message, data, requestId }，成功码 0。

2026-10-20返回保护：发文返回时可选择放弃未保存修改或保存草稿后离开；保存失败保留编辑器。草稿/{id}/publish成功即关闭草稿，无需等待审核；拒绝后在我的文章修改重投，失败发布不关闭。小程序通过来源页事件即时移除同账号已发布草稿，服务端列表仍为最终数据源。接口及数据库结构不变。

2026-10-20修复：头像使用原bizType=1三步上传，仅登记返回的fileUrl可提交PATCH /users/me/profile，本地路径只预览；未修改头像省略avatarUrl，清空空串，上传失败/账号变化不提交旧文件。草稿500修复MySQL DATETIME的LocalDateTime/Timestamp兼容，接口与数据库结构不变；真实MySQL事务验证通过且已回滚。详见权威契约“个人头像与草稿修复”。

2026-10-20 V28：回复使用POST /news/{id}/comments/{targetId}/replies明确绑定评论；GET /community/tags/mine读取本人已用标签，GET /community/profiles/{key}/articles仅列已公开内容。投稿/草稿增加videoMediaIds，详情增加videos:[{mediaId}]，有有效媒体可空正文；视频bizType=8、MP4≤20MB，GET /community/article-videos/{mediaId}带Bearer下载临时播放，不经匿名对象地址。完整字段、所有权、幂等与审核约束见权威契约“回复、投稿媒体与用户主页”。

2026-10-20后续：V27新增本人/community/drafts草稿CRUD及/{id}/publish（revision/clientRequestId），保存不改变公开文章、发布仍进两级审核；/community/information/summary汇总私信及四类互动，/community/notifications按kind分页，/read通过kind/throughId仅标记本人已读。信息页分类为私信、点赞、收藏、收到的评论、新关注我的，记录页仅显示非零提醒。/data-export-tasks创建/历史、/{id}/generate生成、/{id}/file下载真实XLSX，所有C端操作限定本人，不使用演示内容。字段、权限、版本与幂等以权威契约“草稿箱、信息中心、真实导出与用户详情”为准。

2026-10-20：新增GET /community/messages/unread汇总本人全会话未读；前台轮询、不展示0，消息确认读后刷新。私信语音沿用/speech-transcriptions，确认后走原文本私信接口。投稿/编辑增加imageMediaIds（最多6张），媒体bizType=7；文章详情images含mediaId，通过带Token的/community/article-images/{mediaId}下载。V26及所有权、审核可见性、图片顺序/幂等语义见权威契约“私信提醒、语音表情及文章配图”。

2026-10-19 双账号：GET /users/me增加communityKey（本人公开社区号）；前端支持复制并按u开头社区号调用现有公开资料接口精确查找。微信登录JSON协议不变，后端支持真实code兑换，凭据仅服务端配置；相关启用边界见WECHAT-LOGIN.md。

2026-10-19 社区互动：沿用PUT /news/{id}/actions设置点赞/收藏；新增/community/profiles、following、collections、messages及/news/{id}/comments，详情增加author/commentCount。公开资料key以u/b区分C端用户/发布者；私信与评论用clientRequestId防重复，不传senderId。完整字段、权限、分页、幂等与V22迁移见权威契约“社区互动与用户私信”，联调步骤见COMMUNITY.md。

2026-10-19 小语简化：进入后仅使用POST /chat-sessions/current（不传forceNew）恢复当前对话，再通过GET /chat-sessions/{sessionId}/messages读取此前消息；保留同一对话内游标分页。用户端移除新建及自选历史列表流程，已有后端会话接口和数据不变。

2026-10-16 新增语音草稿：POST /speech-transcriptions，鉴权JSON请求`{audioBase64,format:"mp3",durationMs}`；MP3≤512KiB、500～60000ms，返回`{text}`。仅转写、不自动发送，用户审阅/修改后确认才走已有文本消息接口。详细限制和错误码见权威契约“小语语音转文字草稿”。需要配套更新后端。
