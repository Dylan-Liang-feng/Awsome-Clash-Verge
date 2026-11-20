use anyhow::{Context as _, Result, bail, ensure};
use reqwest::Url;
use serde_json::{Value, json};
use std::time::Duration;

fn endpoint(address: &str) -> Result<Url> {
    let mut url = Url::parse(address.trim()).context("请填写完整的 API 地址")?;
    ensure!(
        url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none(),
        "API 地址不能包含凭据、查询参数或片段"
    );
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']');
    let loopback = host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    ensure!(
        url.scheme() == "https" || (url.scheme() == "http" && loopback),
        "请使用 HTTPS；本机回环地址也支持 HTTP"
    );
    let path = url.path().trim_end_matches('/');
    if !path.ends_with("/chat/completions") {
        url.set_path(&format!("{path}/chat/completions"));
    } else {
        let p = path.to_owned();
        url.set_path(&p);
    }
    Ok(url)
}

#[cfg(windows)]
mod keys {
    use anyhow::{Result, ensure};
    use sha2::{Digest, Sha256};
    use windows_sys::Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*};
    fn name(url: &str) -> Vec<u16> {
        let hash: String = Sha256::digest(url.as_bytes())
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect();
        format!("ClashVergeLocalAI/RuleAPI/{hash}")
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }
    pub(super) fn read(url: &str) -> Result<String> {
        let mut raw = std::ptr::null_mut();
        if unsafe { CredReadW(name(url).as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                return Ok(String::new());
            }
            return Err(err.into());
        }
        let cred = unsafe { &*raw };
        let bytes = if cred.CredentialBlobSize == 0 {
            vec![]
        } else {
            unsafe { std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize) }.to_vec()
        };
        unsafe { CredFree(raw.cast()) };
        Ok(String::from_utf8(bytes)?)
    }
    pub(super) fn write(url: &str, key: &str) -> Result<()> {
        let mut name = name(url);
        if key.is_empty() {
            if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() != Some(ERROR_NOT_FOUND as i32) {
                    return Err(err.into());
                }
            }
        } else {
            ensure!(
                key.len() <= 2560 && !key.chars().any(char::is_control),
                "密钥格式或长度无效"
            );
            let cred = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: name.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                CredentialBlobSize: key.len() as u32,
                CredentialBlob: key.as_ptr().cast_mut(),
                ..Default::default()
            };
            if unsafe { CredWriteW(&cred, 0) } == 0 {
                return Err(std::io::Error::last_os_error().into());
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod keys {
    use anyhow::Result;
    use std::{collections::BTreeMap, sync::LazyLock};
    static KEYS: LazyLock<parking_lot::Mutex<BTreeMap<String, String>>> = LazyLock::new(Default::default);
    pub(super) fn read(url: &str) -> Result<String> {
        Ok(KEYS.lock().get(url).cloned().unwrap_or_default())
    }
    pub(super) fn write(url: &str, key: &str) -> Result<()> {
        KEYS.lock().insert(url.into(), key.into());
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub fn configure_rule_api(address: String, key: Option<String>) -> Result<bool, String> {
    let url = endpoint(&address).map_err(|e| e.to_string())?;
    if let Some(key) = key {
        keys::write(url.as_str(), key.trim()).map_err(|e| e.to_string())?;
    }
    Ok(!keys::read(url.as_str()).map_err(|e| e.to_string())?.is_empty())
}

#[tauri::command]
#[specta::specta]
pub async fn request_rule_plan(
    address: String,
    model: String,
    prompt: String,
    request: String,
) -> Result<String, String> {
    call(&address, &model, &prompt, &request)
        .await
        .map_err(|e| e.to_string())
}

async fn call(address: &str, model: &str, prompt: &str, request: &str) -> Result<String> {
    ensure!(!model.trim().is_empty() && model.len() <= 256, "请填写模型 ID");
    ensure!(
        prompt.len() <= 24_000 && !request.trim().is_empty() && request.len() <= 18_000,
        "输入内容过长或为空"
    );
    let url = endpoint(address)?;
    let key = keys::read(url.as_str())?;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(65))
        .build()?;
    let system = format!("{}\n\n{}", prompt.trim(), include_str!("rule-api-contract.txt"));
    let mut post=http.post(url).json(&json!({"model":model.trim(),"stream":false,"messages":[{"role":"system","content":system},{"role":"user","content":request}]}));
    if !key.is_empty() {
        post = post.bearer_auth(key);
    }
    let mut resp = post.send().await.map_err(|e| {
        if e.is_timeout() {
            anyhow::anyhow!("模型 API 请求超时")
        } else {
            anyhow::anyhow!("未能连接模型 API，请检查地址与网络")
        }
    })?;
    ensure!(
        resp.status().is_success(),
        "模型 API 返回 HTTP {}，请核对接口、模型、密钥或配额",
        resp.status().as_u16()
    );
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        ensure!(buf.len() + chunk.len() <= 2 * 1024 * 1024, "模型响应过大");
        buf.extend_from_slice(&chunk);
    }
    let body: Value = serde_json::from_slice(&buf).context("接口没有返回 Chat Completions JSON")?;
    if matches!(
        body.pointer("/choices/0/finish_reason").and_then(Value::as_str),
        Some("length" | "content_filter")
    ) {
        bail!("模型回复不完整")
    }
    Ok(body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .context("接口未返回有效的 choices[0].message.content")?
        .to_owned())
}

#[cfg(test)]
mod tests {
    use super::endpoint;
    #[test]
    fn rule_api_endpoint_scope() {
        for (input, expected) in [
            (
                "https://provider.example/v1/",
                "https://provider.example/v1/chat/completions",
            ),
            (
                "http://127.0.0.1:11434/v1/chat/completions/",
                "http://127.0.0.1:11434/v1/chat/completions",
            ),
        ] {
            assert_eq!(endpoint(input).unwrap().as_str(), expected);
        }
        for invalid in [
            "http://remote.example/v1",
            "https://user:pwd@example.com/v1",
            "https://example.com/v1?key=secret",
            "file:///tmp/a",
        ] {
            assert!(endpoint(invalid).is_err());
        }
    }
}
