//! 解析 ~/.claude/projects/**/*.jsonl,统计今日 token 消耗。
//!
//! assistant 行结构(节选):
//! `{"type":"assistant","timestamp":"...","requestId":"req_...","uuid":"...",
//!   "message":{"id":"msg_...","usage":{"input_tokens":N,"cache_creation_input_tokens":N,
//!   "cache_read_input_tokens":N,"output_tokens":N,...}}}`

use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::HashSet;
use std::io::BufRead;
use std::path::Path;

/// 计费口径:非缓存输入 + 缓存写入 + 输出(缓存读取不计)。
fn billable(usage: &Value) -> u64 {
    let get = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
    get("input_tokens") + get("cache_creation_input_tokens") + get("output_tokens")
}

/// 同一响应可能因 retry/多文件出现多次,用 requestId+message.id 去重。
fn dedupe_key(v: &Value) -> Option<String> {
    let req = v.get("requestId").and_then(Value::as_str);
    let msg = v
        .get("message")
        .and_then(|m| m.get("id"))
        .and_then(Value::as_str);
    match (req, msg) {
        (Some(r), Some(m)) => Some(format!("{r}:{m}")),
        _ => v.get("uuid").and_then(Value::as_str).map(str::to_owned),
    }
}

pub fn today_tokens<R: BufRead>(
    r: R,
    today_start: DateTime<Utc>,
    seen: &mut HashSet<String>,
) -> u64 {
    let mut sum = 0u64;
    for line in r.lines().map_while(Result::ok) {
        if !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let in_today = v
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|t| t.with_timezone(&Utc) >= today_start);
        if !in_today {
            continue;
        }
        let Some(usage) = v.get("message").and_then(|m| m.get("usage")) else {
            continue;
        };
        if let Some(key) = dedupe_key(&v) {
            if !seen.insert(key) {
                continue;
            }
        }
        sum += billable(usage);
    }
    sum
}

/// 扫描 projects 目录下今天动过的 jsonl 求和。
pub fn scan(projects_dir: &Path, today_start: DateTime<Utc>) -> u64 {
    let today_start_sys: std::time::SystemTime = std::time::SystemTime::from(today_start);
    let mut seen = HashSet::new();
    let mut sum = 0u64;
    for entry in walkdir::WalkDir::new(projects_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
    {
        let fresh = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .is_some_and(|t| t >= today_start_sys);
        if !fresh {
            continue;
        }
        if let Ok(f) = std::fs::File::open(entry.path()) {
            sum += today_tokens(std::io::BufReader::new(f), today_start, &mut seen);
        }
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn line(ts: &str, req: &str, msg: &str, input: u64, cache_w: u64, cache_r: u64, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","requestId":"{req}","uuid":"u-{req}","message":{{"id":"{msg}","usage":{{"input_tokens":{input},"cache_creation_input_tokens":{cache_w},"cache_read_input_tokens":{cache_r},"output_tokens":{output}}}}}}}"#
        )
    }

    #[test]
    fn sums_today_only() {
        let today = Utc.with_ymd_and_hms(2026, 7, 17, 0, 0, 0).unwrap();
        let data = [
            line("2026-07-16T23:00:00Z", "r1", "m1", 100, 0, 0, 10), // 昨天,不计
            line("2026-07-17T09:00:00Z", "r2", "m2", 100, 50, 9999, 30), // 180(缓存读不计)
        ]
        .join("\n");
        let mut seen = HashSet::new();
        assert_eq!(today_tokens(data.as_bytes(), today, &mut seen), 180);
    }

    #[test]
    fn dedupes_by_request_and_message_id() {
        let today = Utc.with_ymd_and_hms(2026, 7, 17, 0, 0, 0).unwrap();
        let l = line("2026-07-17T09:00:00Z", "r1", "m1", 100, 0, 0, 10);
        let data = format!("{l}\n{l}");
        let mut seen = HashSet::new();
        assert_eq!(today_tokens(data.as_bytes(), today, &mut seen), 110);
        // 跨文件也去重:同一 seen 集合再扫一遍 = 0
        assert_eq!(today_tokens(data.as_bytes(), today, &mut seen), 0);
    }

    #[test]
    fn skips_non_assistant_and_bad_lines() {
        let today = Utc.with_ymd_and_hms(2026, 7, 17, 0, 0, 0).unwrap();
        let data = r#"{"type":"user","timestamp":"2026-07-17T09:00:00Z","message":{"role":"assistant"}}
garbage"#;
        let mut seen = HashSet::new();
        assert_eq!(today_tokens(data.as_bytes(), today, &mut seen), 0);
    }
}
