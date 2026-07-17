//! 采集器验证 CLI:打印 Snapshot,可选打印 HID 报文十六进制。
//!
//! 用法:
//!   usage-cli [--json] [--packet] [--no-quota]
//!             [--claude-budget N] [--codex-budget N]

use collector::packet::build_data_packet;
use collector::snapshot::collect;
use collector::types::Config;

fn main() {
    let mut cfg = Config::from_home();
    let mut json = false;
    let mut packet = false;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--json" => json = true,
            "--packet" => packet = true,
            "--no-quota" => cfg.fetch_claude_quota = false,
            "--claude-budget" => cfg.claude_daily_budget = parse_num(args.next()),
            "--codex-budget" => cfg.codex_daily_budget = parse_num(args.next()),
            other => {
                eprintln!("unknown arg: {other}");
                std::process::exit(2);
            }
        }
    }

    let snap = collect(&cfg);

    if json {
        println!("{}", serde_json::to_string_pretty(&snap).unwrap());
    } else {
        print_human("Claude", &snap.claude, cfg.claude_daily_budget);
        print_human("Codex ", &snap.codex, cfg.codex_daily_budget);
    }

    if packet {
        let p = build_data_packet(&snap, cfg.claude_daily_budget, cfg.codex_daily_budget);
        let hex: Vec<String> = p.iter().map(|b| format!("{b:02x}")).collect();
        println!("packet: {}", hex.join(" "));
    }
}

fn parse_num(v: Option<String>) -> u64 {
    v.and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        eprintln!("budget needs a number");
        std::process::exit(2);
    })
}

fn print_human(name: &str, u: &collector::types::SourceUsage, budget: u64) {
    let pct = |p: Option<u8>| p.map_or("--".into(), |v| format!("{v}%"));
    let today = if budget > 0 {
        format!(
            "{} tokens ({}%)",
            u.today_tokens,
            collector::packet::today_pct(u.today_tokens, budget)
        )
    } else {
        format!("{} tokens", u.today_tokens)
    };
    println!(
        "{name}  valid={}  5h={}  week={}  today={}  active={}",
        u.valid,
        pct(u.five_hour_pct),
        pct(u.weekly_pct),
        today,
        u.active
    );
}
