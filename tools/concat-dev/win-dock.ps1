# 把 Concat 原生窗口"停靠"到页面里预留的那块区域（伪嵌入，L2 方案）
#
# 浏览器不能把原生窗口塞进 DOM，但可以让原生窗口精确地坐在网页预留区域的正上方，
# 看起来就是页面里的一块剪辑台。前端只负责报坐标，落位由本脚本做。
#
# 用法：
#   powershell -File tools\concat-dev\win-dock.ps1 -List
#   powershell -File tools\concat-dev\win-dock.ps1 -X 120 -Y 180 -W 1280 -H 720
#   powershell -File tools\concat-dev\win-dock.ps1 -X 120 -Y 180 -W 1280 -H 720 -Borderless
#   powershell -File tools\concat-dev\win-dock.ps1 -Restore      # 还回标题栏和原位置
#
# 前端怎么算坐标（在页面里）：
#   const r = el.getBoundingClientRect();
#   const x = Math.round(window.screenX + r.left + (window.outerWidth - window.innerWidth));
#   const y = Math.round(window.screenY + r.top  + (window.outerHeight - window.innerHeight));
#   await fetch('/api/local/dock', {method:'POST', headers:{'Content-Type':'application/json'},
#     body: JSON.stringify({x, y, w: Math.round(r.width), h: Math.round(r.height)})});
#   // 后端再调本脚本（前后端分离，浏览器不直接起进程）

[CmdletBinding()]
param(
    [int]$X = 0,
    [int]$Y = 0,
    [int]$W = 1280,
    [int]$H = 720,
    [switch]$Borderless,
    [switch]$Restore,
    [switch]$List,
    [string]$Process = 'concat'
)

$ErrorActionPreference = 'Stop'

if (-not ('Win32.Native' -as [type])) {
    Add-Type -Namespace Win32 -Name Native -MemberDefinition @'
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll", SetLastError=true)] public static extern int SetWindowLong(IntPtr h, int index, int value);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@
}

$WS_CAPTION     = 0x00C00000
$SWP_NOZORDER   = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040

# 找目标：按进程名挑主窗口（有标题的那个）
function Get-TargetWindow {
    param([string]$Name)
    $procs = Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
    if (-not $procs) { return $null }
    $procs | Sort-Object StartTime | Select-Object -First 1
}

$proc = Get-TargetWindow -Name $Process

if ($List) {
    if (-not $proc) {
        "未找到 $Process 窗口（先启动：powershell -File tools\concat-dev\dev.ps1 run）"
        exit 0
    }
    foreach ($p in @(Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) {
        $r = New-Object Win32.Native+RECT
        [void][Win32.Native]::GetWindowRect($p.MainWindowHandle, [ref]$r)
        [pscustomobject]@{
            Pid    = $p.Id
            Title  = $p.MainWindowTitle
            Handle = ('0x{0:X}' -f $p.MainWindowHandle.ToInt64())
            Left   = $r.Left; Top = $r.Top
            Width  = $r.Right - $r.Left; Height = $r.Bottom - $r.Top
            Style  = ('0x{0:X8}' -f [Win32.Native]::GetWindowLong($p.MainWindowHandle, -16))
        }
    }
    exit 0
}

if (-not $proc) { Write-Error "未找到 $Process 窗口"; exit 1 }

$hwnd = $proc.MainWindowHandle
$style = [Win32.Native]::GetWindowLong($hwnd, -16)

if ($Restore) {
    # 把标题栏加回去，位置交还系统默认
    [void][Win32.Native]::SetWindowLong($hwnd, -16, ($style -bor $WS_CAPTION))
    [void][Win32.Native]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, $SWP_NOZORDER -bor $SWP_SHOWWINDOW)
    [void][Win32.Native]::ShowWindow($hwnd, 9)   # SW_RESTORE
    "已还原：$($proc.MainWindowTitle)"
    exit 0
}

if ($Borderless) {
    # 去掉标题栏，让窗口边缘和网页预留区对齐
    [void][Win32.Native]::SetWindowLong($hwnd, -16, ($style -band (-bnot $WS_CAPTION)))
}

# NOACTIVATE：挪窗口但不抢焦点，用户还在网页里点按钮
[void][Win32.Native]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, $SWP_NOZORDER -bor $SWP_SHOWWINDOW -bor $SWP_NOACTIVATE)

$r = New-Object Win32.Native+RECT
[void][Win32.Native]::GetWindowRect($hwnd, [ref]$r)
[pscustomobject]@{
    Pid = $proc.Id
    Title = $proc.MainWindowTitle
    Left = $r.Left; Top = $r.Top
    Width = $r.Right - $r.Left; Height = $r.Bottom - $r.Top
    Borderless = [bool]$Borderless
}
