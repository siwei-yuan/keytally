> **Historical archive** — the original design document (Chinese). Current behavior is documented in the READMEs and docs/protocol.md.

# QMK Usage Lights — 设计文档

日期:2026-07-17
状态:已获用户批准

## 目标

让支持 QMK 的键盘用 RGB 灯组实时反映 Claude Code / Codex 的用量。Mac 菜单栏常驻小
app 采集数据并通过 Raw HID 推送给键盘;键盘固件负责渲染灯效;app 内置键盘灯组的
实时预览 UI。

## 需求(已确认)

- 三种显示模式,可自由切换:
  1. **额度模式**:订阅套餐的 5 小时窗口 / 周限额百分比(即 `/usage` 显示的数据)
  2. **今日消耗模式**:今天烧掉的 token,按可配置「日预算」映射为 0–100%
  3. **实时活动模式**:AI 正在干活时灯呼吸/流动,空闲恢复正常灯效
- Claude 和 Codex 都要支持,但一次只显示一家,可切换。
- 切换方式:键盘按键 **和** app UI 都可以,双向同步。
- app 要有 UI:选择数据源/模式,并**按真实布局显示键盘灯组的实时预览**。
- 用户键位用 VIA 配置 → 自定义固件必须保留 VIA 支持。
- 键盘当前未插;插上后确认型号再落地 keymap(有线 USB 是 Raw HID 的前提)。

## 技术选型(已确认)

- Mac 端:**Tauri 2** 菜单栏 app。Rust 后端(hidapi + 数据采集),Web 前端(键盘
  预览 + 控制面板)。需要安装 Rust 工具链(机器上现有 Node 26,无 Rust)。
- 键盘端:自定义 QMK keymap,保留 VIA。
- 工程位置:`~/Projects/qmk-usage-lights/`,独立 git repo。

## 架构

```
┌─ Mac 菜单栏 App (Tauri 2) ─────────────┐      ┌─ QMK 键盘 ──────────────┐
│ Rust 后端:                             │      │ 自定义固件 (保留 VIA):   │
│  · 采集器: Claude OAuth 额度接口        │ Raw  │  · raw HID 收数据/控制   │
│           ~/.claude + ~/.codex 日志解析 │ HID  │  · 持有当前 模式+数据源  │
│           活动检测 (会话文件 mtime)      │ ⇄    │  · rgb_matrix 指示灯渲染 │
│  · hidapi 推送数据包 (~2s/15s 两档)     │      │  · 2 个自定义键: 切模式/  │
│ 前端小窗口:                            │      │    切数据源 (VIA 可绑)   │
│  · 键盘灯组实时预览 (QMK info.json 绘制)│      │  · 60s 无包→恢复正常灯效 │
│  · 源/模式切换 + usage 数值面板         │      └─────────────────────────┘
└────────────────────────────────────────┘
```

关键点:

1. **数据包携带全部数据**:两家 × (5h 额度%、周额度%、今日消耗%、活动位) 全部塞进
   一个 32 字节报文。固件端持有「当前模式 + 数据源」状态并自行选择渲染内容,切换
   零延迟,daemon 无状态。
2. **双向同步**:UI 切换 → 发控制包给固件;键盘按键切换 → 固件回发状态包 → UI 跟随。
   固件是模式/数据源状态的唯一持有者(single source of truth)。
3. **预览即所亮**:灯效映射逻辑只在 Rust 实现一份,前端通过 Tauri command 调用同一
   映射函数取得各 LED 颜色 → UI 预览和实体键盘渲染一致;不插键盘也能调试灯效。
4. **容错**:固件侧 60 秒收不到数据包即撤销所有灯光覆盖,恢复用户原 RGB 灯效。
   拔线/没开 app/关机零副作用。

## 数据源

| 数据 | Claude | Codex |
|------|--------|-------|
| 额度 (5h/周 %) | OAuth usage 接口(凭证读 macOS 钥匙串 `Claude Code-credentials`),即 `/usage` 背后数据 | `~/.codex/sessions/**/*.jsonl` 最新 `rate_limits` 事件(primary/secondary percent_used) |
| 今日 token | 解析 `~/.claude/projects/**/*.jsonl` 的 usage 字段,按本地时区聚合当天 | 解析 codex 会话日志 token_count 事件聚合当天 |
| 活动状态 | 最新会话文件 mtime 距今 < ~10s | 同左 |

