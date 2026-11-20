$ErrorActionPreference = 'Stop'
# 32-bit NSIS invokes Windows PowerShell on a 64-bit machine.
$install = Join-Path $env:ProgramW6432 'Clash Verge AI'
if (Get-Process -Name 'clash-verge' -ErrorAction SilentlyContinue) {
    Write-Output 'Clash Verge is still running.'
    exit 2
}
$service = Get-CimInstance Win32_Service -Filter "Name='clash_verge_service'"
if ($service) {
    $image = [Environment]::ExpandEnvironmentVariables($service.PathName)
    if ($image -notmatch '^\s*"?(.+?\.exe)"?(?:\s|$)') { throw 'Cannot determine service executable.' }
    $path = [IO.Path]::GetFullPath($Matches[1])
    if ($path.StartsWith($install + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Write-Output 'This directory contains the registered service executable.'
        exit 3
    }
}
# The shared ProgramData service is managed by the client and survives uninstall.
exit 0
