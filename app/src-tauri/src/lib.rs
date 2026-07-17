mod hid;

use collector::types::{Config as CollectorConfig, Snapshot};
use collector::{activity, claude_quota, packet, snapshot};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub claude_daily_budget: u64,
    pub codex_daily_budget: u64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            claude_daily_budget: 5_000_000,
            codex_daily_budget: 5_000_000,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct KbState {
    pub mode: u8,
    pub source: u8,
    pub connected: bool,
    pub device_name: Option<String>,
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
            config: sh.config,
        }
    }

    fn push_data_packet(&self) {
        let sh = self.shared.lock().unwrap();
        let p = packet::build_data_packet(
            &sh.snapshot,
            sh.config.claude_daily_budget,
            sh.config.codex_daily_budget,
        );
        let _ = self.hid_tx.send(hid::Cmd::Send(p));
    }
}

#[tauri::command]
fn get_state(app: tauri::State<Arc<App>>) -> FullState {
    app.full_state()
}

#[tauri::command]
fn set_kb_state(app: tauri::State<Arc<App>>, mode: Option<u8>, source: Option<u8>) {
    let _ = app.hid_tx.send(hid::Cmd::SetState { mode, source });
    // 键盘断开时也更新本地状态,预览仍可用;连着时固件回报会再覆盖一次
    let mut sh = app.shared.lock().unwrap();
    if let Some(m) = mode {
        sh.kb.mode = m;
    }
    if let Some(s) = source {
        sh.kb.source = s;
    }
}

#[tauri::command]
fn set_config(app: tauri::State<Arc<App>>, handle: tauri::AppHandle, config: AppConfig) {
    {
        let mut sh = app.shared.lock().unwrap();
        sh.config = config;
    }
    if let Some(dir) = app.config_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(
        &app.config_path,
        serde_json::to_vec_pretty(&config).unwrap(),
    );
    app.push_data_packet();
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
                        activity::is_active(&claude_projects, activity::DEFAULT_THRESHOLD);
                    snap.codex.active =
                        activity::is_active(&codex_sessions, activity::DEFAULT_THRESHOLD);
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
                    app.push_data_packet();
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
            "quit" => handle.exit(0),
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
                            hid::Event::Connected(name) => {
                                sh.kb.connected = true;
                                sh.kb.device_name = name;
                            }
                            hid::Event::Disconnected => sh.kb.connected = false,
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
        .invoke_handler(tauri::generate_handler![get_state, set_kb_state, set_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
