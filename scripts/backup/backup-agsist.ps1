# AGSIST monthly backup, run from the SSD by double-clicking backup-agsist.cmd.
#
#   repos\   a full mirror of each GitHub repo (git clone --mirror the first
#            time, git remote update --prune after). Login is Git Credential
#            Manager's browser window, the first time only. No token is ever
#            put in a URL or saved by this script for GitHub.
#   kv\      kv-YYYY-MM-DD.json: every key and value in the subs worker's KV
#            store (subscribers, alerts, orders), from GET /export. The newest
#            12 are kept.
#   log\     backup-YYYY-MM-DD.txt: counts only, never an address or a value.
#
# LIST_TOKEN is asked for once (typing is hidden) and kept next to this
# script in list-token.dpapi, locked with Windows DPAPI to this Windows user
# on this PC. Another user, or another PC, cannot read it.
#
# Works in Windows PowerShell 5.1 (built into Windows 10 and 11) and in
# PowerShell 7. This file is plain ASCII on purpose: 5.1 misreads UTF-8.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repos = @('feedbag', 'agsist', 'bids', 'flashgrain')
$Owner = 'dnilgis'
$ExportUrl = 'https://agsist-subs.dnilgis.workers.dev/export'
$TokenFile = Join-Path $Here 'list-token.dpapi'
$Keep = 12
$Inv = [Globalization.CultureInfo]::InvariantCulture
$Today = Get-Date
$Stamp = $Today.ToString('yyyy-MM-dd', $Inv)
$Nice = $Today.ToString('MMM d yyyy', $Inv)
$RepoDir = Join-Path $Here 'repos'
$KvDir = Join-Path $Here 'kv'
$LogDir = Join-Path $Here 'log'
$LogFile = Join-Path $LogDir ('backup-' + $Stamp + '.txt')
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$line) {
    # Counts and step names only. Never a token, an address or a value.
    try {
        $t = (Get-Date).ToString('HH:mm:ss', $Inv)
        [IO.File]::AppendAllText($LogFile, ($t + '  ' + $line + "`r`n"), $Utf8)
    } catch { }
}

function Stop-Backup([string]$what, [string]$todo) {
    Write-Log ('FAILED: ' + $what)
    Write-Host ''
    Write-Host ('Backup failed: ' + $what + ' ' + $todo) -ForegroundColor Red
    exit 1
}

function Format-N([long]$n) { return $n.ToString('N0', $Inv) }

# Anything unexpected still ends in one plain line, exit 1. The log gets the
# kind of error only: an error's text can quote what was being read.
trap {
    Write-Log ('FAILED: unexpected ' + $_.Exception.GetType().Name)
    Write-Host ''
    Write-Host ('Backup failed: something unexpected went wrong (' + $_.Exception.Message + '). Double-click backup-agsist again; if it fails twice, tell Claude what this line says.') -ForegroundColor Red
    exit 1
}

# Read JSON into dictionaries, case-sensitive and with no size cap, in 5.1 and 7.
function Read-Json([string]$text) {
    if ($PSVersionTable.PSVersion.Major -ge 6) { return ($text | ConvertFrom-Json -AsHashtable) }
    Add-Type -AssemblyName System.Web.Extensions
    $js = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $js.MaxJsonLength = [int]::MaxValue
    $js.RecursionLimit = 1000
    return $js.DeserializeObject($text)
}

foreach ($d in @($RepoDir, $KvDir, $LogDir)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}
Write-Log ('Backup started in ' + $Here)

# ---------- 1. git ----------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-Backup 'Git is not installed on this PC.' 'Get Git for Windows from https://git-scm.com/download/win (keep the default choices), then double-click backup-agsist again.'
}