- 轮询节奏:额度/今日消耗每 ~15s;活动检测每 ~2s。
- 「今日消耗」百分比 = 当日 token / 日预算(app 设置项,默认值实现时定)。
- 实现时需验证:OAuth 端点的确切 URL/响应结构;钥匙串访问会触发一次授权弹窗。
- 数据不可用时置 0xFF(unknown),固件渲染为灰暗色。

## HID 协议

- 通道:QMK Raw HID(usage page `0xFF60`,usage `0x61`,32 字节报文)。
- **VIA 共存**:VIA 也走同一通道,但其协议对未识别的命令 ID 会调用
  `raw_hid_receive_kb()` → 自定义命令用 VIA 不占用的 ID,双方互不干扰。
- 命令(byte 0):
  - `0xC5` host→kb 数据推送:`[0xC5, ver, c_5h, c_wk, c_today, c_active, x_5h, x_wk, x_today, x_active, seq, pad...]`(百分比 0–100,0xFF=unknown)
  - `0xC6` host→kb 控制:`[0xC6, ver, mode, source]`(0xFF = 不改)
  - `0xC7` kb→host 状态通知:`[0xC7, ver, mode, source]`(按键切换后固件主动发;app 启动时也可发 0xC6 全 0xFF 查询触发回报)
- 协议版本字段 ver=1,双方不匹配时忽略报文。

## 固件(QMK keymap)

- 基于目标键盘现有 QMK 支持新增 keymap(型号待键盘插上确认;需其在 QMK 仓库有
  `rgb_matrix` 支持)。
- `raw_hid_receive_kb()` 收包存状态;记录最后收包时间,超 60s 停止覆盖。
- `rgb_matrix_indicators_advanced_user()` 渲染,仅覆盖指示用 LED,其余保持用户灯效:
  - **额度模式**:数字排 = 5h 窗口 10 段进度条(绿→黄→红渐变);F 区 = 周限额同款。
  - **今日消耗模式**:数字排进度条,蓝→紫渐变(与额度模式区分)。
  - **活动模式**:活动时全键盘呼吸/波浪叠加,空闲时不覆盖。
  - **源指示**:Esc 灯,Claude = 珊瑚橙 (#D97757),Codex = 青色。
  - 具体键位映射待型号确认后微调。
- 2 个自定义键码(QK_KB 区,VIA 可绑定):`切模式`、`切数据源`。状态存 RAM,
  默认 Claude + 额度模式。
- 保留 VIA(`VIA_ENABLE = yes`),用户刷机后用 VIA 重配键位。

## Mac App(Tauri 2)

- 菜单栏 tray 图标 + 点击弹出小窗口:
  - 键盘预览:按目标键盘 `info.json` 的 LED 物理坐标绘制,颜色来自 Rust 映射函数
    (Tauri command),随数据/模式实时更新。
  - 控制:数据源切换、模式切换(与键盘双向同步)。
  - 数值面板:两家的 5h/周/今日数值明细。
  - 设置:日预算、轮询间隔、开机自启(tauri autostart 插件)。
- 后端任务:采集循环 → 组包 → hidapi 写入;监听 HID 读取固件状态通知 → 事件推给前端。
- 键盘热插拔:定期重扫设备,断开后静默重连。

## 测试

- Rust 单元测试:日志解析器(fixture 样本)、包编解码、灯效映射函数。
- 集成验证:daemon dry-run 模式打印待发包;固件端 QMK console 调试输出。
- UI 预览本身就是端到端验证工具(预览 = 固件渲染的孪生)。

## 风险

- OAuth usage 端点非公开 API,可能变动 → 失败时该项显示 unknown,不影响其他模式。
- 键盘若为无线型号,Raw HID 仅在有线模式可用。
- 型号未知 → keymap 和预览布局延后到步骤 ③。

## 实施顺序

1. 装 Rust 工具链 + 项目骨架(Tauri 2 scaffold)
2. Rust 采集器(CLI 验证三类数据都能拿到)
3. 键盘插上 → 确认型号、QMK 支持、LED 布局
4. QMK keymap(HID 协议 + 灯效渲染 + 自定义键码 + VIA)
5. Tauri UI(预览 + 控制 + 设置)
6. 联调、开机自启、打包
