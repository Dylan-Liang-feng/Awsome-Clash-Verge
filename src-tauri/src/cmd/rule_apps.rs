use std::collections::BTreeMap;

#[tauri::command]
#[specta::specta]
pub fn rule_application_folders() -> BTreeMap<String, String> {
    #[cfg(windows)]
    return windows_folders();
    #[cfg(not(windows))]
    BTreeMap::new()
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AppEvidence {
    path: String,
    names: Vec<String>,
    helpers: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn rule_app_evidence() -> Result<Vec<AppEvidence>, String> {
    #[cfg(windows)]
    {
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let script = include_str!("app-evidence.ps1");
        let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let system = std::env::var_os("SystemRoot").ok_or("找不到 Windows 目录")?;
        let exe = std::path::PathBuf::from(system).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
        let mut cmd = tokio::process::Command::new(exe);
        cmd.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &STANDARD.encode(bytes),
        ])
        .creation_flags(0x08000000)
        .kill_on_drop(true);
        let out = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
            .await
            .map_err(|_| "本机程序检查超时")?
            .map_err(|_| "无法检查本机程序")?;
        if !out.status.success() {
            return Err("读取本机程序信息失败".into());
        }
        serde_json::from_slice(&out.stdout).map_err(|_| "无法读取本机程序清单".into())
    }
    #[cfg(not(windows))]
    Ok(vec![])
}

#[cfg(windows)]
fn windows_folders() -> BTreeMap<String, String> {
    use std::path::Path;
    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY},
    };

    let mut apps = BTreeMap::new();
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            let Ok(list) = RegKey::predef(hive)
                .open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", KEY_READ | view)
            else {
                continue;
            };
            for id in list.enum_keys().flatten() {
                let Ok(key) = list.open_subkey(id) else { continue };
                let Ok(name) = key.get_value::<String, _>("DisplayName") else {
                    continue;
                };
                if name.trim().is_empty() {
                    continue;
                }
                let location = key.get_value::<String, _>("InstallLocation").unwrap_or_default();
                let uninstall = key.get_value::<String, _>("UninstallString").unwrap_or_default();
                let command = uninstall.trim().trim_start_matches('"');
                let parent = command
                    .to_lowercase()
                    .find(".exe")
                    .and_then(|i| command.get(..i + 4))
                    .and_then(|exe| Path::new(exe).parent());
                for folder in [Some(Path::new(location.trim_matches('"'))), parent]
                    .into_iter()
                    .flatten()
                {
                    let Some(last) = folder.file_name() else { continue };
                    let leaf = last.to_string_lossy().to_lowercase();
                    // Shared uninstallers and system folders must never become whole-folder rules.
                    if folder.is_absolute()
                        && folder.is_dir()
                        && name.chars().count() >= 2
                        && (leaf == name.to_lowercase() || leaf.starts_with(&format!("{}(", name.to_lowercase())))
                    {
                        apps.insert(name.clone(), folder.display().to_string());
                        break;
                    }
                }
            }
        }
    }
    apps
}
