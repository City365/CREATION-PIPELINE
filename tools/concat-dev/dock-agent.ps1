# dock-agent.ps1 —— 常驻的窗口停靠代理（M1 伪嵌入的落地端）
#
# 为什么常驻：SetWindowPos 一次只要几十微秒，但启动一次 PowerShell 要 600~900ms。
# 拖动窗口、拉动分栏时前端每秒会报十几次坐标，起进程来不及，所以这里开一条
# stdin/stdout 的 JSON 行协议，进程活着，坐标来了就挪。
#
# 协议（一行一条 JSON）：
#   进： {"seq":1,"cmd":"ping"}
#        {"seq":2,"cmd":"status"}
#        {"seq":3,"cmd":"dock","x":120,"y":180,"w":1280,"h":720,"borderless":true}
#        {"seq":4,"cmd":"restore"}
#        {"seq":9,"cmd":"stop"}
#   出： {"seq":1,"ok":true,"cmd":"ping","pid":1234}
#        {"seq":2,"ok":true,"cmd":"status","running":true,"hwnd":"0x1234","title":"…",
#             "rect":{"x":0,"y":0,"w":800,"h":600},"dpi":144,"borderless":false,
#             "windows":[{"hwnd":"0x…","title":"…","visible":true,"rect":{…}}]}
#
# 坐标一律是**物理像素**（缩放算在前端/后端那一侧），本进程启动时先声明
# PER_MONITOR_AWARE_V2，避免系统把 GetWindowRect/SetWindowPos 的坐标再缩一遍。
#
# 选哪个窗口：一个进程在不同时刻可能有多个顶层窗口（启动页、主窗口、隐藏的辅助窗口），
# Process.MainWindowHandle 会在它们之间跳，跳错就会把不相干的小窗挪到页面上。
# 所以这里自己 EnumWindows：按进程名过滤 → 只要可见的 → 取面积最大的那个 →
# 记下 HWND，之后一直用同一个，直到它真的不存在了再重新挑。
#
# 只做四件事：挑窗口、改样式去标题栏、SetWindowPos、报回真实矩形。
# 不注入、不挂钩子、不读窗口内容。

[CmdletBinding()]
param(
    [string]$ProcessName = 'concat'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -Namespace DockNative -Name Api -MemberDefinition @'
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int index, int value);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class DockWin {
    public IntPtr Hwnd;
    public string Title = "";
    public string Cls = "";
    public bool Visible;
    public int X, Y, W, H;
    public uint Pid;
    public int Area { get { return W * H; } }
}

