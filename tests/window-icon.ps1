param([Parameter(Mandatory = $true)][long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AppIconTest {
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
 [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
}
'@
$taskHandle = [IntPtr]::new($WindowHandle)
$taskBigIcon = [UIntPtr]::Zero
$taskSmallIcon = [UIntPtr]::Zero
[AppIconTest]::SendMessageTimeout($taskHandle, 0x7F, [UIntPtr]::new(1), [IntPtr]::Zero, 2, 1000, [ref]$taskBigIcon) | Out-Null
[AppIconTest]::SendMessageTimeout($taskHandle, 0x7F, [UIntPtr]::new(0), [IntPtr]::Zero, 2, 1000, [ref]$taskSmallIcon) | Out-Null
$taskStyles = [AppIconTest]::GetWindowLongPtr($taskHandle, -20).ToInt64()
if ($taskBigIcon -eq [UIntPtr]::Zero -or $taskSmallIcon -eq [UIntPtr]::Zero) { throw 'Dashboard window does not expose real Windows icons.' }
if (($taskStyles -band 0x80) -ne 0) { throw 'Dashboard is excluded from the taskbar as a tool window.' }
Write-Output 'PASS: dashboard exposes Windows taskbar icons and is not a tool window.'
