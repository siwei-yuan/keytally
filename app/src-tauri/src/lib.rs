mod flash;
mod hid;

use collector::types::{Config as CollectorConfig, Snapshot};
use collector::{activity, claude_quota, packet, snapshot};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub claude_daily_budget: u64,
    pub codex_daily_budget: u64,
    /// 周限额告警阈值(%)
    pub warn_threshold: u8,
    /// 额度模式指标:0=5h 优先,1=周优先,2=两者取大
    pub quota_metric: u8,
    pub claude_color: String,
    pub codex_color: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            claude_daily_budget: 5_000_000,
            codex_daily_budget: 5_000_000,
            warn_threshold: 80,
            quota_metric: 0,
            claude_color: "#D97757".into(),
            codex_color: "#10A37F".into(),
        }
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct KbState {
    pub mode: u8,
    pub source: u8,
    pub connected: bool,
    pub device_name: Option<String>,
    /// "pro" = 本项目固件(逐灯);"via" = 通用 VIA 键盘(整板同色)
    pub backend: Option<String>,
    /// "rgblight"(灯带/徽章)| "rgb_matrix"(逐键)| "per-led"(Pro 固件)
    pub lighting: Option<String>,
    pub vid: u16,
    pub pid: u16,
}

/// "#RRGGBB" → QMK (hue, sat),解析失败用 Claude 默认色
fn hex_to_hs(hex: &str) -> (u8, u8) {
    let p = |i: usize| u8::from_str_radix(hex.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0) as f32 / 255.0;
    if !hex.starts_with('#') || hex.len() < 7 {
        return (13, 153);
    }
    let (r, g, b) = (p(1), p(3), p(5));
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let d = max - min;
    let h = if d == 0.0 { 0.0 }
        else if max == r { ((g - b) / d).rem_euclid(6.0) }
        else if max == g { (b - r) / d + 2.0 }
        else { (r - g) / d + 4.0 } / 6.0;
    let s = if max == 0.0 { 0.0 } else { d / max };
    ((h * 255.0) as u8, (s * 255.0) as u8)
}

/// 与 app 预览、Pro 固件一致的映射:模式+数据源 → 整板颜色
fn compute_via_look(snap: &Snapshot, kb: &KbState, cfg: &AppConfig) -> hid::ViaLook {
    let (u, budget) = if kb.source == 0 {
        (&snap.claude, cfg.claude_daily_budget)
    } else {
        (&snap.codex, cfg.codex_daily_budget)
    };
    let accent = hex_to_hs(if kb.source == 0 { &cfg.claude_color } else { &cfg.codex_color });
    let passthrough = hid::ViaLook { passthrough: true, ..Default::default() };
    if !u.valid {
        return passthrough;
    }
    // 0-100 → 绿(hue 85)→红(hue 0)
    let grade = |pct: u8| hid::ViaLook {
        hue: (85u16 * (100 - pct.min(100) as u16) / 100) as u8,
        sat: 255,
        ..Default::default()
    };
    match kb.mode {
        0 => {
            let pct = match cfg.quota_metric {
                1 => u.weekly_pct.or(u.five_hour_pct),
                2 => u.five_hour_pct.max(u.weekly_pct),
                _ => u.five_hour_pct.or(u.weekly_pct),
            };
            match pct {
                Some(pct) => hid::ViaLook {
                    blink_warn: u.weekly_pct.is_some_and(|w| w >= cfg.warn_threshold),
                    ..grade(pct)
                },
                None => passthrough,
            }
        }
        1 => {
            if budget == 0 {
                return passthrough;
            }
            let pct = ((u.today_tokens.saturating_mul(100)) / budget).min(100) as u8;
            grade(pct)
        }
        _ => {
            if u.active {
                hid::ViaLook { hue: accent.0, sat: accent.1, breathing: true, ..Default::default() }
            } else {
                passthrough
            }
        }
    }
}

#[derive(Default)]
struct Shared {
    snapshot: Snapshot,
    kb: KbState,
    config: AppConfig,
    /// 额度线程的缓存,文件扫描线程每轮合并进 snapshot
    claude_quota: (Option<u8>, Option<u8>),
}

struct App {
    shared: Mutex<Shared>,
    hid_tx: Sender<hid::Cmd>,
    config_path: PathBuf,
}

#[derive(Clone, Serialize)]
struct FullState {
    snapshot: Snapshot,
    kb: KbState,
    config: AppConfig,
}

impl App {
    fn full_state(&self) -> FullState {
        let sh = self.shared.lock().unwrap();
        FullState {
            snapshot: sh.snapshot,
            kb: sh.kb.clone(),
            config: sh.config.clone(),
        }
    }

