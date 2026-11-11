# 实时会话（live session）端到端验收：真窗口 + 真 socket + 真 Session
#
# 验的是这一件事：AI 通过 API 对「屏幕上那个工程」发一条编辑，窗口里当场变化，
# 而且窗口和 API 共用一份撤销历史、共用 revision。
#
#   powershell -File tools\concat-dev\live-runtime-probe.ps1
#   powershell -File tools\concat-dev\live-runtime-probe.ps1 -KeepOpen   # 跑完不关窗口
#
# 全程使用独立 HOME（APPDATA/LOCALAPPDATA 指向验证目录），不碰你自己的设置。
# 依赖：Concat/src/target/debug/concat.exe 已构建（powershell -File tools\concat-dev\dev.ps1 build concat -Profile dev）

[CmdletBinding()]
param(
    [string]$Root = 'D:\notebook\AIGC\CREATION-PIPELINE',
    [int]$Port = 7420,
    [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path $Root 'Concat\src\target\debug\concat.exe'
if (-not (Test-Path $exe)) { throw "没有构建产物：$exe" }
Get-Process concat -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$work  = Join-Path $Root 'outputs\concat-validation\live-runtime'
$conf  = Join-Path $work 'app.concat.editor'          # %APPDATA%\<identifier>
$temp  = Join-Path $work 'temp'
$projs = Join-Path $work 'projects'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $conf, $temp, $projs | Out-Null

$ffmpeg = Join-Path $Root 'outputs\concat-validation\deps\ffmpeg\ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1\bin'
$env:APPDATA = $work
$env:LOCALAPPDATA = $work
$env:TEMP = $temp
$env:TMP = $temp
$env:PATH = "$ffmpeg;$env:PATH"

# 32 位十六进制，过得了 check_token 的强度检查
$bytes = New-Object byte[] 16
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''

# UTF-8 不带 BOM：Concat 用 serde_json 读这个文件，BOM 会让整份设置回落到
# 默认值（自动化就关掉了），窗口日志里是一行 "did not read whole"。
$settings = @{ server = @{ enabled = $true; listen = "127.0.0.1:$Port"; token = $token } } |
    ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
    (Join-Path $conf 'settings.json'),
    $settings,
    (New-Object System.Text.UTF8Encoding($false)))

$report = [ordered]@{ started = (Get-Date).ToString('s'); steps = @(); verdict = 'unknown' }
function Step($name, $ok, $detail) {
    $script:report.steps += [ordered]@{ step = $name; ok = $ok; detail = $detail }
    $mark = if ($ok) { 'OK  ' } else { 'FAIL' }
    Write-Host ("[{0}] {1} - {2}" -f $mark, $name, $detail)
}

# ── 1. 用 MCP headless 建一个空工程（这是窗口待会儿要打开的那个） ──────────
# 走文件而不是管道：stdin 从文件来，MCP 读完就自己退出，不会有一个等消息
# 的进程挂在那里。
$env:CONCAT_MCP_ROOTS = $projs
$mcpIn = Join-Path $work 'mcp-create.jsonl'
$mcpOut = Join-Path $work 'mcp-create.out.jsonl'
$mcpErr = Join-Path $work 'mcp-create.err.log'
$jsonLines = @(
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"live-probe","version":"1"}}}'
    '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    ('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"project_create","arguments":{"location":' + (($projs -replace '\\', '\\') | ConvertTo-Json) + ',"name":"LiveProof"}}}')
)
[System.IO.File]::WriteAllText($mcpIn, (($jsonLines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
$mcp = Start-Process -FilePath $exe -ArgumentList '--mcp', 'headless' `
    -RedirectStandardInput $mcpIn -RedirectStandardOutput $mcpOut -RedirectStandardError $mcpErr `
    -PassThru -NoNewWindow
if (-not $mcp.WaitForExit(60000)) { $mcp.Kill(); throw 'MCP 进程没有在读完后退出' }
$answered = Get-Content $mcpOut | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object { $_.id -eq 2 } | Select-Object -First 1
if ($null -eq $answered) {
    Get-Content $mcpErr -Tail 5 | ForEach-Object { Write-Host "  mcp: $_" }
    throw 'MCP 没有回答 project_create'
}
$created = $answered

$projectPath = Join-Path $projs 'LiveProof'
Step 'project created (headless MCP)' (Test-Path $projectPath) $projectPath

# ── 2. 开窗口，打开那个工程；窗口自己把会话挂上 live 注册表 ────────────────
$gui = Start-Process -FilePath $exe -ArgumentList @('--project', $projectPath) -PassThru
Step 'window started' ($null -ne $gui) "pid=$($gui.Id)"

$listing = Join-Path $conf 'automation.json'
$deadline = (Get-Date).AddSeconds(60)
while (-not (Test-Path $listing) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path $listing)) { Step 'automation listing' $false 'automation.json never appeared'; $report | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $work 'report.json'); throw 'no automation.json' }
$auto = Get-Content $listing -Raw | ConvertFrom-Json
Step 'automation server listening' $true ($auto | ConvertTo-Json -Compress)

# ── 3. socket：auth → project.open（应当拿到**窗口那一份**会话） ────────────
$client = New-Object System.Net.Sockets.TcpClient
$client.Connect('127.0.0.1', [int]($auto.address -split ':')[-1])
$stream = $client.GetStream()
$stream.ReadTimeout = 30000
$writer = New-Object System.IO.StreamWriter($stream)
$writer.AutoFlush = $true
$reader = New-Object System.IO.StreamReader($stream)
$script:events = New-Object System.Collections.ArrayList

function Rpc($id, $method, $params) {
    $line = @{ jsonrpc = '2.0'; id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 10 -Compress
    $writer.WriteLine($line)
    while ($true) {
        $out = $reader.ReadLine()
        if ($null -eq $out) { throw "socket 断开了（$method）" }
        $obj = $out | ConvertFrom-Json
        if ($null -eq $obj.id) { [void]$script:events.Add($obj); continue }
        if ($obj.id -eq $id) { return $obj }
    }
}

$auth = Rpc 1 'auth' @{ token = $auto.token }
Step 'auth' ($null -ne $auth.result) 'token accepted'

# 窗口刚起时它会先把工程占住再打开（否则 API 抢走会把窗口锁在外面），
# 这里重试到窗口的会话真的在屏幕上了为止。
$rev0 = $null
$tries = 0
$lastError = $null
while ($tries -lt 60) {
    $tries++
    $opened = Rpc (100 + $tries) 'project.open' @{ path = $projectPath }
    if ($opened.error) { $lastError = $opened.error; Start-Sleep -Milliseconds 500; continue }
    $rev0 = $opened.result.revision
    break
}
if ($null -eq $rev0) {
    Step 'project.open serves the window session' $false ($lastError | ConvertTo-Json -Compress)
    $report.verdict = 'failed'
} else {
    Step 'project.open serves the window session' $true "revision=$rev0 after $tries try/tries (a refusal would mean the live link is not attached)"
}

# capability 应报 live
$ver = Rpc 3 'version' @{}
$hasLive = ($ver.result.capabilities -contains 'live')
Step 'version says live' $hasLive (($ver.result.capabilities) -join ',')

# ── 4. 一条编辑：加一个字幕片段 ───────────────────────────────────────────
$apply = Rpc 4 'edit.apply' @{
    path = $projectPath
    command = @{ op = 'addTextClip'; start = 1.0 }
    expectedRevision = $rev0
}
if ($apply.error) {
    Step 'edit.apply through the window' $false ($apply.error | ConvertTo-Json -Compress)
} else {
    $rev1 = $apply.result.revision
    Step 'edit.apply through the window' ($rev1 -eq ($rev0 + 1)) "revision $rev0 -> $rev1"
}

$after = Rpc 5 'project.get' @{ path = $projectPath }
$clips = 0
foreach ($timeline in $after.result.project.timelines) { $clips += @($timeline.clips).Count }
Step 'the clip is in the session' ($clips -ge 1) "clips=$clips revision=$($after.result.revision)"

# 事件：编辑要广播给所有连接
$edited = $script:events | Where-Object { $_.method -eq 'project.edited' } | Select-Object -First 1
$report.steps += [ordered]@{ step = 'project.edited broadcast'; ok = ($null -ne $edited); detail = ($edited | ConvertTo-Json -Compress) }
Write-Host ("[{0}] project.edited broadcast - {1}" -f $(if ($edited) { 'OK  ' } else { 'FAIL' }), ($edited | ConvertTo-Json -Compress))

# ── 5. 过期版本必须被拒（人和 AI 共用历史的前提） ─────────────────────────
$stale = Rpc 6 'edit.apply' @{
    path = $projectPath
    command = @{ op = 'addTextClip'; start = 2.0 }
    expectedRevision = 0
}
$conflict = ($null -ne $stale.error) -and ($stale.error.data.code -eq 'conflict')
Step 'a stale expectedRevision is refused' $conflict ($stale.error | ConvertTo-Json -Compress)

# 撤销：API 撤得掉窗口里的那一步
$undo = Rpc 7 'edit.undo' @{ path = $projectPath }
$undone = (-not $undo.error) -and ($undo.result.revision -gt ($rev0 + 1))
Step 'undo through the window' $undone ("revision=" + $(if ($undo.error) { $undo.error.data.code } else { $undo.result.revision }))

$writer.Close(); $client.Close()

$passed = (@($report.steps | Where-Object { -not $_.ok }).Count -eq 0)
$report.verdict = if ($passed) { 'passed' } else { 'failed' }
$report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $work 'report.json') -Encoding UTF8
Write-Host ""
Write-Host ("verdict: {0}  ({1})" -f $report.verdict, (Join-Path $work 'report.json'))

if (-not $KeepOpen) { Stop-Process -Id $gui.Id -ErrorAction SilentlyContinue }
if (-not $passed) { exit 1 }
