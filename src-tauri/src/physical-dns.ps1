$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$physical = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object ifIndex)
$routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object { $physical -contains $_.ifIndex })
if (!$routes) { $routes = @(Get-NetRoute -AddressFamily IPv6 -DestinationPrefix '::/0' | Where-Object { $physical -contains $_.ifIndex }) }
$best = $routes | Sort-Object @{Expression={ [int]$_.RouteMetric + [int]$_.InterfaceMetric }} | Select-Object -First 1
if (!$best) { throw 'No physical default route' }
$dns = @(Get-DnsClientServerAddress -InterfaceIndex $best.ifIndex | ForEach-Object ServerAddresses | Where-Object { $_ -and $_ -notmatch '^(fec0:|fe80:|::1$|127\.|0\.0\.0\.0$|198\.(18|19)\.)' })
[pscustomobject]@{name=$best.InterfaceAlias;dns=$dns} | ConvertTo-Json -Compress
