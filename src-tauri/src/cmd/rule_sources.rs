use anyhow::{Context as _, Result, bail, ensure};
use regex::Regex;
use reqwest::Url;
use std::{collections::BTreeSet, path::PathBuf, time::Duration};

pub(super) fn clean_hostname(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

const GEMINI: &str = "https://gemini.google.com/";
const CLAUDE: &str = "https://code.claude.com/docs/en/desktop.md";
const CHATGPT: &str =
    "https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps";

fn extract(service: &str, page: &str) -> Result<Vec<String>> {
    let mut hosts = BTreeSet::new();
    match service {
        "Gemini" => {
            let tags = Regex::new(r#"(?is)<(?:link|script|img|a)\s+[^<>]{0,8192}>"#)?;
            let urls = Regex::new(r#"(?i)\s(?:href|src)\s*=\s*["'](https://[^"'\s<>]+)["']"#)?;
            for tag in tags.find_iter(page) {
                for captures in urls.captures_iter(tag.as_str()) {
                    let Ok(url) = Url::parse(&captures[1]) else { continue };
                    let Some(host) = url.host_str() else { continue };
                    if host == "accounts.google.com"
                        || host == "gemini.google.com"
                        || ["gstatic.com", "googleusercontent.com", "googleapis.com"]
                            .iter()
                            .any(|d| host.ends_with(&format!(".{d}")))
                    {
                        hosts.insert(host.to_owned());
                    }
                }
            }
            ensure!(
                hosts.contains("gemini.gstatic.com")
                    || (hosts.contains("gemini.google.com") && hosts.contains("www.gstatic.com")),
                "Gemini 页面未提供可辨认的资源清单"
            );
        }
        "Claude" => {
            let section = page
                .split_once("### Network access requirements")
                .context("Claude 官方文档的网络要求章节已变化")?
                .1;
            let (_, block) = section.split_once("\n\x60\x60\x60").context("找不到官方域名清单")?;
            let (_, lines) = block.split_once('\n').context("官方清单为空")?;
            for line in lines.split("\n\x60\x60\x60").next().unwrap_or("").lines() {
                let s = line.trim().to_ascii_lowercase();
                if clean_hostname(s.trim_start_matches("*.")) {
                    hosts.insert(s);
                }
            }
            ensure!(hosts.contains("claude.ai"), "Claude 官方清单格式已变化");
        }
        "ChatGPT" => {
            let rows = Regex::new(
                r"(?i)<li[^>]*>\s*(?:<p[^>]*>\s*)?(?:<code[^>]*>\s*)?((?:\*\.)?[a-z0-9.-]+\.[a-z]{2,63})\s*(?:</code>\s*)?(?:</p>\s*)?</li>",
            )?;
            for row in rows.captures_iter(page) {
                let host = row[1].to_ascii_lowercase();
                if clean_hostname(host.trim_start_matches("*.")) {
                    hosts.insert(host);
                }
            }
            ensure!(
                hosts.contains("*.openai.com") && hosts.contains("*.oaiusercontent.com"),
                "OpenAI 官方清单格式已变化"
            );
        }
        _ => bail!("此服务尚未配置官方来源"),
    }
    ensure!(!hosts.is_empty() && hosts.len() <= 160, "官方清单为空或格式已变化");
    Ok(hosts.into_iter().collect())
}

#[tauri::command]
#[specta::specta]
pub async fn official_rule_hosts(service: String) -> Result<(String, Vec<String>, Option<String>), String> {
    match lookup(&service).await {
        Ok((source, hosts)) => Ok((source, hosts, None)),
        Err(error) if service == "ChatGPT" => {
            #[derive(serde::Deserialize)]
            struct Snapshot {
                source: String,
                retrieved: String,
                hosts: Vec<String>,
            }
            let snapshot: Snapshot =
                serde_json::from_str(include_str!("chatgpt-network-hosts.json")).map_err(|e| e.to_string())?;
            Ok((
                snapshot.source,
                snapshot.hosts,
                Some(format!(
                    "实时读取失败（{error}）。可选用 {} 核对的官方快照。",
                    snapshot.retrieved
                )),
            ))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn lookup(service: &str) -> Result<(String, Vec<String>)> {
    let source = match service {
        "Gemini" => GEMINI,
        "Claude" => CLAUDE,
        "ChatGPT" => CHATGPT,
        _ => bail!("此服务尚未配置官方来源"),
    };
    let client = reqwest::Client::builder()
        .http1_only()
        .user_agent("Clash-Verge-Local-AI/2.5.10")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let mut resp = client.get(source).send().await?.error_for_status()?;
    ensure!(resp.status().is_success(), "官方来源发生重定向，请稍后再试");
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        ensure!(buf.len() + chunk.len() <= 4 * 1024 * 1024, "官方页面超过读取上限");
        buf.extend_from_slice(&chunk);
    }
    Ok((source.to_owned(), extract(service, std::str::from_utf8(&buf)?)?))
}

#[tauri::command]
#[specta::specta]
pub fn claude_cli_endpoint() -> Option<(String, String)> {
    let path = std::env::var_os("PATH")?;
    let mut process = None;
    for dir in std::env::split_paths(&path).filter(|p| p.is_absolute()) {
        let native = dir.join("claude.exe");
        if native.is_file() {
            if native.to_string_lossy().to_lowercase().contains(r"\windowsapps\") {
                return None;
            }
            process = Some(native.to_str()?.to_owned());
            break;
        }
        let shim = dir.join("claude.cmd");
        if shim.is_file() {
            let script = std::fs::read_to_string(shim)
                .ok()?
                .to_ascii_lowercase()
                .replace('/', "\\");
            if script.contains(r"node_modules\@anthropic-ai\claude-code\cli.js")
                && dir.join(r"node_modules\@anthropic-ai\claude-code\cli.js").is_file()
            {
                process = Some("node.exe".into());
            }
            break;
        }
    }
    let process = process?;
    let dir = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|p| p.join(".claude")))?;
    let file = dir.join("settings.json");
    let settings: serde_json::Value = if file.is_file() {
        if std::fs::metadata(&file).ok()?.len() > 2 * 1024 * 1024 {
            return None;
        }
        serde_json::from_slice(&std::fs::read(file).ok()?).ok()?
    } else {
        serde_json::Value::Null
    };
    let env = |name: &str| {
        std::env::var(name)
            .ok()
            .or_else(|| settings.get("env")?.get(name)?.as_str().map(str::to_owned))
    };
    if [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ]
    .iter()
    .any(|k| env(k).is_some_and(|s| s != "0" && !s.is_empty()))
    {
        return None;
    }
    let url = Url::parse(&env("ANTHROPIC_BASE_URL").unwrap_or_else(|| "https://api.anthropic.com".into())).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.domain()?;
    clean_hostname(host).then(|| (process, host.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::{extract, official_rule_hosts};

    #[tokio::test]
    #[ignore = "queries live official sites"]
    async fn rule_source_live_documents() {
        for service in ["Gemini", "Claude", "ChatGPT"] {
            let (source, hosts, fallback) = official_rule_hosts(service.to_owned())
                .await
                .expect("official document should contain resource domains");
            println!(
                "{service}: {} hosts from {source}, status: {}",
                hosts.len(),
                fallback.as_deref().unwrap_or("live")
            );
            if service != "ChatGPT" {
                assert!(fallback.is_none());
            }
            assert!(!hosts.is_empty());
        }
    }

    #[test]
    fn rule_source_extracts_only_documented_hosts() {
        let google = r#"<link href="https://gemini.gstatic.com/app.css"><a href="https://accounts.google.com/login">login</a><img src="https://gstatic.com.attacker.invalid/fake">"#;
        assert_eq!(
            extract("Gemini", google).unwrap(),
            ["accounts.google.com", "gemini.gstatic.com"]
        );
        let md = "### Network access requirements\n\n```text\nclaude.ai\n*.claudeusercontent.com\n```\nOther documentation.example";
        assert_eq!(extract("Claude", md).unwrap(), ["*.claudeusercontent.com", "claude.ai"]);
        let list =
            "<li><p>*.openai.com</p></li><li><p>*.oaiusercontent.com</p></li><a href='https://other.invalid'>link</a>";
        assert_eq!(
            extract("ChatGPT", list).unwrap(),
            ["*.oaiusercontent.com", "*.openai.com"]
        );
        for service in ["Claude", "Gemini", "ChatGPT", "Unknown"] {
            assert!(extract(service, "Login required").is_err());
        }
    }
}
