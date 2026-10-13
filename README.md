# GlucoPilot 小程序独立仓库

使用微信开发者工具导入本仓库根目录，项目类型为小程序，使用团队授权的 AppID。
此项目无需依赖管理端或后端源码；接口配置唯一入口为 utils/config.js。

开发者工具控制台执行 `wx.setStorageSync('apiBaseUrl', 'https://api.example.com/api/v1')`，
将占位域名替换为运维提供的 HTTPS Nginx 入口，然后重新编译。
此值只对当前设备生效，正式发布前须由 utils/config.js 设置正式默认域名。
真机与生产环境应在微信公众平台登记 request、uploadFile、downloadFile 等实际使用的合法域名。
用户端 API 路径统一为 /api/v1/**。

## 发布

微信开发者工具执行编译、预览、真机测试；验证登录、数据读写及网络失败提示。
登记版本号、提交 SHA、后端契约版本，上传体验版供负责人验收。
验收后通过微信公众平台提交审核并发布；这不是 Docker 部署。
独立发布仍依赖已部署的 API；后端源码无需放在本仓库。
正式发布前确认 utils/config.js 的 fallbackLocal 策略，避免演示数据掩盖接口故障。
接口权威来源见 docs/API-CONTRACT-SOURCE.md。
