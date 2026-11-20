param(
    [Parameter(Mandatory)][string]$Binary,
    [Parameter(Mandatory)][string]$Destination,
    [switch]$ServiceMode
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
if (Test-Path -LiteralPath $Destination) { throw 'Choose a new output directory so an existing profile is preserved.' }
$dst = (New-Item -ItemType Directory -Path $Destination).FullName
Copy-Item -LiteralPath $Binary -Destination (Join-Path $dst 'clash-verge.exe')
foreach ($name in 'verge-mihomo','verge-mihomo-alpha') {
    $fileName = if ($ServiceMode) { "$name.exe" } else { "local-ai-$name.exe" }
    Copy-Item -LiteralPath (Join-Path $repo "src-tauri/sidecar/$name-x86_64-pc-windows-msvc.exe") -Destination (Join-Path $dst $fileName)
}
$resources = New-Item -ItemType Directory -Path (Join-Path $dst 'resources')
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'upstream-files.json') -Raw | ConvertFrom-Json
foreach ($item in $manifest | Where-Object { $_.path -like 'resources/*' }) {
    Copy-Item -LiteralPath (Join-Path $repo ('src-tauri/' + $item.path)) -Destination $resources.FullName
}
Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination $dst

if ($ServiceMode) { return }

$profile = (New-Item -ItemType Directory -Path (Join-Path $dst 'profile/profiles') -Force).FullName
$encoding = [Text.UTF8Encoding]::new($false)
function Write-ProfileFile([string]$Name,[string]$Text) {
    [IO.File]::WriteAllText((Join-Path $profile $Name),$Text,$encoding)
}
Write-ProfileFile 'demo.yaml' @'
mode: rule
proxies:
  - {name: Existing local proxy, type: http, server: 127.0.0.1, port: 7897}
proxy-groups:
  - {name: Test Proxy, type: select, proxies: [Existing local proxy, DIRECT]}
rules:
  - MATCH,DIRECT
'@
$items = @(
    'current: LocalDemo',
    'items:',
    '  - {uid: Merge, type: merge, file: Merge.yaml}',
    '  - {uid: Script, type: script, file: Script.js}',
    '  - {uid: LocalDemo, type: local, name: Local AI Demo, file: demo.yaml, option: {merge: DemoMerge, script: DemoScript, rules: DemoRules, proxies: DemoProxies, groups: DemoGroups}}'
)
Write-ProfileFile 'Merge.yaml' '{}'
Write-ProfileFile 'Script.js' 'function main(config) { return config; }'
foreach ($type in 'merge','script','rules','proxies','groups') {
    $uid = 'Demo' + (Get-Culture).TextInfo.ToTitleCase($type)
    $file = if ($type -eq 'script') { "$uid.js" } else { "$uid.yaml" }
    $items += "  - {uid: $uid, type: $type, file: $file}"
    $body = switch ($type) {
        'merge' { '{}' }
        'script' { 'function main(config) { return config; }' }
        default { "{prepend: [], append: [], delete: []}" }
    }
    Write-ProfileFile $file $body
}
[IO.File]::WriteAllLines((Join-Path $dst 'profile/profiles.yaml'),$items,$encoding)
[IO.File]::WriteAllLines((Join-Path $dst 'profile/verge.yaml'),@(
    'language: zh','enable_tun_mode: false','enable_system_proxy: false',
    'auto_check_update: false','verge_mixed_port: 17897','enable_auto_launch: false'
),$encoding)
[IO.File]::WriteAllLines((Join-Path $dst 'profile/config.yaml'),@(
    'mode: rule','mixed-port: 17897',"external-controller: ''",'allow-lan: false','tun: {enable: false}'
),$encoding)
