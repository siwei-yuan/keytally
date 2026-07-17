//! 解析 ~/.codex/sessions/**/rollout-*.jsonl。
//!
//! 事件行结构:
//! `{"timestamp":"2026-07-15T17:01:39.328Z","type":"event_msg","payload":{
//!     "type":"token_count",
//!     "info":{"total_token_usage":{...},"last_token_usage":{...}},
//!     "rate_limits":{"primary":{"used_percent":1.0,"window_minutes":10080,...},"secondary":null}}}`

use chrono::{DateTime, Utc};
use serde_json::Value;
use std::io::BufRead;
use std::path::Path;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct RateLimits {
    pub five_hour_pct: Option<u8>,
    pub weekly_pct: Option<u8>,
}

fn clamp_pct(v: f64) -> u8 {
    v.max(0.0).min(100.0).round() as u8
}

/// 按 window_minutes 把一个限额窗口归入 5 小时槽或周槽。
fn slot_window(rl: &mut RateLimits, win: &Value) {
    let (Some(pct), Some(minutes)) = (
        win.get("used_percent").and_then(Value::as_f64),
        win.get("window_minutes").and_then(Value::as_f64),
    ) else {
        return;
    };
    if minutes <= 600.0 {
        rl.five_hour_pct = Some(clamp_pct(pct));
    } else {
        rl.weekly_pct = Some(clamp_pct(pct));
    }
}

fn token_count_payload(line: &str) -> Option<Value> {
    if !line.contains("token_count") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let payload = v.get("payload")?;
    if payload.get("type")?.as_str()? != "token_count" {
        return None;
    }
    let ts = v.get("timestamp").cloned().unwrap_or(Value::Null);
    let mut p = payload.clone();
    p["timestamp"] = ts;
    Some(p)
}

pub fn parse_rate_limits_line(line: &str) -> Option<RateLimits> {
    let payload = token_count_payload(line)?;
    let limits = payload.get("rate_limits")?;
    let mut rl = RateLimits::default();
    for key in ["primary", "secondary"] {
        if let Some(win) = limits.get(key) {
            slot_window(&mut rl, win);
        }
    }
    (rl.five_hour_pct.is_some() || rl.weekly_pct.is_some()).then_some(rl)
}

/// 取 reader 中最后一条 rate_limits。
pub fn last_rate_limits<R: BufRead>(r: R) -> Option<RateLimits> {
    r.lines()
        .map_while(Result::ok)
        .filter_map(|l| parse_rate_limits_line(&l))
        .last()
}

/// 计费口径:非缓存输入 + 输出。
fn billable(total: &Value) -> u64 {
    let get = |k: &str| total.get(k).and_then(Value::as_u64).unwrap_or(0);
    get("input_tokens").saturating_sub(get("cached_input_tokens")) + get("output_tokens")
}

/// 会话文件里 total_token_usage 是累计值;今日消耗 = 最后一条 − 今日零点前最后一条,
/// 这样跨天挂着的会话也能算对。
pub fn today_tokens<R: BufRead>(r: R, today_start: DateTime<Utc>) -> u64 {
    let mut before: Option<u64> = None;
    let mut last: Option<u64> = None;
    for line in r.lines().map_while(Result::ok) {
        let Some(payload) = token_count_payload(&line) else {
            continue;
        };
        let Some(total) = payload.get("info").and_then(|i| i.get("total_token_usage")) else {
            continue;
        };
        let cum = billable(total);
        let ts = payload
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&Utc));
        match ts {
            Some(t) if t < today_start => before = Some(cum),
            _ => {}
        }
        last = Some(cum);
    }
    match (before, last) {
        (Some(b), Some(l)) => l.saturating_sub(b),
        (None, Some(l)) => l,
        _ => 0,
    }
}

