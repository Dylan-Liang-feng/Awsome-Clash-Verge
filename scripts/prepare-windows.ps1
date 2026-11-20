[CmdletBinding()]
param(
    [string]$UpstreamDirectory,
    [string]$Installer,
    [string]$SevenZip
)
$ErrorActionPreference = 'Stop'
$destination = $PSScriptRoot
$hashes = Get-Content -LiteralPath (Join-Path $destination 'upstream-files.json') -Raw | ConvertFrom-Json
$installerHash = '929DA9303B643B80CE309AB29F618E37A5562F515D1FA55EBF5B86C822504450'
$installerUrl = 'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.10/Clash.Verge_2.5.10_x64-setup.exe'

function Test-Component([string]$root, $item) {
    if (!$root -or !(Test-Path -LiteralPath $root -PathType Container -ErrorAction SilentlyContinue)) { return $false }
    $file = Join-Path $root $item.path
    (Test-Path -LiteralPath $file -PathType Leaf) -and ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $item.sha256)
}

$missing = @($hashes | Where-Object { !(Test-Component $destination $_) })
if (!$missing.Count) { return }

$locations = @($UpstreamDirectory, (Join-Path $env:ProgramFiles 'Clash Verge'))
foreach ($key in 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') {
    $locations += @(Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Clash Verge*' } | ForEach-Object { if ($_.InstallLocation) { $_.InstallLocation.Trim('"') } })
}
$source = if (!$Installer) { $locations | Where-Object {
    $candidate = $_
    $candidate -and !( $missing | Where-Object { !(Test-Component $candidate $_) } | Select-Object -First 1 )
} | Select-Object -First 1 }
$tempDir = $null
try {
    if (!$source) {
        if (!$SevenZip) {
            $cmd = Get-Command 7z.exe -ErrorAction SilentlyContinue
            if ($cmd) { $SevenZip = $cmd.Source } else { $SevenZip = Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
        }
        if (!(Test-Path -LiteralPath $SevenZip -PathType Leaf)) { throw 'Install 7-Zip from https://www.7-zip.org/ or pass -UpstreamDirectory pointing to an official Clash Verge Rev 2.5.10 installation.' }
        $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('clash-verge-ai-' + [guid]::NewGuid())
        $null = New-Item -Type Directory -Path $tempDir
        if (!$Installer) {
            $Installer = Join-Path $tempDir 'upstream.exe'
            Write-Host 'Downloading the official Clash Verge Rev v2.5.10 Windows x64 package...'
            Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $Installer
        }
        if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ne $installerHash) { throw 'Upstream installer SHA-256 mismatch.' }
        $source = Join-Path $tempDir 'components'
        $paths = @($missing | ForEach-Object { $_.path.Replace('/', '\') })
        & $SevenZip x -y "-o$source" -- $Installer @paths | Out-Null
        if ($LASTEXITCODE -ne 0) { throw '7-Zip could not extract the upstream components.' }
    }
    foreach ($item in $missing) {
        if (!(Test-Component $source $item)) { throw "Component verification failed for $($item.path)." }
        $out = Join-Path $destination $item.path
        $null = [IO.Directory]::CreateDirectory((Split-Path $out))
        Copy-Item -LiteralPath (Join-Path $source $item.path) -Destination $out -Force
        if (!(Test-Component $destination $item)) { throw "Copy verification failed for $($item.path)." }
    }
} finally {
    if ($tempDir) {
        $resolved = (Resolve-Path -LiteralPath $tempDir).Path
        if ((Split-Path $resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and (Split-Path $resolved -Leaf) -match '^clash-verge-ai-[a-f0-9-]{36}$') { Remove-Item -LiteralPath $resolved -Recurse -Force }
    }
}