public class DockWindows {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    public static DockWin[] OfPids(int[] pids) {
        var wanted = new HashSet<uint>();
        if (pids != null) foreach (var p in pids) wanted.Add(unchecked((uint)p));
        var list = new List<DockWin>();
        EnumWindows((h, p) => {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (!wanted.Contains(pid)) return true;
            RECT r;
            GetWindowRect(h, out r);
            var t = new StringBuilder(512);
            int n = GetWindowTextW(h, t, t.Capacity);
            var c = new StringBuilder(256);
            GetClassNameW(h, c, c.Capacity);
            list.Add(new DockWin {
                Hwnd = h,
                Pid = pid,
                Title = n > 0 ? t.ToString(0, n) : "",
                Cls = c.ToString(),
                Visible = IsWindowVisible(h),
                X = r.Left, Y = r.Top,
                W = r.Right - r.Left, H = r.Bottom - r.Top
            });
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }
}
'@

# 先声明 DPI 感知，否则在本机 150% 缩放下拿到的坐标是被系统折过的
try { [void][DockNative.Api]::SetProcessDpiAwarenessContext([IntPtr]$(-4)) } catch { }

$WS_CAPTION      = 0x00C00000
$WS_THICKFRAME   = 0x00040000
$WS_MAXIMIZEBOX  = 0x00010000
$WS_MINIMIZEBOX  = 0x00020000
$WS_SYSMENU      = 0x00080000
$GWL_STYLE       = -16
$SWP_NOZORDER    = 0x0004
$SWP_NOACTIVATE  = 0x0010
$SWP_SHOWWINDOW  = 0x0040
$SW_RESTORE      = 9
$HWND_TOPMOST    = -1
$HWND_NOTOPMOST  = -2

# 去标题栏时一并去掉的能力；还原时按位或回来
$FrameMask = $WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MAXIMIZEBOX -bor $WS_MINIMIZEBOX -bor $WS_SYSMENU

# 记住挑中的窗口：进程里可能同时有启动页、主窗口、隐藏辅助窗，别每次重新猜
$script:Picked = [IntPtr]::Zero

function Get-TeamWindows {
    param([string]$Name)
    $pids = @(Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if (-not $pids.Count) { return @() }
    return @([DockWindows]::OfPids([int[]]$pids))
}

function Resolve-Window {
    param([string]$Name, [int]$Tries = 3)

    if ($script:Picked -ne [IntPtr]::Zero -and [DockNative.Api]::IsWindow($script:Picked)) {
        foreach ($w in (Get-TeamWindows -Name $Name)) {
            if ($w.Hwnd -eq $script:Picked) { return $w }
        }
    }

    for ($i = 0; $i -lt $Tries; $i++) {
        $all = @(Get-TeamWindows -Name $Name)
        $cands = @($all | Where-Object { $_.Visible -and $_.W -ge 200 -and $_.H -ge 120 })
        if ($cands.Count) {
            # 面积最大的那个就是主窗口；启动页/隐藏辅助窗都比它小
            $best = $cands | Sort-Object -Property Area -Descending | Select-Object -First 1
            $script:Picked = $best.Hwnd
            return $best
        }
        # Get-Process 偶尔会瞬时空一把：等一下再要，别把「没窗口」当成结论回给前端
        if ($i -lt ($Tries - 1)) { Start-Sleep -Milliseconds 180 }
    }

    $script:Picked = [IntPtr]::Zero
    return $null
}

function Get-Rect {
    param([IntPtr]$Hwnd)
    $r = New-Object DockNative.Api+RECT
    [void][DockNative.Api]::GetWindowRect($Hwnd, [ref]$r)
    [pscustomobject]@{ x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) }
}

function Send($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 6
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Reply($seq, $cmd, $payload) {
    $answer = @{ seq = $seq; cmd = $cmd }
    if ($payload -is [hashtable]) { foreach ($k in $payload.Keys) { $answer[$k] = $payload[$k] } }
    Send $answer
}

function WindowList($all) {
    return @($all | ForEach-Object {
        [pscustomobject]@{
            hwnd = ('0x{0:X}' -f $_.Hwnd.ToInt64())
            title = $_.Title
            cls = $_.Cls
            visible = $_.Visible
            rect = [pscustomobject]@{ x = $_.X; y = $_.Y; w = $_.W; h = $_.H }
        }
    })
}

Send @{ ok = $true; cmd = 'ready'; pid = $PID; process = $ProcessName; agent = 'dock-agent/2' }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }              # 父进程关了管道：自己退出
    $line = $line.Trim()
    if (-not $line) { continue }

    $msg = $null
    try { $msg = $line | ConvertFrom-Json } catch {
        Send @{ ok = $false; cmd = '?'; error = 'bad-json'; detail = $_.Exception.Message }
        continue
    }

    $seq = 0
    if ($null -ne $msg.seq) { $seq = [int]$msg.seq }
    $cmd = [string]$msg.cmd
    $name = $ProcessName
    if ($msg.process) { $name = [string]$msg.process }

