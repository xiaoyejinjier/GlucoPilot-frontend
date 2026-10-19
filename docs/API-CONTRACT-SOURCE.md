# 接口契约来源

权威仓库：https://github.com/xiaoyejinjier/GlucoPilot-backend
权威文件：docs/API-CONTRACT.md
调用方发布前应在验收记录中登记对应后端提交 SHA 和镜像标签。
用户端 /api/v1/**，管理端 /admin/v1/**；响应 { code, message, data, requestId }，成功码 0。

## 合入备注（邮箱登录 / 设备 payload）

权威契约见 backend 仓 `docs/API-CONTRACT.md`。邮箱：`POST /api/v1/auth/email/codes`、`POST /api/v1/auth/email/sessions`、`PATCH /api/v1/users/me/email`。设备同步请求体改为 `{ provider, deviceSn?, payload }`；MOCK 使用 `payload.readings`。
