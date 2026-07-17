//! Claude Code OAuth 凭证:读 macOS 钥匙串,过期时刷新并原格式写回。
//!
//! 写回保持 JSON 结构不变,只更新 accessToken / refreshToken / expiresAt,
//! 这样 Claude Code CLI 自己仍能正常使用。刷新流程与 CLI 一致
//! (同一个公开 client_id),不会顶掉登录。

use serde_json::Value;
use std::process::Command;

const SERVICE: &str = "Claude Code-credentials";
/// Claude Code 的公开 OAuth client id(设备侧应用,非机密)。
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_ENDPOINTS: &[&str] = &[
    "https://console.anthropic.com/v1/oauth/token",
    "https://platform.claude.ai/v1/oauth/token",
];

#[derive(Debug, Clone)]
pub struct Creds {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at_ms: i64,
    raw: Value,
    account: String,
}

impl Creds {
    pub fn expired(&self) -> bool {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        // 提前 5 分钟当作过期,避免边界上请求失败
        now_ms >= self.expires_at_ms - 5 * 60 * 1000
    }
}

fn run(cmd: &mut Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn keychain_account() -> Result<String, String> {
    let meta = run(Command::new("security").args(["find-generic-password", "-s", SERVICE]))?;
    meta.lines()
        .find_map(|l| {
            l.trim()
                .strip_prefix("\"acct\"<blob>=\"")
                .and_then(|r| r.strip_suffix('"'))
                .map(str::to_owned)
        })
        .ok_or_else(|| "keychain entry has no account attribute".into())
}

pub fn read() -> Result<Creds, String> {
    let json = run(Command::new("security").args(["find-generic-password", "-s", SERVICE, "-w"]))?;
    let raw: Value = serde_json::from_str(json.trim()).map_err(|e| e.to_string())?;
    let oauth = raw
        .get("claudeAiOauth")
        .ok_or("missing claudeAiOauth in keychain credential")?;
    let get_str = |k: &str| {
        oauth
            .get(k)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("missing {k}"))
    };
    Ok(Creds {
        access_token: get_str("accessToken")?,
        refresh_token: get_str("refreshToken")?,
        expires_at_ms: oauth.get("expiresAt").and_then(Value::as_i64).unwrap_or(0),
        raw,
        account: keychain_account()?,
    })
}

fn write_keychain(account: &str, secret: &str) -> Result<(), String> {
    // -U:已存在则更新。secret 走 argv(不经过 shell);security 无 stdin 传密写法。
    run(Command::new("security").args([
        "add-generic-password",
        "-U",
        "-a",
        account,
        "-s",
        SERVICE,
        "-w",
        secret,
    ]))
    .map(|_| ())
}

/// 用 refresh token 换新 access token,写回钥匙串,返回新凭证。
pub fn refresh(creds: &Creds) -> Result<Creds, String> {
    let mut last_err = String::new();
    for endpoint in TOKEN_ENDPOINTS {
        match try_refresh(endpoint, creds) {
            Ok(c) => return Ok(c),
            Err(e) => last_err = format!("{endpoint}: {e}"),
        }
    }
    Err(format!("token refresh failed: {last_err}"))
}

fn try_refresh(endpoint: &str, creds: &Creds) -> Result<Creds, String> {
    let resp: Value = ureq::post(endpoint)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": creds.refresh_token,
            "client_id": CLIENT_ID,
        }))
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;

    let access = resp
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("no access_token in refresh response")?
        .to_owned();
    let refresh_token = resp
        .get("refresh_token")
        .and_then(Value::as_str)
        .unwrap_or(&creds.refresh_token)
        .to_owned();
    let expires_in = resp.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let expires_at_ms = now_ms + expires_in * 1000;

    let mut raw = creds.raw.clone();
    raw["claudeAiOauth"]["accessToken"] = Value::from(access.clone());
    raw["claudeAiOauth"]["refreshToken"] = Value::from(refresh_token.clone());
    raw["claudeAiOauth"]["expiresAt"] = Value::from(expires_at_ms);
    write_keychain(&creds.account, &raw.to_string())?;

    Ok(Creds {
        access_token: access,
        refresh_token,
        expires_at_ms,
        raw,
        account: creds.account.clone(),
    })
}
