use std::path::PathBuf;

/// 单个数据源(Claude 或 Codex)的采集结果。
/// 百分比字段 None = 未知(打包时映射为 0xFF)。
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct SourceUsage {
    pub valid: bool,
    pub five_hour_pct: Option<u8>,
    pub weekly_pct: Option<u8>,
    pub today_tokens: u64,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct Snapshot {
    pub claude: SourceUsage,
    pub codex: SourceUsage,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub claude_dir: PathBuf,
    pub codex_dir: PathBuf,
    /// 今日消耗模式的日预算(token 数);0 = 未配置,今日消耗显示为未知。
    pub claude_daily_budget: u64,
    pub codex_daily_budget: u64,
    /// 是否走网络查询 Claude 额度(需要钥匙串凭证)。
    pub fetch_claude_quota: bool,
}

impl Config {
    pub fn from_home() -> Self {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME not set"));
        Config {
            claude_dir: home.join(".claude"),
            codex_dir: home.join(".codex"),
            claude_daily_budget: 0,
            codex_daily_budget: 0,
            fetch_claude_quota: true,
        }
    }
}
