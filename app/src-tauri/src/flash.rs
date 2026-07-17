//! Pro 固件一键升级:VIA 0x0B 进 DFU → dfu-util 刷入 → 等重连 → 写回键位。
//! 固件按 VID/PID 注册;开源后社区可为自己的板子添加条目。

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const DFU_UTIL: &str = "/opt/homebrew/bin/dfu-util";

/// 已适配 Pro 固件的键盘注册表
pub fn pro_firmware_bin(vid: u16, pid: u16) -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    match (vid, pid) {
        // GrayStudio Think6.5 V3
        (0x4753, 0x4003) => {
            let p = home.join("qmk_firmware/gray_studio_think65v3_usage_lights.bin");
            p.exists().then_some(p)
        }
        _ => None,
    }
}

pub fn wait_for_dfu(timeout: Duration) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let out = Command::new(DFU_UTIL).arg("-l").output().map_err(|e| e.to_string())?;
        if String::from_utf8_lossy(&out.stdout).contains("Found DFU") {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("等待 DFU 设备超时(键盘未进入 bootloader)".into())
}

pub fn dfu_flash(bin: &PathBuf) -> Result<(), String> {
    let out = Command::new(DFU_UTIL)
        .args(["-a", "0", "-s", "0x08000000:leave", "-D"])
        .arg(bin)
        .output()
        .map_err(|e| format!("dfu-util 启动失败: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if text.contains("File downloaded successfully") || out.status.success() {
        Ok(())
    } else {
        Err(format!("刷入失败: {}", text.lines().rev().take(4).collect::<Vec<_>>().join(" / ")))
    }
}

/// 从芯片读出当前(原厂)固件存档;RDP 读保护开启时会失败
pub fn dfu_backup(dest: &PathBuf) -> Result<(), String> {
    let out = Command::new(DFU_UTIL)
        .args(["-a", "0", "-s", "0x08000000:0x20000", "-U"])
        .arg(dest)
        .output()
        .map_err(|e| e.to_string())?;
    let ok = dest.exists() && std::fs::metadata(dest).map(|m| m.len() > 1024).unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(format!(
            "读出失败(可能开启了读保护): {}",
            String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")
        ))
    }
}

pub fn stock_backup_path(config_dir: &std::path::Path) -> PathBuf {
    config_dir.join("stock-firmware.bin")
}

/// 还原目标:优先原厂存档,否则纯净 VIA 固件(功能等同出厂)
pub fn restore_target(config_dir: &std::path::Path, vid: u16, pid: u16) -> Option<(PathBuf, &'static str)> {
    let stock = stock_backup_path(config_dir);
    if stock.exists() {
        return Some((stock, "原厂固件存档"));
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    match (vid, pid) {
        (0x4753, 0x4003) => {
            let p = home.join("qmk_firmware/gray_studio_think65v3_via_plain.bin");
            p.exists().then_some((p, "纯净 VIA 固件(等同出厂功能)"))
        }
        _ => None,
    }
}
