# SSE 解析自检（utils/sse.js）

小程序的 SSE 客户端有三个容易静默出错的点：**chunk 边界切断多字节 UTF-8**、**chunk 边界切断事件行**、
**chunk 边界切断 `\r\n` 行尾**。出问题时表现是「中文乱码」或「回复卡住」，而这三种都很难在开发者工具里复现
（模拟器通常把整个响应当一个 chunk 给过来）。

这里用**真实后端抓下来的 SSE 字节流**当夹具，在 Node 里把 `openSse` 的分片以任意粒度重放，验证解析无损。

## 运行

第二个参数是**前端项目目录**（harness 会去找 `<该目录>/utils/sse.js`）；拆仓后它就是本仓根目录 `.`。
在**前端仓根目录**执行：

```bash
# 正常流：任意分片粒度下，delta 拼接结果必须等于 done.contentText
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin . 1
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin . 7
node tools/sse-check/sse_harness.js tools/sse-check/fixtures/sse_raw.bin . 997

# 错误流：开流前的校验失败（HTTP 4xx + 统一 JSON）必须转成 onError 且 code/message 原样透出
node tools/sse-check/sse_err_harness.js tools/sse-check/fixtures/err404.bin . 404
node tools/sse-check/sse_err_harness.js tools/sse-check/fixtures/err401.bin . 401
```

`chunkSize = 1` 是最严苛的用例：每个多字节汉字、每一对 `\r\n` 都被拆到不同的 chunk 里。

### 这个自检抓到过的真实缺陷（2026-10-14）

`chunkSize=1` 时**一个事件都解析不出来**（`deltaEvents=0`），`chunkSize=7` 时中文文本比 `done.contentText`
少 18 个字。根因是 `sse.js` 的换行归一化做在了**逐块**上（`decoded.text.replace(/\r\n/g,'\n')`）：
chunk 边界正好落在 `\r` 与 `\n` 之间时，这一对永远拼不到一起，事件分隔符就一直是 `\r\n\r\n`，
而事件切分只认 `\n\n` —— 于是整条流被当成一个巨大的未闭合块丢掉。

真机上表现为「回答卡住不出字」，且只在 chunk 边界恰好切开 `\r\n` 时出现（低概率、难复现）。
修法：归一化移到**累积之后**，并保留结尾孤立的 `\r` 到下一块再判断（见 `utils/sse.js` 的 `normalizeNewlines`）。
修复后 1/2/3/5/7/13/64/997/4209 共 9 种分片粒度全部通过，93 个 delta 与 `done.contentText` 完全一致。

## 夹具怎么来的

`fixtures/sse_raw.bin` 是后端 `POST /api/v1/chat-sessions/{id}/completions` 的真实响应（`curl -N` 原样落盘，含 `:connected` 注释行、93 个 `delta`、1 个 `done`，行尾为 `\r\n`）。
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
> 因此已在 `project.config.json` 的 `packOptions.ignore` 里加上 `tools` 目录。
