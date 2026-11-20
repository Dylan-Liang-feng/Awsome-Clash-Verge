use anyhow::{Context as _, Result, bail, ensure};
use regex::Regex;
use reqwest::{Client, Response, Url};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeSet, time::Duration};

const WIKI: &str = "https://www.wikidata.org/w/api.php";
const QQ_MAIL: &str = "https://mail.qq.com/";

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteResult {
    name: String,
    source: String,
    website: String,
    hosts: Vec<String>,
    optional: Vec<String>,
}

async fn limited(resp: Response) -> Result<Vec<u8>> {
    let mut resp = resp.error_for_status()?;
    ensure!(resp.status().is_success(), "来源发生跳转，无法确认网页入口");
    let mut out = Vec::new();
    while let Some(block) = resp.chunk().await? {
        ensure!(out.len() + block.len() <= 1024 * 1024, "来源返回的数据超过读取上限");
        out.extend_from_slice(&block);
    }
    Ok(out)
}
fn norm(s: &str) -> String {
    s.split_whitespace().collect::<String>().to_lowercase()
}
fn entity_ids<'a>(data: &'a Value, term: &str) -> Result<BTreeSet<&'a str>> {
    let list = data["search"].as_array().context("网站目录未返回搜索结果")?;
    let ids: BTreeSet<&str> = list
        .iter()
        .filter(|row| {
            [
                row["label"].as_str(),
                row.pointer("/match/text").and_then(Value::as_str),
            ]
            .into_iter()
            .flatten()
            .any(|s| norm(s) == norm(term))
        })
        .filter_map(|row| row["id"].as_str())
        .filter(|id| {
            id.strip_prefix('Q')
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        })
        .collect();
    ensure!(
        !ids.is_empty(),
        "未找到与「{term}」同名的网站条目，请补充产品全名或官网域名"
    );
    Ok(ids)
}

fn entity_id(data: &Value, term: &str) -> Result<String> {
    let ids = entity_ids(data, term)?;
    ensure!(ids.len() == 1, "「{term}」有多个同名条目，请补充官网域名");
    Ok((*ids.first().unwrap()).into())
}

fn official_entry(data: &Value) -> Result<Url> {
    let rows = data
        .pointer("/claims/P856")
        .and_then(Value::as_array)
        .context("条目没有登记官方网站")?;
    let preferred = rows.iter().any(|r| r["rank"] == "preferred");
    official_urls(
        rows.iter()
            .filter(|r| r["rank"] != "deprecated" && (!preferred || r["rank"] == "preferred"))
            .filter_map(|r| r.pointer("/mainsnak/datavalue/value").and_then(Value::as_str)),
    )
}
fn official_urls<'a>(urls: impl Iterator<Item = &'a str>) -> Result<Url> {
    let mut hosts = BTreeSet::new();
    let mut entries = Vec::new();
    for link in urls {
        let Ok(url) = Url::parse(link) else { continue };
        let Some(host) = url.domain() else { continue };
        if !matches!(url.scheme(), "https" | "http")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || !super::rule_sources::clean_hostname(host)
            || ["local", "localhost", "internal", "onion", "test", "invalid"]
                .contains(&host.rsplit('.').next().unwrap_or(""))
        {
            continue;
        }
        hosts.insert(host.to_owned());
        if url.path() == "/" && url.query().is_none() && url.fragment().is_none() {
            entries.push(url);
        }
    }
    // Language variants may be registered on sibling hosts; only choose a parent that is itself listed.
    entries.retain(|entry| {
        let host = entry.domain().unwrap_or("");
        let root = host.strip_prefix("www.").unwrap_or(host);
        hosts.iter().all(|h| h == root || h.ends_with(&format!(".{root}")))
    });
    ensure!(
        !entries.is_empty(),
        "官网存在多个入口或依赖具体 URL 路径，无法自动确定安全的域名范围；请指定网页域名"
    );
    entries.sort_by_key(|u| u.scheme() != "https");
    Ok(entries.remove(0))
}
async fn search_entities(client: &Client, name: &str) -> Result<Value> {
    let bytes = limited(
        client
            .get(WIKI)
            .query(&[
                ("action", "wbsearchentities"),
                ("format", "json"),
                ("language", "zh"),
                ("uselang", "zh"),
                ("type", "item"),
                ("limit", "8"),
                ("search", name),
            ])
            .send()
            .await?,
    )
    .await?;
    Ok(serde_json::from_slice(&bytes)?)
}