/// 扫描 sessions 目录:额度取最新会话的最后一条 rate_limits;
/// 今日消耗对所有今天动过的文件求和。
pub fn scan(sessions_dir: &Path, today_start: DateTime<Utc>) -> (Option<RateLimits>, u64) {
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = walkdir::WalkDir::new(sessions_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| (t, e.into_path())))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0)); // 新 → 旧

    let today_start_sys: std::time::SystemTime = std::time::SystemTime::from(today_start);

    let mut limits = None;
    let mut tokens = 0u64;
    for (mtime, path) in &files {
        let is_today = *mtime >= today_start_sys;
        if limits.is_some() && !is_today {
            break; // 额度已拿到,更旧的文件也不可能有今日消耗
        }
        let Ok(f) = std::fs::File::open(path) else {
            continue;
        };
        let reader = std::io::BufReader::new(f);
        if is_today {
            // 一次读取同时拿两样,避免重复扫大文件
            let mut before: Option<u64> = None;
            let mut last: Option<u64> = None;
            let mut file_limits = None;
            for line in reader.lines().map_while(Result::ok) {
                if let Some(rl) = parse_rate_limits_line(&line) {
                    file_limits = Some(rl);
                }
                let Some(payload) = token_count_payload(&line) else {
                    continue;
                };
                let Some(total) = payload.get("info").and_then(|i| i.get("total_token_usage")) else {
                    continue;
                };
                let cum = billable(total);
                let ts = payload
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| t.with_timezone(&Utc));
                if matches!(ts, Some(t) if t < today_start) {
                    before = Some(cum);
                }
                last = Some(cum);
            }
            tokens += match (before, last) {
                (Some(b), Some(l)) => l.saturating_sub(b),
                (None, Some(l)) => l,
                _ => 0,
            };
            if limits.is_none() {
                limits = file_limits;
            }
        } else if limits.is_none() {
            limits = last_rate_limits(reader);
        }
    }
    (limits, tokens)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn line(ts: &str, input: u64, cached: u64, output: u64, limits: &str) -> String {
        format!(
            r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"cached_input_tokens":{cached},"output_tokens":{output},"reasoning_output_tokens":0,"total_tokens":0}},"last_token_usage":{{}},"model_context_window":272000}},"rate_limits":{limits}}}}}"#
        )
    }

    const LIMITS: &str = r#"{"limit_id":"codex","primary":{"used_percent":12.4,"window_minutes":300,"resets_at":1784686758},"secondary":{"used_percent":56.7,"window_minutes":10080,"resets_at":1784686758}}"#;
    const LIMITS_WEEKLY_ONLY: &str = r#"{"limit_id":"codex","primary":{"used_percent":1.0,"window_minutes":10080,"resets_at":1784686758},"secondary":null}"#;

    #[test]
    fn rate_limits_by_window_minutes() {
        let rl = parse_rate_limits_line(&line("2026-07-17T01:00:00Z", 10, 0, 5, LIMITS)).unwrap();
        assert_eq!(rl.five_hour_pct, Some(12));
        assert_eq!(rl.weekly_pct, Some(57));
    }

    #[test]
    fn rate_limits_weekly_only_plan() {
        let rl =
            parse_rate_limits_line(&line("2026-07-17T01:00:00Z", 10, 0, 5, LIMITS_WEEKLY_ONLY))
                .unwrap();
        assert_eq!(rl.five_hour_pct, None);
        assert_eq!(rl.weekly_pct, Some(1));
    }

    #[test]
    fn last_rate_limits_wins() {
        let data = [
            line("2026-07-17T01:00:00Z", 10, 0, 5, LIMITS_WEEKLY_ONLY),
            line("2026-07-17T02:00:00Z", 20, 0, 9, LIMITS),
        ]
        .join("\n");
        let rl = last_rate_limits(data.as_bytes()).unwrap();
        assert_eq!(rl.five_hour_pct, Some(12));
    }

    #[test]
    fn today_tokens_delta_across_midnight() {
        let today = Utc.with_ymd_and_hms(2026, 7, 17, 0, 0, 0).unwrap();
        // 会话从昨天跨到今天:昨天累计 1000 非缓存,今天涨到 1500
        let data = [
            line("2026-07-16T23:00:00Z", 900, 100, 200, "null"),  // billable 1000
            line("2026-07-16T23:59:00Z", 900, 100, 200, "null"),  // billable 1000
            line("2026-07-17T08:00:00Z", 1200, 200, 500, "null"), // billable 1500
        ]
        .join("\n");
        assert_eq!(today_tokens(data.as_bytes(), today), 500);
    }

    #[test]
    fn today_tokens_session_started_today() {
        let today = Utc.with_ymd_and_hms(2026, 7, 17, 0, 0, 0).unwrap();
        let data = line("2026-07-17T08:00:00Z", 300, 100, 50, "null");
        assert_eq!(today_tokens(data.as_bytes(), today), 250);
    }

    #[test]
    fn ignores_unrelated_lines() {
        let today = Utc.with_ymd_and_hms(2026, 7, 17, 0, 0, 0).unwrap();
        let data = r#"{"timestamp":"2026-07-17T08:00:00Z","type":"response_item","payload":{"type":"message"}}
not json at all"#;
        assert_eq!(today_tokens(data.as_bytes(), today), 0);
        assert!(last_rate_limits(data.as_bytes()).is_none());
    }
}
