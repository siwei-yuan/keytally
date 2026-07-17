//! 采集编排:把各数据源拼成一个 Snapshot。

use crate::types::{Config, Snapshot, SourceUsage};
use crate::{activity, claude_quota, claude_today, codex};
use chrono::{DateTime, Local, Utc};

/// 本地时区今日零点(转成 UTC 时刻,与日志里的 UTC 时间戳可比)。
pub fn today_start() -> DateTime<Utc> {
    Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("midnight is valid")
        .and_local_timezone(Local)
        .single()
        .expect("unambiguous local midnight")
        .with_timezone(&Utc)
}

pub fn collect(cfg: &Config) -> Snapshot {
    let start = today_start();

    let mut claude = SourceUsage::default();
    let claude_projects = cfg.claude_dir.join("projects");
    if claude_projects.is_dir() {
        claude.valid = true;
        claude.today_tokens = claude_today::scan(&claude_projects, start);
        claude.active = activity::claude_active(&claude_projects, &activity::state_dir("claude"));
        if cfg.fetch_claude_quota {
            match claude_quota::get() {
                Ok(q) => {
                    claude.five_hour_pct = q.five_hour_pct;
                    claude.weekly_pct = q.weekly_pct;
                }
                Err((e, _)) => eprintln!("claude quota unavailable: {e}"),
            }
        }
    }

    let mut cx = SourceUsage::default();
    let codex_sessions = cfg.codex_dir.join("sessions");
    if codex_sessions.is_dir() {
        cx.valid = true;
        let (limits, tokens) = codex::scan(&codex_sessions, start);
        if let Some(l) = limits {
            cx.five_hour_pct = l.five_hour_pct;
            cx.weekly_pct = l.weekly_pct;
        }
        cx.today_tokens = tokens;
        cx.active = activity::codex_active(&codex_sessions, &activity::state_dir("codex"));
    }

    Snapshot { claude, codex: cx }
}