    fn push_frame(&self) {
        let sh = self.shared.lock().unwrap();
        let frame = hid::Frame {
            pro: packet::build_data_packet(
                &sh.snapshot,
                sh.config.claude_daily_budget,
                sh.config.codex_daily_budget,
            ),
            via: compute_via_look(&sh.snapshot, &sh.kb, &sh.config),
        };
        let _ = self.hid_tx.send(hid::Cmd::Frame(frame));
    }
}

#[tauri::command]
fn get_state(app: tauri::State<Arc<App>>) -> FullState {
    app.full_state()
}

fn dump_keymap_blocking(app: &App) -> Result<(Vec<u8>, Vec<u8>), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.hid_tx.send(hid::Cmd::DumpKeymap(tx)).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|e| e.to_string())?
}

fn backup_path(app: &App) -> PathBuf {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    app.config_path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join(format!("keymap-backup-{ts}.bin"))
}

fn write_backup(app: &App, keymap: &[u8], macros: &[u8]) -> Result<PathBuf, String> {
    let path = backup_path(app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, keymap).map_err(|e| e.to_string())?;
    if !macros.is_empty() {
        let mp = path.with_extension("macros.bin");
        std::fs::write(mp, macros).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[tauri::command]
fn backup_keymap(app: tauri::State<Arc<App>>) -> Result<String, String> {
    let (keymap, macros) = dump_keymap_blocking(&app)?;
    let path = write_backup(&app, &keymap, &macros)?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn upgrade_to_pro(app: tauri::State<Arc<App>>, handle: tauri::AppHandle) -> Result<(), String> {
    let (vid, pid) = {
        let sh = app.shared.lock().unwrap();
        if !sh.kb.connected {
            return Err("键盘未连接".into());
        }
        (sh.kb.vid, sh.kb.pid)
    };
    let bin = flash::pro_firmware_bin(vid, pid).ok_or("该键盘暂无 Pro 固件(欢迎社区适配)")?;
    let app = app.inner().clone();
    std::thread::spawn(move || {
        let emit = |msg: &str| {
            let _ = handle.emit("pro-progress", msg.to_string());
        };
        let fail = |msg: String| {
            let _ = handle.emit("pro-progress", format!("❌ {msg}"));
        };
        emit("① 备份键位与宏…");
        let backup = match dump_keymap_blocking(&app) {
            Ok(d) => {
                if write_backup(&app, &d.0, &d.1).is_err() {
                    return fail("备份写盘失败,中止".into());
                }
                d
            }
            Err(e) => return fail(format!("备份失败,中止:{e}")),
        };
        emit("② 进入 bootloader…");
        let _ = app.hid_tx.send(hid::Cmd::BootloaderJump);
        std::thread::sleep(Duration::from_secs(2));
        emit("③ 等待 DFU 设备…");
        if let Err(e) = flash::wait_for_dfu(Duration::from_secs(30)) {
            return fail(e);
        }
        emit("④ 刷入 Pro 固件…(约 10 秒,勿拔线)");
        if let Err(e) = flash::dfu_flash(&bin) {
            return fail(e);
        }
        emit("⑤ 等待键盘重连…");
        let deadline = Instant::now() + Duration::from_secs(25);
        loop {
            {
                let sh = app.shared.lock().unwrap();
                if sh.kb.connected && sh.kb.backend.as_deref() == Some("pro") {
                    break;
                }
            }
            if Instant::now() > deadline {
                return fail("刷入后未检测到 Pro 固件;键盘若无反应请拔插一次".into());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        emit("⑥ 写回键位备份…");
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = app.hid_tx.send(hid::Cmd::RestoreKeymap(backup, tx));
        match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => emit("✅ 完成!已运行 Pro 固件,键位已恢复"),
            _ => emit("✅ 固件已刷入(键位写回失败,备份文件仍在,可在 VIA 里手动恢复)"),
        }
        app.push_frame();
    });
    Ok(())
}

#[tauri::command]
fn set_kb_state(app: tauri::State<Arc<App>>, mode: Option<u8>, source: Option<u8>) {
    {
        let mut sh = app.shared.lock().unwrap();
        if let Some(m) = mode {
            sh.kb.mode = m;
        }
        if let Some(s) = source {
            sh.kb.source = s;
        }
    }
    // Pro 固件持有自己的状态,同步过去(VIA 后端忽略);随后推新灯效帧
    let _ = app.hid_tx.send(hid::Cmd::SetState { mode, source });
    app.push_frame();
}

#[tauri::command]
fn set_config(app: tauri::State<Arc<App>>, handle: tauri::AppHandle, config: AppConfig) {
    {
        let mut sh = app.shared.lock().unwrap();
        sh.config = config.clone();
    }
    if let Some(dir) = app.config_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(
        &app.config_path,
        serde_json::to_vec_pretty(&config).unwrap(),
    );
    app.push_frame();
    let _ = handle.emit("state", app.full_state());
}

fn load_config(path: &PathBuf) -> AppConfig {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// 文件扫描线程:活动检测每 2 秒,完整扫描每 15 秒;有变化才推送/广播。
fn spawn_collector(handle: tauri::AppHandle, app: Arc<App>) {
    std::thread::Builder::new()
        .name("collector".into())
        .spawn(move || {
            let mut cfg = CollectorConfig::from_home();
            cfg.fetch_claude_quota = false; // 额度走独立线程
            let claude_projects = cfg.claude_dir.join("projects");
            let codex_sessions = cfg.codex_dir.join("sessions");
            let mut last_full = Instant::now() - Duration::from_secs(3600);
            loop {
                let mut snap;
                {
                    let sh = app.shared.lock().unwrap();
                    snap = sh.snapshot;
                }
                if last_full.elapsed() >= Duration::from_secs(15) {
                    last_full = Instant::now();
                    snap = snapshot::collect(&cfg);
                } else {
                    snap.claude.active =
                        activity::claude_active(&claude_projects, &activity::state_dir("claude"));
                    snap.codex.active =
                        activity::codex_active(&codex_sessions, &activity::state_dir("codex"));
                }
                let changed = {
                    let mut sh = app.shared.lock().unwrap();
                    let (fh, wk) = sh.claude_quota;
                    if fh.is_some() {
                        snap.claude.five_hour_pct = fh;
                    }
                    if wk.is_some() {
                        snap.claude.weekly_pct = wk;
                    }
                    let changed = snap != sh.snapshot;
                    sh.snapshot = snap;
                    changed
                };
                if changed {
                    app.push_frame();
                    let _ = handle.emit("state", app.full_state());
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        })
        .expect("spawn collector thread");
}

/// 额度线程:每 60 秒查一次 Claude OAuth usage(网络 + 钥匙串,慢,单独跑)。
fn spawn_quota(app: Arc<App>) {
    std::thread::Builder::new()
        .name("quota".into())
        .spawn(move || loop {
            match claude_quota::get() {
                Ok(q) => {
                    let mut sh = app.shared.lock().unwrap();
                    sh.claude_quota = (q.five_hour_pct, q.weekly_pct);
                }
                Err(e) => eprintln!("claude quota unavailable: {e}"),
            }
            std::thread::sleep(Duration::from_secs(60));
        })
        .expect("spawn quota thread");
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "打开面板", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|handle, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                // 先让 HID 线程恢复键盘原灯效再退出
                if let Some(app) = handle.try_state::<Arc<App>>() {
                    let _ = app.hid_tx.send(hid::Cmd::Shutdown);
                }
                std::thread::sleep(Duration::from_millis(400));
                handle.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (hid_tx, hid_rx) = std::sync::mpsc::channel();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |tauri_app| {
            let config_path = tauri_app
                .path()
                .app_config_dir()
                .expect("app config dir")
                .join("config.json");
            let app = Arc::new(App {
                shared: Mutex::new(Shared {
                    config: load_config(&config_path),
                    ..Default::default()
                }),
                hid_tx: hid_tx.clone(),
                config_path,
            });
            tauri_app.manage(app.clone());

            let handle = tauri_app.handle().clone();
            {
                let app = app.clone();
                let handle = handle.clone();
                hid::spawn(hid_rx, move |ev| {
                    {
                        let mut sh = app.shared.lock().unwrap();
                        match ev {
                            hid::Event::Connected { name, backend, lighting, vid, pid } => {
                                sh.kb.connected = true;
                                sh.kb.device_name = name;
                                sh.kb.backend = Some(backend.to_string());
                                sh.kb.lighting = Some(lighting.to_string());
                                sh.kb.vid = vid;
                                sh.kb.pid = pid;
                            }
                            hid::Event::Disconnected => {
                                sh.kb.connected = false;
                                sh.kb.backend = None;
                            }
                            hid::Event::State(m, s) => {
                                sh.kb.mode = m;
                                sh.kb.source = s;
                            }
                        }
                    }
                    let _ = handle.emit("state", app.full_state());
                });
            }
            spawn_collector(handle, app.clone());
            spawn_quota(app);

            setup_tray(tauri_app)?;
            #[cfg(target_os = "macos")]
            tauri_app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗 = 收进托盘,app 继续常驻
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![get_state, set_kb_state, set_config, backup_keymap, upgrade_to_pro])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
