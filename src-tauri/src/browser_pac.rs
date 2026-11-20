use anyhow::{Context as _, Result, ensure};
use serde::Deserialize;
use serde_yaml_ng::{Mapping, Value};
use std::{collections::BTreeSet, net::IpAddr, time::Duration};

pub const TEMPLATE: &str = "/* Local AI browser physical egress */";
const PREFIX: &str = "AND,((IN-TYPE,HTTP/HTTPS),(SRC-IP-CIDR,127.0.0.1/32),(";
const PHYSICAL: &str = "Local-AI-Physical-Egress";
fn marker(rule: &str) -> Option<(&str, &str)> {
    let (body, policy) = rule.strip_prefix(PREFIX)?.rsplit_once(")),")?;
    if !["DIRECT", PHYSICAL, "REJECT"].contains(&policy) {
        return None;
    }
    let (kind, host) = body.split_once(',')?;
    if !["DOMAIN", "DOMAIN-SUFFIX"].contains(&kind)
        || !host.contains('.')
        || host.len() > 253
        || !host.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        return None;
    }
    Some((kind, host))
}
fn domains(config: &Mapping) -> BTreeSet<(&str, &str)> {
    config
        .get("rules")
        .and_then(Value::as_sequence)
        .into_iter()
        .flatten()
        .filter_map(|v| marker(v.as_str()?))
        .collect()
}
pub fn revision(config: Option<&Mapping>) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    if let Some(c) = config {
        domains(c).hash(&mut hash);
    }
    hash.finish()
}
pub fn render(config: Option<&Mapping>, port: u16) -> String {
    let set = config.map(domains).unwrap_or_default();
    let exact: Vec<_> = set.iter().filter_map(|(k, h)| (*k == "DOMAIN").then_some(h)).collect();
    let suffix: Vec<_> = set
        .iter()
        .filter_map(|(k, h)| (*k == "DOMAIN-SUFFIX").then_some(h))
        .collect();
    format!(
        "function FindProxyForURL(url,host){{host=host.toLowerCase().replace(/\\.$/,'');var exact={},suffix={};for(var i=0;i<exact.length;i++)if(host===exact[i])return 'PROXY 127.0.0.1:{port}';for(var j=0;j<suffix.length;j++)if(host===suffix[j]||dnsDomainIs(host,'.'+suffix[j]))return 'PROXY 127.0.0.1:{port}';return 'DIRECT';}}",
        serde_json::json!(exact),
        serde_json::json!(suffix)
    )
}
#[derive(Deserialize)]
struct Adapter {
    name: String,
    dns: Vec<IpAddr>,
}
async fn physical_adapter() -> Result<Adapter> {
    let exe = std::path::PathBuf::from(std::env::var_os("SystemRoot").context("SystemRoot unavailable")?)
        .join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let script = include_str!("physical-dns.ps1");
    let encoded = STANDARD.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
    let mut cmd = tokio::process::Command::new(exe);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let result = tokio::time::timeout(
        Duration::from_secs(12),
        cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
            .kill_on_drop(true)
            .output(),
    )
    .await??;
    ensure!(result.status.success(), "Cannot read the default physical adapter");
    let nic: Adapter = serde_json::from_slice(&result.stdout)?;
    ensure!(
        !nic.name.is_empty() && !nic.name.contains(['#', '&', '%', '\n', '\r']) && !nic.dns.is_empty(),
        "No physical adapter with usable DNS"
    );
    Ok(nic)
}
pub async fn apply(config: &mut Mapping) -> Result<()> {
    let names: Vec<_> = domains(config)
        .into_iter()
        .map(|(k, h)| (k.to_owned(), h.to_lowercase()))
        .collect();
    if names.is_empty() {
        return Ok(());
    }
    let adapter = physical_adapter().await;
    let usable = adapter.as_ref().ok();
    if let Some(nic) = usable {
        let proxies = config
            .entry(Value::from("proxies"))
            .or_insert_with(|| Value::Sequence(Vec::new()))
            .as_sequence_mut()
            .context("Invalid proxies")?;
        ensure!(
            !proxies
                .iter()
                .any(|p| p.get("name").and_then(Value::as_str) == Some(PHYSICAL)),
            "Reserved physical proxy name is in use"
        );
        proxies.push(serde_yaml_ng::to_value(
            serde_json::json!({"name":PHYSICAL,"type":"direct","interface-name":nic.name}),
        )?);
        let dns = config
            .entry(Value::from("dns"))
            .or_insert_with(|| Value::Mapping(Mapping::new()))
            .as_mapping_mut()
            .context("Invalid DNS configuration")?;
        ensure!(
            dns.get("enable").and_then(Value::as_bool) != Some(false),
            "Browser bypass requires core DNS"
        );
        ensure!(
            dns.get("direct-nameserver")
                .and_then(Value::as_sequence)
                .is_none_or(Vec::is_empty)
                || dns.get("direct-nameserver-follow-policy").and_then(Value::as_bool) == Some(true),
            "Browser bypass requires direct DNS to follow domain policies"
        );
        let policy = dns
            .entry(Value::from("nameserver-policy"))
            .or_insert_with(|| Value::Mapping(Mapping::new()))
            .as_mapping_mut()
            .context("Invalid DNS policy")?;
        let upstream: Vec<String> = nic
            .dns
            .iter()
            .take(1)
            .map(|ip| match ip {
                IpAddr::V4(_) => format!("udp://{ip}:53#{}", nic.name),
                IpAddr::V6(_) => format!("udp://[{ip}]:53#{}", nic.name),
            })
            .collect();
        for (kind, host) in names {
            let key = if kind == "DOMAIN-SUFFIX" {
                format!("+.{host}")
            } else {
                host
            };
            policy.insert(key.into(), serde_yaml_ng::to_value(&upstream)?);
        }
    }
    let dest = if usable.is_some() { PHYSICAL } else { "REJECT" };
    let rules = config
        .get_mut("rules")
        .and_then(Value::as_sequence_mut)
        .context("Invalid rules")?;
    let mut first = Vec::new();
    rules.retain(|v| {
        if let Some(s) = v.as_str()
            && marker(s).is_some()
        {
            if let Some((body, _)) = s.rsplit_once(',') {
                first.push(Value::from(format!("{body},{dest}")));
                return false;
            }
        }
        true
    });
    first.append(rules);
    *rules = first;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_bypass_markers() {
        assert_eq!(
            marker(&format!("{PREFIX}DOMAIN-SUFFIX,sample.edu.cn)),DIRECT")),
            Some(("DOMAIN-SUFFIX", "sample.edu.cn"))
        );
        assert!(marker("DOMAIN-SUFFIX,sample.edu.cn,DIRECT").is_none());
        assert!(marker(&format!("{PREFIX}DOMAIN-SUFFIX,sample.edu.cn,REJECT)),DIRECT")).is_none());
    }
}
