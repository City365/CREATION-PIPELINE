# Concat 二开日常脚本（Windows / PowerShell）
#
# 作用：把本机验证时踩出来的那套构建环境固化成一条命令，免得每次重找路径。
# 依据：tools/concat-validation/build-cli.sh（本机唯一验证通过的配方）。
#
# 用法（这台机器没有 pwsh，用系统自带的 powershell）：
#   powershell -File tools\concat-dev\dev.ps1 env                 # 只打印将要设置的环境
#   powershell -File tools\concat-dev\dev.ps1 check               # cargo check 整个 concat
#   powershell -File tools\concat-dev\dev.ps1 check concat-api    # 只查某个 crate
#   powershell -File tools\concat-dev\dev.ps1 build concat        # 构建（默认 quick profile）
#   powershell -File tools\concat-dev\dev.ps1 run                 # 直接跑编辑器窗口
#   powershell -File tools\concat-dev\dev.ps1 schema              # 导出 API 合同 JSON
#   powershell -File tools\concat-dev\dev.ps1 version             # 打印已构建二进制版本
#
# 说明：只设置进程级环境变量，不改系统 PATH、不改用户 APPDATA。

[CmdletBinding()]
param(
    [ValidateSet('env', 'check', 'build', 'run', 'schema', 'version')]
    [string]$Action = 'env',

    # 位置参数：包名或目标名。check/build 用 -p，run 用 --bin。
    [string[]]$Package = @('concat'),

    [ValidateSet('quick', 'dev', 'release', 'app')]
    [string]$Profile = 'quick',

    [switch]$Locked
)

$ErrorActionPreference = 'Stop'

$root  = 'D:\notebook\AIGC\CREATION-PIPELINE'
$vsfull = Join-Path $root 'outputs\concat-validation'      # 验证目录，放下载来的依赖
$vs    = 'D:\notebook\software\Visual Studio 18\VisualStudio18'
$msvc  = Join-Path $vs 'VC\Tools\MSVC\14.44.35207'
$sdk   = 'C:\Program Files (x86)\Windows Kits\10'
$sdkIn = Join-Path $sdk 'Include\10.0.26100.0'

$ffmpeg = Join-Path $root 'outputs\concat-validation\deps\ffmpeg\ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1'
$clang  = Join-Path $root 'outputs\concat-validation\deps\clang\libclang-18.1.1.data\platlib\clang\native'
$cmake  = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin'
$tmp    = Join-Path $root 'outputs\concat-validation\build-temp'

foreach ($p in @($ffmpeg, $clang, $msvc, (Join-Path $msvc 'bin\Hostx64\x64'), $cmake)) {
    if (-not (Test-Path $p)) { Write-Warning "缺少依赖目录：$p" }
}
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# --- 环境 ---------------------------------------------------------------
$env:FFMPEG_DIR        = $ffmpeg            # ffmpeg-sys 找头文件和导入库
$env:LIBCLANG_PATH     = $clang             # bindgen 找 libclang.dll
$env:CC                = Join-Path $msvc 'bin\Hostx64\x64\cl.exe'
$env:CXX               = $env:CC
$env:INCLUDE           = (@(
    (Join-Path $msvc 'include'),
    (Join-Path $sdkIn 'ucrt'),
    (Join-Path $sdkIn 'shared'),
    (Join-Path $sdkIn 'um')
) -join ';')
$env:CARGO_PROFILE_DEV_DEBUG = '0'          # 关掉调试信息：MSVC 14.50 的 D8050 就是这里
$env:TEMP = $tmp                            # whisper 的 CMake/MSBuild 在默认 TEMP 会被拒写
$env:TMP  = $tmp
$env:PATH = (@(
    (Join-Path $msvc 'bin\Hostx64\x64'),
    $cmake,
    (Join-Path $ffmpeg 'bin'),               # 运行时需要 avcodec-62.dll 等
    $env:PATH
) -join ';')

# Slint 生成码巨大，并发过高时 rustc 内存顶到 8 GB；2 是这台机器验证过的值。
if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '2' }

$src      = Join-Path $root 'Concat\src'
$manifest = Join-Path $src 'Cargo.toml'
$exe      = Join-Path $src 'target\debug\concat.exe'

function Show-Env {
    [pscustomobject]@{
        FFMPEG_DIR        = $env:FFMPEG_DIR
        LIBCLANG_PATH     = $env:LIBCLANG_PATH
        CC                = $env:CC
        CARGO_BUILD_JOBS  = $env:CARGO_BUILD_JOBS
        'CARGO_PROFILE_DEV_DEBUG' = $env:CARGO_PROFILE_DEV_DEBUG
        TEMP              = $env:TEMP
        cargo             = (Get-Command cargo -ErrorAction SilentlyContinue).Source
        rustc             = (rustc --version 2>$null)
        binary            = $exe
        binary_exist      = (Test-Path $exe)
    } | Format-List
}

$cargoArgs = @()

switch ($Action) {
    'env' { Show-Env }

    'check' {
        foreach ($p in $Package) { $cargoArgs += @('-p', $p) }
        & cargo check --manifest-path $manifest @cargoArgs $(if ($Locked) { '--locked' })
        exit $LASTEXITCODE
    }

    'build' {
        foreach ($p in $Package) { $cargoArgs += @('-p', $p) }
        & cargo build --manifest-path $manifest @cargoArgs --profile $Profile $(if ($Locked) { '--locked' })
        exit $LASTEXITCODE
    }

    'run' {
        # `cargo dev` 是仓库自带别名：--bin concat --profile quick（增量，改一处几十秒）
        & cargo run --manifest-path $manifest --bin concat --profile quick
        exit $LASTEXITCODE
    }

    'schema' {
        if (-not (Test-Path $exe)) { Write-Error "还没有构建产物：$exe" }
        $out = Join-Path $root 'outputs\concat-validation\api-contract.json'
        & $exe --schema > $out
        "写出 $out（$((Get-Item $out).Length) 字节）"
    }

    'version' {
        if (-not (Test-Path $exe)) { Write-Error "还没有构建产物：$exe" }
        & $exe --version
    }
}
