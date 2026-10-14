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

## 三仓结构（2026-10-13 起）

本仓是从原单仓的 `frontend/` 拆出来的独立仓库，与以下两仓配套：

| 仓库 | 内容 |
| --- | --- |
| [GlucoPilot-backend](https://github.com/xiaoyejinjier/GlucoPilot-backend) | Spring Boot API、数据库迁移；`docs/`（接口契约、部署手册、迁移手册、PRD）与生产编排也在该仓 |
| [GlucoPilot-admin](https://github.com/xiaoyejinjier/GlucoPilot-admin) | Vue 3 管理后台与 Nginx 网关 |
| **GlucoPilot-frontend**（本仓） | 微信小程序用户端 + `tools/sse-check/`（SSE 解析自检工具） |

跨端需求先改后端仓的 `docs/API-CONTRACT.md`，再实现调用方与服务端；本仓 `docs/API-CONTRACT-SOURCE.md`
保留为契约来源的记录。长期分支只有 `main`（集成）与 `release`（生产发布）。

## SSE 自检工具

小程序端无法在 CI 里跑，而 SSE 解析是最容易静默出错的一段（chunk 边界切断多字节 UTF-8、切断事件行、
切断 `\r\n` 行尾）。`tools/sse-check/` 用真实后端抓下来的字节流当夹具，在 Node 里按任意分片粒度重放
`utils/sse.js` 的解析逻辑。第二个参数是前端项目目录，拆仓后就是本仓根 `.`。**在本仓根目录执行**：

```bash
# 正常流：任意分片粒度下，delta 拼接结果必须等于 done.contentText
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin . 1
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin . 7
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin . 997

# 错误流：开流前的校验失败（HTTP 4xx + 统一 JSON）必须转成 onError 且 code/message 原样透出
node tools/sse-check/sse_err_harness.js tools/sse-check/fixtures/err404.bin . 404
node tools/sse-check/sse_err_harness.js tools/sse-check/fixtures/err401.bin . 401
```

这套自检在 2026-10-14 抓到过一个真实缺陷：换行归一化做在了逐块上，chunk 边界切开 `\r\n` 时
整条流一个事件都解析不出来（真机表现为"回答卡住不出字"）；修法与证据见
[`tools/sse-check/README.md`](./tools/sse-check/README.md)。
该目录原在单仓的 `project/tools/`，刻意放在 `frontend/` 之外以免被微信打包；拆仓后它落在本仓根的
`tools/`，因此已在 `project.config.json` 的 `packOptions.ignore` 里加上 `tools`，保持同一约束。
