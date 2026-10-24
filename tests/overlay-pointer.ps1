param([int]$X, [int]$Y, [switch]$Report, [int]$DwellMs = 0)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OverlayPointer {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
 [DllImport("user32.dll", EntryPoint="SetPhysicalCursorPos")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll", EntryPoint="GetPhysicalCursorPos")] public static extern bool GetCursorPos(out POINT point);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
[OverlayPointer]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
if ($Report) {
 $point = New-Object OverlayPointer+POINT
 [OverlayPointer]::GetCursorPos([ref]$point) | Out-Null
 @{ x=$point.x; y=$point.y; foreground=[OverlayPointer]::GetForegroundWindow().ToInt64().ToString() } | ConvertTo-Json -Compress
} else {
 $moved = [OverlayPointer]::SetCursorPos($X,$Y)
 $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Min($DwellMs, 300))
 while ([DateTime]::UtcNow -lt $deadline) { [OverlayPointer]::SetCursorPos($X,$Y) | Out-Null; Start-Sleep -Milliseconds 10 }
 $point = New-Object OverlayPointer+POINT
 [OverlayPointer]::GetCursorPos([ref]$point) | Out-Null
 @{ moved=$moved; x=$point.x; y=$point.y; requestedX=$X; requestedY=$Y } | ConvertTo-Json -Compress
}
