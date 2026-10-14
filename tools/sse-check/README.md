# SSE 解析自检（frontend/utils/sse.js）

小程序的 SSE 客户端有两个容易静默出错的点：**chunk 边界切断多字节 UTF-8**、**chunk 边界切断事件行**。
出问题时表现是「中文乱码」或「回复卡住」，而这两种都很难在开发者工具里复现（模拟器通常把整个响应当一个 chunk 给过来）。

这里用**真实后端抓下来的 SSE 字节流**当夹具，在 Node 里把 `openSse` 的分片以任意粒度重放，验证解析无损。

## 运行

```bash
# 正常流：任意分片粒度下，delta 拼接结果必须等于 done.contentText
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin frontend 1
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin frontend 7
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin frontend 997

# 错误流：开流前的校验失败（HTTP 4xx + 统一 JSON）必须转成 onError 且 code/message 原样透出
node tools/sse-check/sse_err_harness.js tools/sse-check/fixtures/err404.bin frontend 404
node tools/sse-check/sse_err_harness.js tools/sse-check/fixtures/err401.bin frontend 401
```

`chunkSize = 1` 是最严苛的用例：每个多字节汉字都被拆到两个 chunk 里。

## 夹具怎么来的

`fixtures/sse_raw.bin` 是后端 `POST /api/v1/chat-sessions/{id}/completions` 的真实响应（`curl -N` 原样落盘，含 `:connected` 注释行、93 个 `delta`、1 个 `done`）。
`err404.bin` / `err401.bin` 是越权访问与未登录时的统一错误响应。

需要更新夹具时重新抓一次即可（换新会话、新 `clientMsgId`）：

```bash
curl -s -N -o tools/sse-check/fixtures/sse_raw.bin \
  -X POST "http://127.0.0.1:8080/api/v1/chat-sessions/<sid>/completions" \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  --data-binary '{"clientMsgId":"cap1","replyToMsgId":<msgId>,"stream":true}'
```

> 2026-10-13 三仓拆分后，本工具随前端仓走，位于 **`GlucoPilot-frontend/tools/sse-check/`**（原单仓时代的路径是 `project/tools/sse-check/`）。
> 之所以不放在 `frontend/` 子目录下，是为了**不被微信打包进小程序包**；拆仓后它的位置变成了仓根下的 `tools/`，
> 因此已在 `project.config.json` 的 `packOptions.ignore` 里加上 `tools` 目录（改动见同一次提交）。命令一律在**前端仓根目录**执行。
