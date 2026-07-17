# qmk-usage-lights

让 QMK 键盘的 RGB 灯组实时反映 Claude Code / Codex 的用量。

Mac 菜单栏常驻小 app(Tauri 2)采集数据,通过 Raw HID 推送给键盘;键盘固件渲染灯效;
app 内置按真实布局绘制的键盘灯组实时预览,源/模式可在 UI 或键盘按键上切换,双向同步。

## 三种显示模式

1. **额度**:订阅套餐 5 小时窗口 / 周限额百分比,绿→黄→红进度条
2. **今日消耗**:今天烧掉的 token 相对「日预算」的百分比
3. **实时活动**:AI 正在干活时呼吸/流动,空闲恢复正常灯效

数据源 Claude / Codex 一次显示一家,可切换。

## 目录结构

```
app/        Tauri 2 菜单栏 app(Rust 后端 + Web 前端预览)
firmware/   QMK keymap 源码(保留 VIA)
docs/       设计文档与 HID 协议规范
```

- 设计文档:[docs/specs/2026-07-17-qmk-usage-lights-design.md](docs/specs/2026-07-17-qmk-usage-lights-design.md)
- HID 协议:[docs/protocol.md](docs/protocol.md)

## 开发

```sh
cd app && npm install && npm run tauri dev
```

固件构建见 `firmware/README.md`(待键盘型号确认后补充)。
