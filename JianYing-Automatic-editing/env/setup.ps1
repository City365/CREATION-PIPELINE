# JianYing-Automatic-editing 环境自检 / 初始化
# 用法： powershell -ExecutionPolicy Bypass -File env\setup.ps1
#        powershell -ExecutionPolicy Bypass -File env\setup.ps1 -Install   # 顺带装依赖

param(
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$Base = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Split-Path -Parent $Base
$Venv = Join-Path $ProjectRoot '.venv-jianying'
$Py = Join-Path $Venv 'Scripts\python.exe'

function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red }

Write-Host ''
Write-Host '=== 1. Python 虚拟环境 ===' -ForegroundColor Cyan
if (-not (Test-Path $Py)) {
    Warn "未找到 $Py"
    if ($Install) {
        Write-Host '  创建虚拟环境...'
        python -m venv $Venv
    } else {
        Bad '缺少虚拟环境。加 -Install 参数自动创建，或手动 python -m venv .venv-jianying'
    }
}
if (Test-Path $Py) {
    $ver = & $Py -V 2>&1
    Ok "$ver  ->  $Py"
}

Write-Host ''
Write-Host '=== 2. Python 依赖 ===' -ForegroundColor Cyan
if (Test-Path $Py) {
    if ($Install) {
        $uv = Get-Command uv -ErrorAction SilentlyContinue
        $req = Join-Path $PSScriptRoot 'requirements.txt'
        if ($uv) {
            Write-Host '  uv pip install ...'
            uv pip install --python $Py -r $req
        } else {
            Write-Host '  没有 uv，尝试 ensurepip + pip ...'
            & $Py -m ensurepip --upgrade | Out-Null
            & $Py -m pip install -r $req
        }
    }
    foreach ($mod in @('pyJianYingDraft', 'capstone')) {
        $v = & $Py -c "from importlib.metadata import version; print(version('$mod'))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) { Ok "$mod $v" } else { Bad "$mod 未安装（加 -Install）" }
    }
}

Write-Host ''
Write-Host '=== 3. 剪映安装 ===' -ForegroundColor Cyan
$candidates = @(
    (Join-Path $env:ProgramFiles 'JianyingPro'),
    'D:\notebook\software\JianyingPro',
    (Join-Path $env:LOCALAPPDATA 'JianyingPro')
)
$found = $null
foreach ($c in $candidates) {
    if (-not (Test-Path $c)) { continue }
    $dirs = Get-ChildItem $c -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.FullName 'lyra-cli.exe') } |
            Sort-Object Name -Descending
    if ($dirs) { $found = $dirs[0].FullName; break }
}
if ($found) {
    Ok "安装目录 $found"
    $ver = (Get-Item (Join-Path $found 'JianyingPro.exe')).VersionInfo.FileVersion
    Ok "版本 $ver"
} else {
    Bad '没找到带 lyra-cli.exe 的剪映安装目录，设置环境变量 JIANYING_HOME 指向它'
}

Write-Host ''
Write-Host '=== 4. 草稿目录 ===' -ForegroundColor Cyan
$draftRoot = Join-Path $Base 'draft_root.txt'
$candidateDraftRoots = @(
    'D:\notebook\software\JianyingPro Drafts',
    (Join-Path $env:LOCALAPPDATA 'JianyingPro\User Data\Projects\com.lveditor.draft')
)
$draftOk = $false
foreach ($d in $candidateDraftRoots) {
    if (Test-Path $d) { Ok "草稿目录 $d"; $draftOk = $true; break }
}
if (-not $draftOk) { Warn '没找到草稿目录，部署功能会不可用' }

Write-Host ''
Write-Host '=== 5. lyra-cli 补丁 ===' -ForegroundColor Cyan
if (Test-Path $Py) {
    Push-Location (Join-Path $Base 'src')
    try {
        $out = & $Py lyra.py 2>&1
        if ($LASTEXITCODE -eq 0) {
            Ok '授权校验补丁就绪'
            Write-Host "         $out"
        } else {
            Bad "补丁生成失败：$out"
            Write-Host '         看 docs\03-原生素材通道.md 第 2 节，重新定位特征码'
        }
    } finally { Pop-Location }
}

Write-Host ''
Write-Host '=== 6. 可选组件 ===' -ForegroundColor Cyan
$draftc = Join-Path $Base 'bin\jy-draftc.exe'
if (Test-Path $draftc) { Ok 'jy-draftc.exe 存在（支持无头导出）' }
else { Warn 'jy-draftc.exe 不在 bin\，export 只能部署草稿、需要人工点导出' }

$ff = 'D:\notebook\software\ffmpeg\bin\ffmpeg.exe'
if (Test-Path $ff) { Ok "ffmpeg $((& $ff -version 2>&1 | Select-Object -First 1))" }
else { Warn '没找到 ffmpeg，只用剪映草稿路线时不需要它' }

Write-Host ''
Write-Host '=== 完成 ===' -ForegroundColor Cyan
Write-Host 'MCP 启动：' -NoNewline
Write-Host " $Py $Base\src\mcp_server.py" -ForegroundColor White
Write-Host ''
