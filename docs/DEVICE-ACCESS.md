# 用户端设备添加与管理

## 入口

- 底部 Tab「设备管理」→ `frontend/pages/devices/devices`：统一为「已绑定 + 待适配」布局（无设备时汇总为 0），确认绑定 / 同步 / 解绑。
- 记录页「绑定设备」或管理页「添加设备」→ 全屏 `frontend/pages/device-add/device-add`。导航标题为「添加设备」。

## 设备管理（已接服务端）

- 列表：`GET /api/v1/devices`，仅返回当前用户已绑定档案。
- 确认绑定：`POST /api/v1/devices/bind`，请求体 `{ deviceSn, provider, deviceName? }`。唯一认设备靠 `deviceSn`；选适配器用 `provider`（MOCK / HUAWEI / HEALTH_CONNECT / APPLE_HEALTH / NIGHTSCOUT）。
- 解绑：`POST /api/v1/devices/{id}/unbind`，清空 `user_id`，保留档案供管理端查看。
- 同步流水：`GET /api/v1/devices/{id}/sync-logs?limit=10`；详情弹层可展开查看近 10 次（时间、厂商、样本数、新建条数）。功能上线前的历史同步不会回填。
- 离线徽标：已绑定且 `lastSyncAt` 为空或超过 48 小时显示「已离线」。

## 同步总线（自研数据流）

读数不绑死厂家云。统一路径：

1. 小程序按 `provider` 选择 **Ingress（入口）** 得到 raw `payload`
2. `POST /api/v1/device/glucose-sync`，带 `provider` + 可选 `deviceSn`
3. 后端门禁（SN 归属 / 启用 / 厂商一致）→ 适配器转 `UnifiedGlucoseSample` → 按用户+日期+节点覆盖写入；带 `deviceSn` 成功时刷新 `last_sync_at` 并写 `device_sync_log`

| provider | 演示同步入口 |
| --- | --- |
| MOCK / HUAWEI / HEALTH_CONNECT / APPLE_HEALTH / NIGHTSCOUT | 设备页「同步记录」用 `buildRandomPayload` 生成该厂商形态随机样本后 `syncDeviceGlucose` |

说明：演示入口 **契约兼容** 各厂商适配器 payload，**不是** OAuth 直连厂家云。二期可将 Ingress 替换为 Nightscout URL 实拉、厂家云或 BLE，下游门禁与适配层无需改模型。

实现：`frontend/services/device-sim-generator.js`、`syncDeviceGlucose`、`pages/devices` 的 `onSync`；流水查询 `fetchDeviceSyncLogs`。

## 生成模拟数据

设备页按钮「生成模拟数据」：

1. 用户选择厂商（MOCK / HUAWEI / HEALTH_CONNECT / APPLE_HEALTH / NIGHTSCOUT）
2. 自动 `bind` 一台模拟设备：`deviceSn = SIM-{provider}-{...}`，名称如「模拟华为设备」
3. 按该厂商适配器格式 **随机** 生成 payload（`services/device-sim-generator.js`）
4. `syncDeviceGlucose` 入库并刷新列表

封装：`createSimDeviceAndSync(provider)`。演示用，非真表/真云。可多次生成多台。

## 添加页（准备阶段，仍有效）

- 卡通助手空状态；仅点击「搜索附近设备」后初始化 BLE，约 12 秒后停止。离页会停止并清理本页监听。
- 发现结果去重、按信号排序，最多 30 台。未知型号不声称是血糖仪，不自动连接。
- 扫码 / SN 登记进入会话内「待适配」列表（最多 20 台），**不写服务器**，重启或换账号会清空。不代表绑定成功。
- 管理页可对带 SN 的待适配项「确认绑定」后写入服务端；无 SN 的蓝牙候选须先在管理页点「补充 SN」，再确认绑定。

微信 API 参考：[蓝牙与扫码类型定义](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)。发布前配置隐私说明与相关 API 声明。

## 尚未实现

真实厂商 BLE 协议读数、厂家云 OAuth 代拉、Nightscout 用户自填 URL 实拉。读数进入九时段前仍须校验来源、单位与幂等；契约变更先更新 `backend/docs/API-CONTRACT.md`。

## 验证

- 空列表显示空状态；绑定后出现已绑定卡片与汇总。
- 待适配仍会话级；确认绑定后进入已绑定并从草稿消失。
- 解绑后列表更新；管理端仍能看到该 SN（`user_id` 空）。
- 任一已支持厂商点「同步记录」可写入血糖并更新 `lastSyncAt`。
- 解绑后设备从已绑定列表消失，可再「生成模拟数据」。
- 同步数次后进详情展开「同步记录」，可见最多 10 条流水（新→旧）。
- 「生成模拟数据」选任一厂商 → 新建设备并入库随机血糖。
- 本地测试（添加页）：`node --test tools/tests/device-add.test.cjs tools/tests/device-discovery.test.cjs`。
