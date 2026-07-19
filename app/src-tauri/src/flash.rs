//! Pro 固件一键升级:VIA 0x0B 进 DFU → 按板选择刷机工具刷入 → 等重连 → 写回键位。
//! 固件按 VID/PID 注册;开源后社区可为自己的板子添加条目。
//!
//! 刷机方法:
//! - STM32(如 Think6.5 V3):dfu-util,.bin 写 0x08000000
//! - AVR(如 Skog Reboot,at90usb 系列):dfu-programmer,.hex;
//!   同型号可能有多个 rev(不同芯片),刷机时逐个探测在 DFU 中的芯片型号

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const DFU_UTIL: &str = "/opt/homebrew/bin/dfu-util";
const DFU_PROGRAMMER: &str = "/opt/homebrew/bin/dfu-programmer";

/// 一次刷机任务:目标文件 + 使用的工具
pub enum FlashJob {
    /// dfu-util,.bin @ 0x08000000
    Stm32Bin(PathBuf),
    /// dfu-programmer,候选 (芯片型号, .hex);刷机时探测实际芯片
    AvrHex(Vec<(&'static str, PathBuf)>),
}

fn existing(p: PathBuf) -> Option<PathBuf> {
    p.exists().then_some(p)
}

/// 已适配 Pro 固件的键盘注册表
pub fn pro_firmware(vid: u16, pid: u16) -> Option<FlashJob> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    match (vid, pid) {
        // GrayStudio Think6.5 V3(STM32F072)
        (0x4753, 0x4003) => {
            existing(home.join("qmk_firmware/gray_studio_think65v3_usage_lights.bin"))
                .map(FlashJob::Stm32Bin)
        }
        // Percent Skog Reboot(BIOI;rev_a=at90usb646 / rev_b=at90usb1286)
        (0x8101, 0x5352) => {
            let cands: Vec<_> = [
                ("at90usb646", "qmk_firmware-bioi/bioi_skog_reboot_rev_a_usage_lights.hex"),
                ("at90usb1286", "qmk_firmware-bioi/bioi_skog_reboot_rev_b_usage_lights.hex"),
            ]
            .into_iter()
            .filter_map(|(mcu, rel)| existing(home.join(rel)).map(|p| (mcu, p)))
            .collect();
            (!cands.is_empty()).then_some(FlashJob::AvrHex(cands))
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

/// 按任务类型刷入(设备须已在 DFU 模式)
pub fn flash(job: &FlashJob) -> Result<(), String> {
    match job {
        FlashJob::Stm32Bin(bin) => dfu_flash(bin),
        FlashJob::AvrHex(cands) => avr_flash(cands),
    }
}

fn dfu_flash(bin: &PathBuf) -> Result<(), String> {
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

/// 探测 DFU 中的 AVR 芯片型号,选对应 hex 刷入
fn avr_flash(cands: &[(&'static str, PathBuf)]) -> Result<(), String> {
    let (mcu, hex) = cands
        .iter()
        .find(|(mcu, _)| {
            Command::new(DFU_PROGRAMMER)
                .args([mcu, "get", "bootloader-version"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            format!(
                "未探测到匹配的 AVR 芯片(候选:{})",
                cands.iter().map(|(m, _)| *m).collect::<Vec<_>>().join(", ")
            )
        })?;

    let run = |args: &[&str]| -> (bool, String) {
        match Command::new(DFU_PROGRAMMER).args(args).output() {
            Ok(o) => (
                o.status.success(),
                format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)),
            ),
            Err(e) => (false, e.to_string()),
        }
    };

    // 已是空片时 erase 可能报"already blank",不作为失败;真正把关的是 flash 一步
    let _ = run(&[mcu, "erase", "--force"]);
    let hex_s = hex.to_string_lossy().into_owned();
    let (ok, log) = run(&[mcu, "flash", &hex_s]);
    if !ok {
        return Err(format!("刷入失败: {}", log.lines().rev().take(4).collect::<Vec<_>>().join(" / ")));
    }
    // 重启进入应用固件;老版 dfu-programmer 叫 reset。都失败也无妨(拔插即可)
    let (ok, _) = run(&[mcu, "launch"]);
    if !ok {
        let _ = run(&[mcu, "reset"]);
    }
    Ok(())
}

/// 从芯片读出当前(原厂)固件存档;仅 STM32 路径支持(RDP 读保护开启时会失败)
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

/// 还原目标:优先原厂固件(芯片存档或官方发布),否则纯净 VIA 固件(功能等同出厂)
pub fn restore_target(config_dir: &std::path::Path, vid: u16, pid: u16) -> Option<(FlashJob, &'static str)> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    match (vid, pid) {
        (0x4753, 0x4003) => {
            let stock = stock_backup_path(config_dir);
            if stock.exists() {
                return Some((FlashJob::Stm32Bin(stock), "原厂固件存档"));
            }
            existing(home.join("qmk_firmware/gray_studio_think65v3_via_plain.bin"))
                .map(|p| (FlashJob::Stm32Bin(p), "纯净 VIA 固件(等同出厂功能)"))
        }
        // Skog Reboot:官方 v1.2 发布固件(scottywei/percent-skog-reboot Releases),
        // 预先放到 <config>/stock/ 下;ANSI 6.25u 版。hex 对两种 rev 通用性由芯片探测把关
        (0x8101, 0x5352) => {
            let hex = config_dir.join("stock/bioi_skog_reboot_ansi_625u_via.hex");
            hex.exists().then(|| {
                (
                    FlashJob::AvrHex(vec![("at90usb646", hex.clone()), ("at90usb1286", hex)]),
                    "官方 v1.2 固件(ANSI 6.25u)",
                )
            })
        }
        _ => None,
    }
}