# ---------- 2. the repos ----------
Write-Host 'Backing up the GitHub repos...'
$repoOk = 0
foreach ($name in $Repos) {
    $url = 'https://github.com/' + $Owner + '/' + $name + '.git'
    $dir = Join-Path $RepoDir ($name + '.git')
    Write-Host ('  ' + $name)
    # git writes progress to stderr; in Windows PowerShell 5.1 with Stop that can
    # turn into an error, so git runs with Continue and is judged by its exit code.
    $ErrorActionPreference = 'Continue'
    if (Test-Path -LiteralPath (Join-Path $dir 'HEAD')) {
        & git -C $dir remote update --prune
        $rc = $LASTEXITCODE
        $how = 'updated'
    } else {
        if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
        & git clone --mirror $url $dir
        $rc = $LASTEXITCODE
        $how = 'cloned'
        if ($rc -ne 0 -and (Test-Path -LiteralPath $dir)) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    $refs = 0
    if ($rc -eq 0) { $refs = @(& git -C $dir for-each-ref --format='%(refname)').Count }
    $ErrorActionPreference = 'Stop'
    if ($rc -ne 0) {
        Stop-Backup ('GitHub repo ' + $name + ' could not be ' + $how + '.') 'Check the internet connection, sign in to GitHub as dnilgis in the window that opens, and double-click backup-agsist again.'
    }
    Write-Log ($name + ': ' + $how + ', ' + $refs + ' refs')
    $repoOk++
}

# ---------- 3. the token ----------
function Read-SavedToken {
    if (-not (Test-Path -LiteralPath $TokenFile)) { return $null }
    try {
        $sec = (Get-Content -LiteralPath $TokenFile -Raw).Trim() | ConvertTo-SecureString
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } catch { return $null }
}

$token = Read-SavedToken
$fresh = $false
if (-not $token) {
    Write-Host ''
    Write-Host 'One time only: paste LIST_TOKEN (the subs worker secret) and press Enter. The typing stays hidden.'
    $sec = Read-Host -Prompt 'LIST_TOKEN' -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    $token = ($token -replace '\s', '')
    if (-not $token) { Stop-Backup 'No LIST_TOKEN was pasted.' 'Double-click backup-agsist again and paste the token when it asks.' }
    $fresh = $true
}

# ---------- 4. the KV store, page by page ----------
Write-Host ''
Write-Host 'Downloading the subscriber and order records...'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromSeconds(180)
$http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
$http.DefaultRequestHeaders.CacheControl = New-Object System.Net.Http.Headers.CacheControlHeaderValue
$http.DefaultRequestHeaders.CacheControl.NoCache = $true
$strict = New-Object System.Text.UTF8Encoding($false, $true)

# The page ends with these fields, after the keys array (the worker writes them in this order).
$tail = [regex]'\],"count":(\d+),"gone":(\d+),"cursor":(null|"([A-Za-z0-9_-]*)"),"done":(true|false)\}\s*$'
$head = '"keys":['

function Get-Page([string]$cursor) {
    $u = $ExportUrl
    if ($cursor) { $u = $u + '?cursor=' + [Uri]::EscapeDataString($cursor) }
    $last = ''
    for ($try = 1; $try -le 3; $try++) {
        try {
            $resp = $http.GetAsync($u).GetAwaiter().GetResult()
            $code = [int]$resp.StatusCode
            if ($code -eq 403) { return @{ refused = $true } }
            $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
            if ($code -eq 200) { return @{ refused = $false; text = $strict.GetString($bytes) } }
            $last = 'the worker answered ' + $code
            if ($code -lt 500) { break }
        } catch {
            $last = 'no answer from the worker'
        }
        Start-Sleep -Seconds (5 * $try)
    }
    return @{ refused = $false; error = $last }
}

$parts = New-Object System.Collections.Generic.List[string]
$total = 0
$gone = 0
$pages = 0
$cursor = ''
do {
    $p = Get-Page $cursor
    if ($p.refused) {
        if (-not $fresh) { Remove-Item -LiteralPath $TokenFile -Force -ErrorAction SilentlyContinue }
        Stop-Backup 'The worker refused LIST_TOKEN.' 'The saved token was removed. Double-click backup-agsist again and paste the current LIST_TOKEN from Cloudflare.'
    }
    if ($p.ContainsKey('error')) {
        Stop-Backup ('Downloading the records failed on page ' + ($pages + 1) + ' (' + $p.error + ').') 'Check the internet connection and double-click backup-agsist again. The repos are already saved.'
    }
    $text = $p.text
    $m = $tail.Match($text)
    $at = $text.IndexOf($head)
    if (-not $m.Success -or $at -lt 0 -or -not $text.StartsWith('{"ok":true,')) {
        Stop-Backup ('The worker sent a page this script does not understand (page ' + ($pages + 1) + ').') 'Tell Claude: the /export answer changed shape. Nothing was deleted.'
    }
    $count = [int]$m.Groups[1].Value
    $gone += [int]$m.Groups[2].Value
    $inner = $text.Substring($at + $head.Length, $m.Index - ($at + $head.Length))
    if ($inner.Trim().Length -gt 0) { $parts.Add($inner) }
    $total += $count
    $pages++
    if ($fresh -and $pages -eq 1) {
        # The token worked: keep it, locked to this Windows user.
        $sec = ConvertTo-SecureString $token -AsPlainText -Force
        [IO.File]::WriteAllText($TokenFile, (ConvertFrom-SecureString $sec), $Utf8)
        Write-Log 'LIST_TOKEN saved with Windows DPAPI (this user only)'
    }
    if ($m.Groups[5].Value -eq 'true') { $cursor = '' } else { $cursor = $m.Groups[4].Value }
    if ($m.Groups[5].Value -ne 'true' -and -not $cursor) {
        Stop-Backup 'The worker said there was more but gave no cursor.' 'Tell Claude: the /export cursor is missing. Nothing was deleted.'
    }
    Write-Host ('  page ' + $pages + ': ' + (Format-N $total) + ' records so far')
} while ($cursor)
$http.Dispose()
$token = $null

# ---------- 5. write, then check what was written ----------
$final = Join-Path $KvDir ('kv-' + $Stamp + '.json')
$partial = $final + '.partial'
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"source":"agsist-subs /export","exported_at":"')
[void]$sb.Append((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', $Inv))
[void]$sb.Append('","count":' + $total + ',"keys":[')
[void]$sb.Append([string]::Join(',', $parts.ToArray()))
[void]$sb.Append(']}')
[IO.File]::WriteAllText($partial, $sb.ToString(), $Utf8)
$sb = $null
$parts = $null

try {
    $back = Read-Json ([IO.File]::ReadAllText($partial, $strict))
} catch {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    Stop-Backup 'The saved records file did not read back as JSON.' 'Double-click backup-agsist again. If it happens twice, tell Claude.'
}
$n = @($back['keys']).Count
if ($n -ne $total -or [long]$back['count'] -ne $total) {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    Stop-Backup ('The record count did not match (' + (Format-N $n) + ' saved, ' + (Format-N $total) + ' sent).') 'Double-click backup-agsist again. If it happens twice, tell Claude.'
}
if ($total -eq 0) {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    Stop-Backup 'The worker sent 0 records.' 'Nothing was deleted. Tell Claude: /export came back empty.'
}

# Counts by kind (the part of the key before the first colon). Never a key itself.
$kinds = @{}
foreach ($k in @($back['keys'])) {
    $nm = [string]$k['name']
    $i = $nm.IndexOf(':')
    if ($i -gt 0) { $kind = $nm.Substring(0, $i) } else { $kind = '(no colon)' }
    if ($kinds.ContainsKey($kind)) { $kinds[$kind]++ } else { $kinds[$kind] = 1 }
}
$back = $null

# The last backup before this one, to catch a store that suddenly shrank.
$older = @(Get-ChildItem -LiteralPath $KvDir -Filter 'kv-????-??-??.json' | Where-Object { $_.Name -ne ('kv-' + $Stamp + '.json') } | Sort-Object Name -Descending)
$prevCount = -1
if ($older.Count -gt 0) {
    $fs = [IO.File]::OpenRead($older[0].FullName)
    try {
        $buf = New-Object byte[] 200
        $got = $fs.Read($buf, 0, 200)
        $pm = [regex]::Match($Utf8.GetString($buf, 0, $got), '"count":(\d+)')
        if ($pm.Success) { $prevCount = [long]$pm.Groups[1].Value }
    } finally { $fs.Close() }
}

Move-Item -LiteralPath $partial -Destination $final -Force
$sizeMb = [math]::Round((Get-Item -LiteralPath $final).Length / 1MB, 1)
Write-Log ('kv: ' + $total + ' records in ' + $pages + ' pages, ' + $sizeMb + ' MB, ' + $gone + ' expired while reading')
foreach ($kind in ($kinds.Keys | Sort-Object)) { Write-Log ('kv ' + $kind + ': ' + $kinds[$kind]) }

if ($prevCount -gt 0 -and $total -lt ($prevCount / 2)) {
    Write-Log ('kv: fewer than half of the last backup (' + $prevCount + '); old backups kept')
    Stop-Backup ('Only ' + (Format-N $total) + ' records came back, under half of last time (' + (Format-N $prevCount) + ').') 'Today''s file is saved and no old backup was deleted. Tell Claude before the next backup.'
}

# Keep the newest 12.
$all = @(Get-ChildItem -LiteralPath $KvDir -Filter 'kv-????-??-??.json' | Sort-Object Name -Descending)
$removed = 0
if ($all.Count -gt $Keep) {
    foreach ($f in $all[$Keep..($all.Count - 1)]) { Remove-Item -LiteralPath $f.FullName -Force; $removed++ }
}
Get-ChildItem -LiteralPath $KvDir -Filter '*.partial' | Remove-Item -Force -ErrorAction SilentlyContinue
Write-Log ('kv: ' + $removed + ' old backups removed, ' + [math]::Min($all.Count, $Keep) + ' kept')

$done = 'Backup done: ' + $repoOk + ' repos up to date, ' + (Format-N $total) + ' records saved, ' + $Nice + '.'
Write-Log $done
Write-Host ''
Write-Host $done -ForegroundColor Green
exit 0