    try {
        switch ($cmd) {
            'ping' { Reply $seq $cmd @{ ok = $true; pid = $PID } }

            'stop' { Reply $seq $cmd @{ ok = $true }; exit 0 }

            'status' {
                $win = Resolve-Window -Name $name
                if (-not $win) {
                    Reply $seq $cmd @{ ok = $false; running = $false; error = 'not-running'; windows = (WindowList (Get-TeamWindows -Name $name)) }
                    break
                }
                $style = [DockNative.Api]::GetWindowLong($win.Hwnd, $GWL_STYLE)
                Reply $seq $cmd @{
                    ok         = $true
                    running    = $true
                    pid        = $win.Pid
                    hwnd       = ('0x{0:X}' -f $win.Hwnd.ToInt64())
                    title      = $win.Title
                    rect       = (Get-Rect $win.Hwnd)
                    dpi        = [int][DockNative.Api]::GetDpiForWindow($win.Hwnd)
                    borderless = (($style -band $WS_CAPTION) -eq 0)
                    topmost    = (([DockNative.Api]::GetWindowLong($win.Hwnd, -20) -band 0x8) -ne 0)
                    maximized  = [bool][DockNative.Api]::IsZoomed($win.Hwnd)
                    windows    = (WindowList (Get-TeamWindows -Name $name))
                    virtualScreen = [pscustomobject]@{
                        x = 0; y = 0
                        w = [DockNative.Api]::GetSystemMetrics(78)   # SM_CXVIRTUALSCREEN
                        h = [DockNative.Api]::GetSystemMetrics(79)   # SM_CYVIRTUALSCREEN
                    }
                }
            }

            'dock' {
                $win = Resolve-Window -Name $name
                if (-not $win) { Reply $seq $cmd @{ ok = $false; running = $false; error = 'not-running' }; break }
                $hwnd = $win.Hwnd

                if ([DockNative.Api]::IsZoomed($hwnd)) { [void][DockNative.Api]::ShowWindow($hwnd, $SW_RESTORE); Start-Sleep -Milliseconds 60 }

                $wantBorderless = $true
                if ($null -ne $msg.borderless) { $wantBorderless = [bool]$msg.borderless }
                $style = [DockNative.Api]::GetWindowLong($hwnd, $GWL_STYLE)
                if ($wantBorderless -and (($style -band $WS_CAPTION) -ne 0)) {
                    $style = $style -band (-bnot $FrameMask)
                    [void][DockNative.Api]::SetWindowLong($hwnd, $GWL_STYLE, $style)
                    # 不要再补一次 ShowWindow(SW_RESTORE)：紧接着的 SetWindowPos 就会按新样式重排，
                    # 多一次 restore 会在窗口已经可见时触发 winit 的尺寸重算，历史上把 Concat 弄退过一次。
                }

                $x = [int]$msg.x; $y = [int]$msg.y; $w = [int]$msg.w; $h = [int]$msg.h
                if ($w -lt 200) { $w = 200 }
                if ($h -lt 120) { $h = 120 }

                # 停靠中的窗口必须压在浏览器上面，否则点一下网页、编辑器就被盖住了，
                # 「页面里的一块」这个错觉立刻破功。topmost 默认开，还原时再摘掉。
                $wantTop = $true
                if ($null -ne $msg.topmost) { $wantTop = [bool]$msg.topmost }
                if ($wantTop) {
                    $flags = $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW
                    [void][DockNative.Api]::SetWindowPos($hwnd, [IntPtr]$HWND_TOPMOST, $x, $y, $w, $h, $flags)
                } else {
                    $flags = $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW
                    [void][DockNative.Api]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, $flags)
                }
                Start-Sleep -Milliseconds 15

                $now = Get-Rect $hwnd
                Reply $seq $cmd @{
                    ok         = $true
                    running    = $true
                    hwnd       = ('0x{0:X}' -f $hwnd.ToInt64())
                    rect       = $now
                    requested  = [pscustomobject]@{ x = $x; y = $y; w = $w; h = $h }
                    applied    = (($now.x -eq $x) -and ($now.y -eq $y) -and ($now.w -eq $w) -and ($now.h -eq $h))
                    topmost    = $wantTop
                    dpi        = [int][DockNative.Api]::GetDpiForWindow($hwnd)
                    borderless = $wantBorderless
                    title      = $win.Title
                }
            }

            'restore' {
                $win = Resolve-Window -Name $name
                if (-not $win) { Reply $seq $cmd @{ ok = $false; running = $false; error = 'not-running' }; break }
                $hwnd = $win.Hwnd
                $style = [DockNative.Api]::GetWindowLong($hwnd, $GWL_STYLE)
                [void][DockNative.Api]::SetWindowLong($hwnd, $GWL_STYLE, ($style -bor $WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MAXIMIZEBOX -bor $WS_MINIMIZEBOX -bor $WS_SYSMENU))
                [void][DockNative.Api]::ShowWindow($hwnd, $SW_RESTORE)
                $w = [int]([DockNative.Api]::GetSystemMetrics(0) * 0.72)
                $h = [int]([DockNative.Api]::GetSystemMetrics(1) * 0.78)
                [void][DockNative.Api]::SetWindowPos($hwnd, [IntPtr]$HWND_NOTOPMOST, 80, 60, $w, $h, ($SWP_NOACTIVATE -bor $SWP_SHOWWINDOW))
                Start-Sleep -Milliseconds 30
                Reply $seq $cmd @{ ok = $true; running = $true; hwnd = ('0x{0:X}' -f $hwnd.ToInt64()); rect = (Get-Rect $hwnd); borderless = $false }
            }

            default {
                Reply $seq $cmd @{ ok = $false; error = 'unknown-command' }
            }
        }
    } catch {
        Reply $seq $cmd @{ ok = $false; error = 'exception'; detail = $_.Exception.Message }
    }
}

exit 0
