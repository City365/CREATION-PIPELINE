# what-prompt.ps1 —— 盯住屏幕上新冒出来的窗口，把「那个要你点 Run 的弹窗」的底细记下来。
#
# 用法：
#   powershell -File tools\concat-dev\what-prompt.ps1 -Seconds 300
# 然后在弹出的窗口里照常双击打开软件；脚本会把新出现的窗口的标题、类名、所属进程、
# 以及窗口里所有按钮/文字都写进日志，几秒钟后看日志即可。
#
# 只读：只枚举窗口、读文字，不点击、不注入、不改任何设置。

[CmdletBinding()]
param(
    [int]$Seconds = 300,
    [string]$Log = ''    # 不传就写到 outputs\concat-validation\prompt-watch.log
)

$ErrorActionPreference = 'Stop'

$root = 'D:\notebook\AIGC\CREATION-PIPELINE'
if (-not $Log) {
    $dir = Join-Path $root 'outputs\concat-validation'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $Log = Join-Path $dir 'prompt-watch.log'
}

if (-not ('Win32Probe' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Win32Probe {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);

    public static string Text(IntPtr h) {
        var sb = new StringBuilder(1024);
        int n = GetWindowTextW(h, sb, sb.Capacity);
        return n > 0 ? sb.ToString(0, n) : "";
    }

    public static string Class(IntPtr h) {
        var sb = new StringBuilder(512);
        int n = GetClassNameW(h, sb, sb.Capacity);
        return n > 0 ? sb.ToString(0, n) : "";
    }

    // 顶层窗口（含隐藏），返回 hwnd 列表
    public static IntPtr[] Tops() {
        var list = new List<IntPtr>();
        EnumWindows((h, p) => { list.Add(h); return true; }, IntPtr.Zero);
        return list.ToArray();
    }

    // 某个窗口下所有子控件的 [类名] 文字
    public static string[] Children(IntPtr h) {
        var list = new List<string>();
        EnumChildWindows(h, (c, p) => {
            string t = Text(c);
            if (t.Length > 0) list.Add("[" + Class(c) + "] " + t);
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }
}
'@
}

function Snapshot {
    $map = @{}
    foreach ($h in [Win32Probe]::Tops()) {
        $map[[int64]$h] = [Win32Probe]::Text($h)
    }
    return $map
}

function Write-Line($msg) {
    $stamp = (Get-Date).ToString('HH:mm:ss')
    $line = "[$stamp] $msg"
    Add-Content -Path $Log -Value $line -Encoding UTF8
    Write-Host $line
}

Set-Content -Path $Log -Value "# what-prompt 开始盯着 $(Get-Date -Format s)，共 $Seconds 秒" -Encoding UTF8
Write-Line "现在去双击打开软件。新出现的窗口会被记下来。"

$baseline = Snapshot
$seen = @{}
$deadline = (Get-Date).AddSeconds($Seconds)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
    try { $now = Snapshot } catch { continue }

    foreach ($key in $now.Keys) {
        if ($baseline.ContainsKey($key)) { continue }
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true

        $h = [IntPtr]$key
        $title = $now[$key]
        $cls = [Win32Probe]::Class($h)
        $visible = [Win32Probe]::IsWindowVisible($h)
        $pid2 = 0
        [void][Win32Probe]::GetWindowThreadProcessId($h, [ref]$pid2)

        $pname = '?'; $ppath = '?'
        try { $p = Get-Process -Id $pid2 -ErrorAction Stop; $pname = $p.ProcessName; $ppath = $p.Path } catch { }

        # 只看有文字、可见的窗口，免得刷屏
        if (-not $visible) { continue }
        if (-not $title -and $cls -notlike '*32770*') { continue }

        Write-Line "新窗口 pid=$pid2 proc=$pname"
        Write-Line "  path  = $ppath"
        Write-Line "  title = «$title»"
        Write-Line "  class = $cls"
        foreach ($c in [Win32Probe]::Children($h)) {
            if ($c.Trim().Length -gt 0) { Write-Line "  child $c" }
        }
        Write-Line "  ----"
    }
}

Write-Line "结束。日志：$Log"
