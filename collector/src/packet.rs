//! HID 报文构造,规范见 docs/protocol.md。

use crate::types::Snapshot;

pub const PACKET_LEN: usize = 32;
pub const CMD_DATA: u8 = 0xC0;
pub const CMD_STATE: u8 = 0xC1;
pub const CMD_QUERY: u8 = 0xC2;
pub const PROTOCOL_VERSION: u8 = 1;
pub const UNKNOWN: u8 = 0xFF;

/// 今日消耗 token 数 → 相对日预算的百分比;预算未配置时返回 UNKNOWN。
pub fn today_pct(tokens: u64, budget: u64) -> u8 {
    if budget == 0 {
        return UNKNOWN;
    }
    ((tokens.saturating_mul(100)) / budget).min(100) as u8
}

fn pct_byte(p: Option<u8>) -> u8 {
    match p {
        Some(v) => v.min(100),
        None => UNKNOWN,
    }
}

pub fn build_data_packet(s: &Snapshot, claude_budget: u64, codex_budget: u64) -> [u8; PACKET_LEN] {
    let mut buf = [0u8; PACKET_LEN];
    buf[0] = CMD_DATA;
    buf[1] = PROTOCOL_VERSION;
    buf[2] = (s.claude.valid as u8) | ((s.codex.valid as u8) << 1);
    buf[3] = pct_byte(s.claude.five_hour_pct);
    buf[4] = pct_byte(s.claude.weekly_pct);
    buf[5] = today_pct(s.claude.today_tokens, claude_budget);
    buf[6] = s.claude.active as u8;
    buf[7] = pct_byte(s.codex.five_hour_pct);
    buf[8] = pct_byte(s.codex.weekly_pct);
    buf[9] = today_pct(s.codex.today_tokens, codex_budget);
    buf[10] = s.codex.active as u8;
    buf
}

pub fn build_query_packet() -> [u8; PACKET_LEN] {
    let mut buf = [0u8; PACKET_LEN];
    buf[0] = CMD_QUERY;
    buf
}

/// mode/source 传 None 表示「不变」(0xFF)。
pub fn build_set_state_packet(mode: Option<u8>, source: Option<u8>) -> [u8; PACKET_LEN] {
    let mut buf = [0u8; PACKET_LEN];
    buf[0] = CMD_STATE;
    buf[1] = mode.unwrap_or(UNKNOWN);
    buf[2] = source.unwrap_or(UNKNOWN);
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SourceUsage;

    #[test]
    fn today_pct_maps_budget() {
        assert_eq!(today_pct(0, 1000), 0);
        assert_eq!(today_pct(500, 1000), 50);
        assert_eq!(today_pct(2000, 1000), 100); // 超预算截断
        assert_eq!(today_pct(123, 0), UNKNOWN); // 未配置预算
    }

    #[test]
    fn data_packet_layout() {
        let s = Snapshot {
            claude: SourceUsage {
                valid: true,
                five_hour_pct: Some(37),
                weekly_pct: Some(82),
                today_tokens: 250_000,
                active: true,
            },
            codex: SourceUsage {
                valid: true,
                five_hour_pct: None,
                weekly_pct: Some(1),
                today_tokens: 0,
                active: false,
            },
        };
        let p = build_data_packet(&s, 1_000_000, 0);
        assert_eq!(p[0], CMD_DATA);
        assert_eq!(p[1], PROTOCOL_VERSION);
        assert_eq!(p[2], 0b11);
        assert_eq!(&p[3..7], &[37, 82, 25, 1]);
        assert_eq!(&p[7..11], &[UNKNOWN, 1, UNKNOWN, 0]);
        assert!(p[11..].iter().all(|&b| b == 0));
    }

    #[test]
    fn pct_over_100_clamped() {
        let s = Snapshot {
            claude: SourceUsage {
                valid: true,
                five_hour_pct: Some(250), // 数据源异常时也不能溢出协议范围
                ..Default::default()
            },
            ..Default::default()
        };
        let p = build_data_packet(&s, 0, 0);
        assert_eq!(p[3], 100);
    }

    #[test]
    fn set_state_packet() {
        let p = build_set_state_packet(Some(2), None);
        assert_eq!(&p[0..3], &[CMD_STATE, 2, UNKNOWN]);
    }
}