#[tauri::command]
#[specta::specta]
pub async fn public_app_aliases(term: String) -> Result<Vec<String>, String> {
    async fn lookup(name: &str) -> Result<Vec<String>> {
        ensure!(
            (2..=60).contains(&name.chars().count())
                && name.chars().all(|c| c.is_alphanumeric() || " -&·+".contains(c)),
            "请输入公开软件名称"
        );
        let client = Client::builder()
            .user_agent("Clash-Verge-Local-AI/2.5.10 (interactive software lookup)")
            .http1_only()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()?;
        let id = entity_id(&search_entities(&client, name).await?, name)?;
        let bytes = limited(
            client
                .get(WIKI)
                .query(&[
                    ("action", "wbgetentities"),
                    ("format", "json"),
                    ("ids", id.as_str()),
                    ("props", "labels|aliases"),
                    ("languages", "zh|zh-cn|en"),
                ])
                .send()
                .await?,
        )
        .await?;
        let data: Value = serde_json::from_slice(&bytes)?;
        let entry = &data["entities"][&id];
        let mut names = BTreeSet::new();
        for lang in ["zh", "zh-cn", "en"] {
            let label = entry["labels"][lang]["value"].as_str();
            let others = entry["aliases"][lang]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| a["value"].as_str());
            for label in label.into_iter().chain(others) {
                if (2..=90).contains(&label.chars().count()) {
                    names.insert(label.to_owned());
                }
            }
        }
        Ok(names.into_iter().take(64).collect())
    }
    lookup(term.trim()).await.map_err(|e| e.to_string())
}

async fn directory(client: &Client, name: &str) -> Result<(String, Url)> {
    let results = search_entities(client, name).await?;
    let ids = entity_ids(&results, name)?;
    if ids.len() == 1 {
        let id = *ids.first().unwrap();
        let bytes = limited(
            client
                .get(WIKI)
                .query(&[
                    ("action", "wbgetclaims"),
                    ("format", "json"),
                    ("entity", id),
                    ("property", "P856"),
                ])
                .send()
                .await?,
        )
        .await?;
        return Ok((
            format!("https://www.wikidata.org/wiki/{id}"),
            official_entry(&serde_json::from_slice(&bytes)?)?,
        ));
    }
    let joined = ids.iter().copied().collect::<Vec<_>>().join("|");
    let bytes = limited(
        client
            .get(WIKI)
            .query(&[
                ("action", "wbgetentities"),
                ("format", "json"),
                ("ids", joined.as_str()),
                ("props", "claims"),
            ])
            .send()
            .await?,
    )
    .await?;
    choose_website(&serde_json::from_slice(&bytes)?, &ids, name)
}

