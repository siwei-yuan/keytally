//! Claude 订阅额度:GET https://api.anthropic.com/api/oauth/usage
//! (即 Claude Code `/usage` 命令背后的接口)。

use crate::creds;
use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Quota {
    pub five_hour_pct: Option<u8>,
    pub weekly_pct: Option<u8>,
}

#[derive(Debug)]
pub enum FetchError {
    Unauthorized,
    Other(String),
}

/// 容错解析:接口返回若干窗口对象,各含 utilization(0–100)。
/// 周限额优先取整体 seven_day;没有就退回模型细分窗口取最大值。
pub fn parse(v: &Value) -> Quota {
    let util = |key: &str| {
        v.get(key)
            .and_then(|w| w.get("utilization"))
            .and_then(Value::as_f64)
            .map(|p| p.max(0.0).min(100.0).round() as u8)
    };
    let weekly = util("seven_day").or_else(|| {
        ["seven_day_sonnet", "seven_day_opus", "seven_day_oauth_apps"]
            .iter()
            .filter_map(|k| util(k))
            .max()
    });
    Quota {
        five_hour_pct: util("five_hour"),
        weekly_pct: weekly,
    }
}

pub fn fetch(access_token: &str) -> Result<Quota, FetchError> {
    let resp = ureq::get(USAGE_URL)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .call();
    match resp {
        Ok(r) => {
            let v: Value = r.into_json().map_err(|e| FetchError::Other(e.to_string()))?;
            Ok(parse(&v))
        }
        Err(ureq::Error::Status(401 | 403, _)) => Err(FetchError::Unauthorized),
        Err(e) => Err(FetchError::Other(e.to_string())),
    }
}

/// 完整流程:读钥匙串 → 过期先刷新 → 请求;401 再刷新重试一次。
pub fn get() -> Result<Quota, String> {
    let mut c = creds::read()?;
    if c.expired() {
        c = creds::refresh(&c)?;
    }
    match fetch(&c.access_token) {
        Ok(q) => Ok(q),
        Err(FetchError::Unauthorized) => {
            let c = creds::refresh(&c)?;
            fetch(&c.access_token).map_err(|e| format!("{e:?}"))
        }
        Err(FetchError::Other(e)) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_windows() {
        let v: Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":23.6,"resets_at":"2026-07-17T12:00:00Z"},
                "seven_day":{"utilization":81,"resets_at":"2026-07-20T00:00:00Z"}}"#,
        )
        .unwrap();
        assert_eq!(
            parse(&v),
            Quota { five_hour_pct: Some(24), weekly_pct: Some(81) }
        );
    }

    #[test]
    fn falls_back_to_per_model_weekly() {
        let v: Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":5},
                "seven_day_sonnet":{"utilization":40},
                "seven_day_opus":{"utilization":70}}"#,
        )
        .unwrap();
        assert_eq!(parse(&v).weekly_pct, Some(70));
    }

    #[test]
    fn unknown_on_missing_fields() {
        let v: Value = serde_json::from_str(r#"{"something_else":{}}"#).unwrap();
        assert_eq!(parse(&v), Quota::default());
    }

    #[test]
    fn clamps_out_of_range() {
        let v: Value =
            serde_json::from_str(r#"{"five_hour":{"utilization":250},"seven_day":{"utilization":-3}}"#)
                .unwrap();
        assert_eq!(
            parse(&v),
            Quota { five_hour_pct: Some(100), weekly_pct: Some(0) }
        );
    }
}
