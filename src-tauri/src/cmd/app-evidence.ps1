[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$entries = @{}
function Get-Entry([string]$path) {
    if ($path -notmatch '^[A-Z]:\\.+\.exe$' -or $path -match '[,\r\n]') { return }
    if ($entries.ContainsKey($path)) { return $entries[$path] }
    $file = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if (!$file -or $file.PSIsContainer) { return }
    $stem = $file.BaseName
    if ($stem -match '^(svchost|dllhost|rundll32|explorer|cmd|conhost|powershell|pwsh|msiexec|wscript|cscript|applicationframehost|msedgewebview2|node|javaw?|pythonw?|update|updater|setup|unins.*|uninstall.*)$') { return }
    $meta = $file.VersionInfo
    $entry = [pscustomobject]@{
        path = $file.FullName; names = @($stem,$meta.ProductName,$meta.FileDescription)
        publisher = $meta.CompanyName; helpers = @(); shortcut = $false
    }
    $entries[$path] = $entry
    return $entry
}
$shell = New-Object -ComObject WScript.Shell
foreach ($special in 'DesktopDirectory','CommonDesktopDirectory','Programs','CommonPrograms') {
    $dir = [Environment]::GetFolderPath($special)
    if (!$dir -or $dir -notmatch '^[A-Z]:\\') { continue }
    $links = Get-ChildItem -LiteralPath $dir -File -Filter '*.lnk' -Recurse:($special -like '*Programs')
    foreach ($file in $links) {
        $link = $shell.CreateShortcut($file.FullName)
        if ($link.Arguments -or $link.TargetPath -notmatch '\.exe$') { continue }
        $entry = Get-Entry $link.TargetPath
        if ($entry) { $entry.names += $file.BaseName; $entry.shortcut = $true }
    }
}
foreach ($key in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') {
    foreach ($app in (Get-ItemProperty $key -Name DisplayIcon,DisplayName)) {
        if (!$app.DisplayName -or !$app.DisplayIcon) { continue }
        $icon = ([string]$app.DisplayIcon -replace ',\s*-?\d+$','').Trim('"')
        $entry = Get-Entry $icon
        if ($entry) { $entry.names += $app.DisplayName }
    }
}
$byId = @{}
$session = [Diagnostics.Process]::GetCurrentProcess().SessionId
foreach ($proc in (Get-CimInstance Win32_Process -Filter "SessionId=$session" -Property ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate)) {
    $byId[$proc.ProcessId] = $proc
    $null = Get-Entry $proc.ExecutablePath
}
foreach ($proc in $byId.Values) {
    $child = $entries[[string]$proc.ExecutablePath]
    if (!$child -or !$child.publisher -or $child.shortcut -or $proc.Name -notmatch '(?:appex|helper|renderer|plugin|crashpad).*\.exe$') { continue }
    $parent = $proc
    for ($depth=0; $depth -lt 8; $depth++) {
        $prior = $parent
        $parent = $byId[$prior.ParentProcessId]
        if (!$parent -or $parent.CreationDate -gt $prior.CreationDate) { break }
        $owner = $entries[[string]$parent.ExecutablePath]
        if (!$owner -or !$owner.publisher) { break }
        $vendor = {param($s) (($s -replace '(?i)[\s,.]*(llc|inc|ltd|corp|corporation|limited)\.?$','') -replace '[\s,.]+','')}
        if ((& $vendor $child.publisher) -ne (& $vendor $owner.publisher)) { break }
        if ($owner.shortcut -and $owner.path -ne $child.path) {
            $owner.helpers += $child.path; break
        }
    }
}
$result = @(foreach ($entry in $entries.Values) {
    $names = @($entry.names | Where-Object { $_ -and $_.Length -ge 2 -and $_.Length -le 90 -and $_ -notmatch '[,\r\n]' } | Sort-Object -Unique)
    if ($names.Count) {
        [pscustomobject]@{path=$entry.path;names=$names;helpers=@($entry.helpers | Sort-Object -Unique)}
    }
})
ConvertTo-Json -InputObject $result -Compress -Depth 4
