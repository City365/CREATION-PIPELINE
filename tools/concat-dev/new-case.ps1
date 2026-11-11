# 新建一条 case：cases/YYYY-MM-DD-NNN-slug/
#
#   powershell -File tools\concat-dev\new-case.ps1 "开场十五秒"
#
# 当天第 N 条自动编号；已存在就顺延，不覆盖任何东西。

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Slug
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cases   = Join-Path $root 'cases'
$tpl     = Join-Path $cases '_template'
$today   = Get-Date -Format 'yyyy-MM-dd'
$safe    = ($Slug -replace '[\\/:*?"<>|\s]+', '-').Trim('-')
if (-not $safe) { $safe = 'case' }

if (-not (Test-Path $tpl)) { throw "模板目录不存在：$tpl" }

$n = 1
do {
    $name = '{0}-{1:d3}-{2}' -f $today, $n, $safe
    $dir  = Join-Path $cases $name
    $n++
} while (Test-Path $dir)

New-Item -ItemType Directory -Path $dir, (Join-Path $dir 'frames') -Force | Out-Null

Copy-Item (Join-Path $tpl 'note.json') (Join-Path $dir 'note.json')
Copy-Item (Join-Path $tpl 'task.md')   (Join-Path $dir 'task.md')

# 把占位的 case id 换成真实目录名
$note = Get-Content (Join-Path $dir 'note.json') -Raw -Encoding UTF8
$note = $note -replace '"case": "2026-11-10-001"', ('"case": "' + $name + '"')
[System.IO.File]::WriteAllText((Join-Path $dir 'note.json'), $note, (New-Object System.Text.UTF8Encoding($false)))

Write-Output $dir
Write-Output ''
Write-Output '下一步：'
Write-Output "  1) 在 $(Join-Path $dir 'task.md') 写清这条片子的要求"
Write-Output '  2) 用源码构建的 concat.exe 跑 MCP 粗剪（见 docs/MCP.md）'
Write-Output '  3) 窗口人工精修 → 导出 → 看片 → 填 note.json'