fn choose_website(data: &Value, ids: &BTreeSet<&str>, name: &str) -> Result<(String, Url)> {
    let mut sites = std::collections::BTreeMap::new();
    for id in ids {
        let item = &data["entities"][*id];
        // A same-title publication without an official URL cannot identify a website.
        if !item
            .pointer("/claims/P856")
            .and_then(Value::as_array)
            .is_some_and(|r| !r.is_empty())
        {
            continue;
        }
        let url = official_entry(item)?;
        sites
            .entry(url.domain().unwrap_or("").to_owned())
            .or_insert((format!("https://www.wikidata.org/wiki/{id}"), url));
    }
    ensure!(
        sites.len() == 1,
        "「{name}」没有唯一可核实的官网，请补充机构的地区或官网域名"
    );
    Ok(sites.into_values().next().unwrap())
}
fn qq_hosts(body: &str) -> Result<(Vec<String>, Vec<String>)> {
    ensure!(
        body.contains("QQ邮箱") || body.contains("QQMail"),
        "腾讯页面未能确认 QQ 邮箱入口"
    );
    let links = Regex::new(r#"(?i)https://([a-z0-9.-]+)(?:[/?#"'\\\s>]|$)"#)?;
    let mut hosts = BTreeSet::from(["mail.qq.com".to_owned()]);
    let mut optional = BTreeSet::new();
    for cap in links.captures_iter(body) {
        let host = cap[1].to_ascii_lowercase();
        if super::rule_sources::clean_hostname(&host) && host.ends_with(".mail.qq.com") {
            hosts.insert(host);
        } else if host == "res.wx.qq.com" {
            optional.insert(host);
        }
    }
    Ok((hosts.into_iter().collect(), optional.into_iter().collect()))
}

async fn research_directory(client: &Client, name: &str) -> Result<(String, Url)> {
    let bytes = limited(
        client
            .get("https://api.ror.org/v2/organizations")
            .query(&[("query", name)])
            .send()
            .await?,
    )
    .await?;
    let data: Value = serde_json::from_slice(&bytes)?;
    let mut rows = data["items"]
        .as_array()
        .context("机构目录返回格式有变")?
        .iter()
        .filter(|r| {
            r["status"] == "active"
                && r["names"].as_array().is_some_and(|names| {
                    names
                        .iter()
                        .any(|n| n["value"].as_str().is_some_and(|s| norm(s) == norm(name)))
                })
        });
    let row = rows.next().context("科研机构目录未找到同名机构")?;
    ensure!(rows.next().is_none(), "科研机构目录包含多个同名机构");
    let source = row["id"]
        .as_str()
        .filter(|s| s.starts_with("https://ror.org/"))
        .context("缺少 ROR 条目地址")?;
    let site = official_urls(
        row["links"]
            .as_array()
            .context("缺少官网链接")?
            .iter()
            .filter(|l| l["type"] == "website")
            .filter_map(|l| l["value"].as_str()),
    )?;
    Ok((source.to_owned(), site))
}

async fn search(term: &str, research: bool) -> Result<WebsiteResult> {
    let name = term.trim();
    ensure!(
        (2..=60).contains(&name.chars().count()) && name.chars().all(|c| c.is_alphanumeric() || " -&·+".contains(c)),
        "请输入公开服务名，例如 QQ邮箱"
    );
    let client = Client::builder()
        .user_agent("Clash-Verge-Local-AI/2.5.10 (interactive official website discovery)")
        .http1_only()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .build()?;
    if ["qq邮箱", "qqmail", "腾讯邮箱"].contains(&norm(name).as_str()) {
        // Third-party search results never select the URL fetched by the client.
        let page = limited(client.get(QQ_MAIL).send().await?).await?;
        let (hosts, optional) = qq_hosts(std::str::from_utf8(&page)?)?;
        return Ok(WebsiteResult {
            name: name.into(),
            source: QQ_MAIL.to_owned(),
            website: QQ_MAIL.into(),
            hosts,
            optional,
        });
    }
    let (source, website) = if research {
        match research_directory(&client, name).await {
            Ok(hit) => hit,
            Err(first) => directory(&client, name)
                .await
                .with_context(|| format!("科研机构来源：{first}；网站目录也未能确认"))?,
        }
    } else {
        match directory(&client, name).await {
            Ok(hit) => hit,
            Err(first) => research_directory(&client, name)
                .await
                .with_context(|| format!("网站目录：{first}；科研机构目录也未能确认"))?,
        }
    };
    let host = website.domain().context("缺少官网主机名")?.to_owned();
    if ["qq.com", "google.com", "github.com", "microsoft.com", "apple.com"].contains(&host.trim_start_matches("www."))
        && norm(name) != host.trim_start_matches("www.").split('.').next().unwrap_or("")
    {
        bail!("该入口使用共享主域名，请指定产品网页的主机名")
    }
    Ok(WebsiteResult {
        name: name.into(),
        source,
        website: website.to_string(),
        hosts: vec![host],
        optional: vec![],
    })
}

#[tauri::command]
#[specta::specta]
pub async fn search_rule_website(term: String, research: Option<bool>) -> Result<WebsiteResult, String> {
    search(&term, research.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    #[ignore = "requires public product directory"]
    async fn app_matching_public_names_live() {
        let names = public_app_aliases("微信".into()).await.expect("public software names");
        assert!(names.iter().any(|s| s.eq_ignore_ascii_case("WeChat")));
    }
    #[test]
    fn website_lookup_scope() {
        let (h,o)=qq_hosts(r#"<title>QQ邮箱</title> https://wx.mail.qq.com/home https://qq.com/ https://res.wx.qq.com/static/ https://mail.qq.com.fake.invalid/"#).unwrap();
        assert_eq!(h, ["mail.qq.com", "wx.mail.qq.com"]);
        assert_eq!(o, ["res.wx.qq.com"]);
        assert!(
            entity_id(
                &json!({"search":[{"id":"Q1","label":"Test"},{"id":"Q2","label":"Test"}]}),
                "Test"
            )
            .is_err()
        );
        let claim = |url: &str| json!({"claims":{"P856":[{"rank":"normal","mainsnak":{"datavalue":{"value":url}}}]}});
        assert!(official_entry(&claim("https://host.example/service")).is_err());
        assert!(official_entry(&claim("https://127.0.0.1/")).is_err());
        assert_eq!(
            official_entry(&claim("https://email.example/")).unwrap().domain(),
            Some("email.example")
        );
    }
    #[tokio::test]
    #[ignore = "requires the live institution registry"]
    async fn institution_scope_live() {
        for term in ["北京大学", "清华大学"] {
            let result = search(term, true).await.unwrap();
            println!("{term}: {} ({})", result.website, result.source);
            assert!(result.hosts.iter().any(|h| h.ends_with(".edu.cn")));
        }
    }
    #[test]
    fn same_name_website_evidence() {
        let ids = BTreeSet::from(["Q1", "Q2"]);
        let claim = |site: &str| json!({"claims":{"P856":[{"rank":"normal","mainsnak":{"datavalue":{"value":site}}}]}});
        let mut data = json!({"entities":{"Q1":claim("https://www.example.edu/"),"Q2":{"claims":{}}}});
        assert_eq!(
            choose_website(&data, &ids, "Example").unwrap().1.domain(),
            Some("www.example.edu")
        );
        data["entities"]["Q2"] = claim("https://another.edu/");
        assert!(choose_website(&data, &ids, "Example").is_err());
    }
    #[tokio::test]
    #[ignore = "requires live public sources"]
    async fn website_lookup_live() {
        for term in ["QQ邮箱", "网易邮箱"] {
            let r = search(term, term.ends_with("大学")).await.unwrap();
            println!("{term}: {:?} ({})", r.hosts, r.source);
            assert!(!r.hosts.is_empty());
            if term == "QQ邮箱" {
                assert!(r.hosts.contains(&"wx.mail.qq.com".into()));
                assert!(!r.hosts.contains(&"qq.com".into()));
            }
        }
    }
}
