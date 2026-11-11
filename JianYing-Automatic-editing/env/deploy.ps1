# 把暂存草稿部署到剪映草稿列表
#
# 用原生 PowerShell 跑（不要从 Python subprocess 里调，会因 token 受限而 Access denied）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File env\deploy.ps1 -Name 我的草稿
#   powershell -ExecutionPolicy Bypass -File env\deploy.ps1 -Name 我的草稿 -DraftRoot "D:\other\drafts"

param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$DraftRoot = 'D:\notebook\software\JianyingPro Drafts'
)

$ErrorActionPreference = 'Stop'
$Base = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path $Base "output\jy-drafts\$Name"
$Dest = Join-Path $DraftRoot $Name

if (-not (Test-Path $Stage)) {
    Write-Host "[FAIL] 暂存目录不存在：$Stage" -ForegroundColor Red
    Write-Host "       先跑 draft_save 或 e2e 脚本生成草稿" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $DraftRoot)) {
    Write-Host "[FAIL] 草稿根目录不存在：$DraftRoot" -ForegroundColor Red
    exit 1
}

Write-Host "源   $Stage"
Write-Host "目标 $Dest"

if (Test-Path $Dest) {
    Write-Host '目标已存在，先清理...' -ForegroundColor Yellow
    Remove-Item $Dest -Recurse -Force
}
Copy-Item $Stage $Dest -Recurse -Force

# 剪映要求的两个 sidecar
[IO.File]::WriteAllText(
    (Join-Path $Dest 'draft_settings'),
    "[General]`r`ndraft_create_time=0`r`ndraft_last_edit_time=0`r`nreal_edit_seconds=0`r`nreal_edit_keys=0`r`n"
)
[IO.File]::WriteAllText(
    (Join-Path $Dest 'draft_virtual_store.json'),
    '{"draft_materials":[],"draft_virtual_store":[]}'
)

Write-Host ''
Write-Host '[OK] 已部署' -ForegroundColor Green
Get-ChildItem $Dest -File | ForEach-Object { "     {0,8:N0}B  {1}" -f $_.Length, $_.Name }

# 打印关键信息，方便手动注册索引
$content = Get-Content (Join-Path $Dest 'draft_content.json') -Raw | ConvertFrom-Json
$meta = Get-Content (Join-Path $Dest 'draft_meta_info.json') -Raw | ConvertFrom-Json
Write-Host ''
Write-Host '草稿信息：'
Write-Host ("   draft_id   " + $meta.draft_id)
Write-Host ("   duration   " + $content.duration + " 微秒 (" + [Math]::Round($content.duration / 1000000, 2) + " 秒)")
Write-Host ("   tracks     " + (($content.tracks | ForEach-Object { $_.type }) -join ', '))
Write-Host ("   fold_path  " + $Dest)
Write-Host ''
Write-Host '打开剪映看草稿列表。如果没出现，把下面这条加进 root_meta_info.json 的 all_draft_store：' -ForegroundColor Cyan
Write-Host ''
[ordered]@{
    draft_name        = $Name
    draft_id          = $meta.draft_id
    draft_fold_path   = $Dest
    draft_root_path   = $DraftRoot
    tm_duration       = $content.duration
    draft_new_version = '110.0.0'
} | ConvertTo-Json -Depth 3
