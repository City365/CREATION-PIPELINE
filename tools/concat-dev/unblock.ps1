# unblock.ps1 —— 把「来自 Internet」的标记（Mark-of-the-Web）一次性擦掉。
#
# 症状：双击某个 .ps1 / .cmd / .exe / .lnk，Windows 弹「打开文件 - 安全警告：
#       是否要运行此文件？」，按钮是「运行(R)」。不点它，程序就一直不起来。
# 原因：文件从压缩包/浏览器落地时带了一条 Zone.Identifier 数据流（ZoneId=3），
#       由 Windows「附件管理器」在 ShellExecute 时拦截。这条流只认文件，不认路径，
#       所以换个快捷方式也没用，唯一稳的办法是把流删掉。
# 处理：删掉这条数据流（等价于右键属性 → 解除锁定），不改任何注册表策略。
#
# 用法：
#   powershell -File tools\concat-dev\unblock.ps1                 # 只扫桌面 + 下载 + 文档 + 本项目
#   powershell -File tools\concat-dev\unblock.ps1 -Roots D:\,E:\  # 指定目录
#   powershell -File tools\concat-dev\unblock.ps1 -WhatIfOnly     # 只看不删
#
# 说明：只处理可执行/脚本/快捷方式这几类后缀，其它文件不碰。

[CmdletBinding()]
param(
    [string[]]$Roots = @(
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Downloads",
        "$env:USERPROFILE\Documents",
        'D:\notebook\AIGC\CREATION-PIPELINE'
    ),
    [int]$Depth = 6,
    [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'
$exts = @('*.ps1', '*.cmd', '*.bat', '*.lnk', '*.vbs', '*.exe', '*.msi', '*.jar', '*.reg')
$found = 0
$fixed = 0

foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) { Write-Host "跳过（不存在）：$root"; continue }
    Write-Host "扫描 $root"
    foreach ($ext in $exts) {
        $files = Get-ChildItem -LiteralPath $root -Recurse -Depth $Depth -Filter $ext -File -Force -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $zone = Get-Item -LiteralPath $f.FullName -Stream * -ErrorAction SilentlyContinue |
                Where-Object Stream -eq 'Zone.Identifier'
            if (-not $zone) { continue }
            $found++
            if ($WhatIfOnly) {
                Write-Host "  带标记：$($f.FullName)"
                continue
            }
            try {
                Unblock-File -LiteralPath $f.FullName -ErrorAction Stop
                $fixed++
                Write-Host "  已解除：$($f.FullName)"
            } catch {
                Write-Host "  解不开：$($f.FullName) —— $($_.Exception.Message)"
            }
        }
    }
}

if ($WhatIfOnly) { Write-Host "`n共 $found 个文件带标记（未改动）。" }
else { Write-Host "`n共 $found 个文件带标记，已解除 $fixed 个。" }
if ($found -eq 0) { Write-Host '这几个目录里没有带标记的文件——那就不是附件管理器在拦，把弹出的框拍照发我。' }
