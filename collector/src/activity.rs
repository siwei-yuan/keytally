//! 活动检测:会话日志最近有写入 = 正在干活。

use std::path::Path;
use std::time::{Duration, SystemTime};

pub const DEFAULT_THRESHOLD: Duration = Duration::from_secs(10);

pub fn latest_jsonl_mtime(dir: &Path) -> Option<SystemTime> {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
        .max()
}

pub fn is_active(dir: &Path, threshold: Duration) -> bool {
    latest_jsonl_mtime(dir)
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < threshold)
}

/// hook 状态目录(app 与 hooks/*.sh 共用的固定路径)
pub fn state_dir(source: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var_os("HOME").expect("HOME"))
        .join("Library/Application Support/com.ysw.qmk-usage-lights/state")
        .join(source)
}

/// Claude:hook 事件精准状态。Some(busy) = 有新鲜 hook 数据;None = 没装 hook,回退 mtime。
pub fn claude_hook_active(dir: &Path) -> Option<bool> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut any = false;
    let mut busy = false;
    for e in entries.flatten() {
        let Ok(md) = e.metadata() else { continue };
        let fresh = md
            .modified()
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age < Duration::from_secs(30 * 60)); // 崩溃残留保护
        if !fresh {
            continue;
        }
        any = true;
        if std::fs::read_to_string(e.path()).is_ok_and(|c| c.trim() == "busy") {
            busy = true;
        }
    }
    any.then_some(busy)
}

/// Codex:notify 只有「turn 结束」事件 → busy 仍靠 mtime,notify 标记让空闲立即生效。
pub fn codex_active(sessions_dir: &Path, state_dir: &Path) -> bool {
    let Some(last_write) = latest_jsonl_mtime(sessions_dir) else {
        return false;
    };
    let mtime_fresh = SystemTime::now()
        .duration_since(last_write)
        .is_ok_and(|age| age < DEFAULT_THRESHOLD);
    if !mtime_fresh {
        return false;
    }
    // notify 空闲标记比最后一次会话写入还新 → turn 已结束
    let idle_after = std::fs::metadata(state_dir.join("notify"))
        .and_then(|m| m.modified())
        .is_ok_and(|t| t > last_write);
    !idle_after
}

pub fn claude_active(projects_dir: &Path, state_dir: &Path) -> bool {
    claude_hook_active(state_dir).unwrap_or_else(|| is_active(projects_dir, DEFAULT_THRESHOLD))
}
