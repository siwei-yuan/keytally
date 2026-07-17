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
