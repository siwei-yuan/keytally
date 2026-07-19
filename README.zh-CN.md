<div align="center">

# ⌨️ KeyTally

**给你的 AI 装一盏 tally light——额度、消耗、工作状态,全在键盘灯上。**

Claude Code / Codex 的额度、今日消耗、实时活动,直接显示在任何 VIA/QMK 键盘的灯上。macOS 菜单栏常驻,NASApunk 风格界面。

[English](README.md) · [固件适配指南](firmware/README.zh-CN.md) · [HID 协议](docs/protocol.zh-CN.md)

<img src="docs/assets/ui-pro.png" alt="界面截图" width="820"/>

</div>

## 三种模式

- 🟢→🔴 **额度**:订阅套餐 5 小时窗口 / 周限额,绿到红渐变
- 📊 **今日消耗**:今天烧掉的 token 相对日预算的进度
- 🫁 **活动**:AI 干活时灯呼吸,空闲时恢复你自己的灯效
- 🔀 一个按键(或点击)在 Claude / Codex 之间切换

## 两档体验,插上自动识别

| | 🌍 通用模式 | 🚀 Pro 模式 |
|---|---|---|
| 适用 | 任何带灯的 VIA 键盘,零刷机即插即用——**充分测试仅覆盖[两把原生支持的键盘](#原生支持的键盘)** | 有社区固件的板子([适配指南](#社区适配你的键盘)) |
| 灯效 | 整板颜色映射用量 | 逐灯:进度条 + 数据源指示灯 |
| 键盘按键切换 | — | ✅ 可绑定,双向同步 |
| app 退出 | 重启键盘即还原 | 固件 60 秒自动恢复原灯效 |
| 灯位自定义 | — | **在 app 里点选/框选灯珠分配职责** |

安全性:通用模式所有写入不落 EEPROM,拔插即还原;Pro 刷机自动备份并写回 VIA 键位与宏,并尝试读出原厂固件供一键还原。

## 安装

**直接下载(macOS,Apple Silicon)**:去 [Releases](https://github.com/siwei-yuan/keytally/releases) 下 `.dmg`。暂未签名,首次启动右键 → 打开(或 `xattr -dr com.apple.quarantine /Applications/KeyTally.app`)。

**从源码构建**:

```sh
# 依赖:Rust(rustup.rs)+ Node 20+
git clone https://github.com/siwei-yuan/keytally
cd keytally/app
npm install
npm run tauri build    # 开发调试用 npm run tauri dev
```

- Pro 固件构建需要 QMK 工具链:`brew install qmk/qmk/qmk`,然后 `./firmware/build.sh`
- 事件级精准活动检测(可选):配置片段见 [hooks/README.md](hooks/README.md)

## 使用

1. 有线 USB 插入键盘(Raw HID 不走蓝牙)
2. app 自动探测并显示档位;选数据源和显示指标
3. 设置里配日预算、告警阈值、双源颜色
4. Pro 模式下,在键盘预览里点选或框选灯珠,给它们分配「进度条 / 源指示 / 不参与」

## 原生支持的键盘

**原生支持**——配列与灯位已标定、有 Pro 固件、经实机验证:

| 键盘 | 通用模式 | Pro 固件 |
|---|---|---|
| GrayStudio Think6.5 V3 | ✅ | ✅ STM32,QMK 主线 |
| Percent Skog Reboot | ✅ | ✅ AVR rev A/B,保留 BLE 双模,修正红绿字节序 |

**其他键盘**:通用模式按设计适用于任何带灯的 VIA 键盘,预览会回退到 QMK 数据库(按 VID/PID 收录 2677 块板)或键数探测——但上述两把以外的键盘**未经充分测试,具体效果未知**,需要有人标定并验证。UI 对此绝不含糊:每个预览都带数据来源标签——`已标定 · JSON`(橙)、`QMK 数据库`(绿)、`固件反推 · 示意`(灰)。

想让你的键盘被支持?两条路:

- **动手贡献**——按[下面的指南](#社区适配你的键盘)花约 2 分钟标定并 PR 一段 JSON,或者进一步做 Pro 固件移植。
- **开口提需求**——[提一个"键盘支持"issue](https://github.com/siwei-yuan/keytally/issues/new?title=Keyboard%20support%3A%20),写上键盘名和 USB ID(app 里预览标题旁的 ⓘ 弹层有个按钮,会自动带上这些信息)。

## 社区适配你的键盘

两级范式。都从查你键盘的 USB ID 开始:macOS 系统信息 → USB → 你的键盘 → *供应商 ID / 产品 ID*(4 位小写十六进制,如 `8101:5352`)。

### 第一级——标定配列与灯位(只写一段 JSON,不刷机)

在 [`app/src/profiles.json`](app/src/profiles.json) 加一条:

```jsonc
"8101:5352": {                          // "vid:pid",小写十六进制,补零到 4 位
  "name": "Percent Skog Reboot",        // 显示名
  "layout": "tkl87",                    // 配列模板:60 | 65 | tkl87 | 96 | 104
  "note": "可选的来源说明",
  "leds": [
    { "x": 15.4, "y": 4.0 },            // 0 号灯——键距坐标,face 缺省为 "top"
    { "x": 15.75, "y": 4.0 },           // 1 号灯……每颗一条,按链上顺序
    { "x": 8.0, "y": 6.2, "face": "bottom" }  // 侧/底灯:如实计数,不绘制
  ]
}
```

规则:

- **坐标单位是键距**(1u = 一个键帽)。原点在配列左上角的键;`x` 向右、`y` 向下,可用小数。**对照实机标定**,别信厂商宣传页。
- **`face`**:`"top"`(缺省,画在配列上)/ `"side"` / `"bottom"`(说明文字里如实计数,不绘制——画在配列平面上只对朝上的灯有意义)。
- **顺序 = WS2812 链上顺序,`face:"top"` 的灯排在前面。** 这样以后若有人做 Pro 固件,UI 灯珠索引与固件灯序天然对齐。

**合并后的效果**:所有插上这块板的用户都会看到真实配列 + 物理位置上的灯珠,打上 `已标定 · JSON` 标签——而不是一张灰色的反推示意图。若这块板以后有了 Pro 固件,逐灯角色编辑器直接复用这套坐标。

### 第二级——Pro 固件(逐灯控制)

把 `firmware/common/` 模块移植到你的板子(主线 QMK 板抄 `firmware/think65v3/`,厂商 fork 板抄 `firmware/skog_reboot/`),在 `app/src-tauri/src/flash.rs` 注册 VID/PID → 固件、`app/src/main.ts` 的 `PRO_BOARDS` 加同一 ID,提 PR。完整流程见[固件适配指南](firmware/README.zh-CN.md)。

**合并后的效果**:这块板在 app 里的「刷入 Pro 固件」按钮变为可用——一键自动备份 VIA 键位/宏、刷入、写回。用户获得逐灯进度条 + 源指示灯、键盘侧两个可绑定的切换键,以及 60 秒离线自愈(app 退出后自动恢复你自己的灯效)。

## 许可

`app/`、`collector/`、`hooks/`、`docs/` 为 MIT;`firmware/` 因派生自 QMK 为 GPL-2.0。
