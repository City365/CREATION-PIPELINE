# 编译 jy-draftc（适配本机剪映 11.5.0.14471）
#
# 为什么必须 MSVC：videoeditor.dll 是 MSVC C++ 产物，导出的是类方法，
# 需要匹配 C++ ABI + /MT 静态 CRT（见 build.bat 里的注释：用 /MD 会让引擎
# 的 lazy static 崩掉，Logger::getLogger 返回垃圾）。
#
# 用法：
#   pwsh -File tools/jianying-scheduler/build-jy-draftc.ps1
#   pwsh -File tools/jianying-scheduler/build-jy-draftc.ps1 -SrcVersion 11.6.0.14552

param(
    [string]$SrcVersion = "11.5.0.14471",
    [string]$SrcRoot = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SrcRoot) { $SrcRoot = Join-Path $here "..\..\output\_probe\jy-draftc" }
$SrcRoot = (Resolve-Path $SrcRoot).Path
$src = Join-Path $SrcRoot "src\$SrcVersion"
if (-not (Test-Path $src)) { throw "找不到源码目录: $src" }

$outDir = Join-Path $here "bin"
New-Item -ItemType Directory -Force $outDir | Out-Null
$objDir = Join-Path $here "bin\obj"
New-Item -ItemType Directory -Force $objDir | Out-Null

# 1) 定位 VS（vcvars64.bat）
$vsRoot = $env:VS_ROOT
if (-not $vsRoot -or -not (Test-Path "$vsRoot\VC\Auxiliary\Build\vcvars64.bat")) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { throw "没有 vswhere，也没设 VS_ROOT" }
    $vsRoot = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vsRoot) { throw "没有找到带 VC.Tools 的 Visual Studio / Build Tools。先装：winget install --id Microsoft.VisualStudio.2022.BuildTools --override `"--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`"" }
}
$vcvars = Join-Path $vsRoot "VC\Auxiliary\Build\vcvars64.bat"
Write-Host "VS: $vsRoot"

# 2) 校验 videoeditor.dll 版本绑定（源码 README 给了期望 SHA-256）
$dllCandidates = @(
    (Join-Path "D:\notebook\software\JianyingPro" "$SrcVersion\videoeditor.dll"),
    (Join-Path $env:LOCALAPPDATA "JianyingPro\Apps\$SrcVersion\videoeditor.dll")
)
$dll = $dllCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($dll) {
    $hash = (Get-FileHash $dll -Algorithm SHA256).Hash
    $size = (Get-Item $dll).Length
    Write-Host ("videoeditor.dll: {0} bytes  SHA256={1}" -f $size, $hash)
    $readme = Join-Path $src "README.md"
    if (Test-Path $readme) {
        $expectHash = (Select-String -Path $readme -Pattern 'SHA-256 `([0-9A-F]{64})`').Matches.Groups[1].Value
        $expectSize = (Select-String -Path $readme -Pattern '`([\d,]+)` 字节').Matches.Groups[1].Value -replace ',', ''
        if ($expectHash -and $expectHash -ne $hash) { Write-Warning "SHA256 与源码 README 不一致：期望 $expectHash" }
        if ($expectSize -and [int64]$expectSize -ne $size) { Write-Warning "体积与源码 README 不一致：期望 $expectSize" }
        if (($expectHash -eq $hash) -and ($expectSize -eq "$size")) { Write-Host "版本绑定校验通过 ✔" -ForegroundColor Green }
    }
} else {
    Write-Warning "没找到 $SrcVersion 的 videoeditor.dll，编译仍可继续"
}

# 3) 编译
$sources = @("main.cpp", "draft_crypto.cpp", "video_export.cpp", "draft_convert.cpp", "batch.cpp") |
    ForEach-Object { Join-Path $src $_ }
foreach ($s in $sources) { if (-not (Test-Path $s)) { throw "缺少源文件: $s" } }

$cl = @"
call "$vcvars" >nul || exit /b 1
cl /nologo /std:c++20 /O2 /Oi /GL /Gy /Gw /GR- /MT /EHsc /GS /guard:cf /DNDEBUG /utf-8 /W4 /permissive- ^
   /Fo:"$objDir\\" /Fd:"$objDir\\" /Fe:"$outDir\jy-draftc.exe" ^
   "$($sources -join '" "')" ^
   /link /LTCG /INCREMENTAL:NO /SUBSYSTEM:CONSOLE /OPT:REF /OPT:ICF /DYNAMICBASE /HIGHENTROPYVA ^
   /NXCOMPAT /guard:cf bcrypt.lib
"@

Write-Host "编译中…"
$tmp = Join-Path $env:TEMP ("jydc-build-{0}.bat" -f [guid]::NewGuid().ToString("N"))
Set-Content -Path $tmp -Value $cl -Encoding ASCII
& cmd /c "`"$tmp`""
$code = $LASTEXITCODE
Remove-Item $tmp -ErrorAction SilentlyContinue

if ($code -ne 0) { throw "编译失败，cl 退出码 $code" }
$exe = Join-Path $outDir "jy-draftc.exe"
if (-not (Test-Path $exe)) { throw "编译结束但没有产物: $exe" }
Write-Host ("完成: {0}  {1:N1} KB" -f $exe, ((Get-Item $exe).Length / 1KB)) -ForegroundColor Green
