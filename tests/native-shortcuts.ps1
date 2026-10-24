param([string]$HelperPath = (Join-Path $PSScriptRoot '..\windows-helper\bin\diagnostic-build\windows-helper.exe'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ShortcutTestInput {
 [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
 [StructLayout(LayoutKind.Explicit)] struct UNION {
  [FieldOffset(0)] public KEY keyboard;
  [FieldOffset(0)] public MOUSE mouse;
 }
 [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x,y; public uint data,flags,time; public UIntPtr extra; }
 [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] input, int size);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
 public static void Focus(IntPtr hwnd) {
  uint pid; uint fore = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
  uint own = GetCurrentThreadId();
  bool attached = AttachThreadInput(own, fore, true);
  SetForegroundWindow(hwnd);
  if (attached) AttachThreadInput(own, fore, false);
 }
 public static void Key(int vk, bool down) {
  uint flags = down ? 0u : 2u;
  if (vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5) flags |= 1u;
  var input = new INPUT { type=1, data=new UNION { keyboard=new KEY { vk=(ushort)vk, flags=flags } } };
  if (SendInput(1, new[] {input}, Marshal.SizeOf<INPUT>()) != 1) throw new Exception("Test input was blocked");
 }
}
'@
$previousWindow = [ShortcutTestInput]::GetForegroundWindow()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Owlio disposable shortcut test'
$form.TopMost = $true
$field = New-Object System.Windows.Forms.TextBox
$field.Text = 'Native hook test'
$form.Controls.Add($field)
$helper = New-Object System.Diagnostics.Process
$helper.StartInfo.FileName = [IO.Path]::GetFullPath($HelperPath)
$helper.StartInfo.Arguments = '--allow-test-input'
$helper.StartInfo.UseShellExecute = $false
$helper.StartInfo.CreateNoWindow = $true
$helper.StartInfo.RedirectStandardInput = $true
$helper.StartInfo.RedirectStandardOutput = $true
$helper.StartInfo.RedirectStandardError = $true
$messages = New-Object 'System.Collections.Generic.List[object]'
$heldKeys = New-Object 'System.Collections.Generic.HashSet[int]'

function Send-Command($Message) {
 $helper.StandardInput.WriteLine(($Message | ConvertTo-Json -Compress)); $helper.StandardInput.Flush()
}
function Read-Message([string]$Name) {
 $end = [DateTime]::UtcNow.AddSeconds(6)
 while ([DateTime]::UtcNow -lt $end) {
  $read = $helper.StandardOutput.ReadLineAsync()
  while (!$read.IsCompleted -and [DateTime]::UtcNow -lt $end) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 5 }
  if (!$read.IsCompleted) { throw "No native event detected: $Name" }
  $line = $read.GetAwaiter().GetResult()
  if (!$line) { throw "Helper exited: $($helper.StandardError.ReadToEnd())" }
  $message = $line | ConvertFrom-Json
  $messages.Add($message)
  if ($message.name -eq $Name -or $message.type -eq $Name -or $message.requestId -eq $Name) {
   if ($message.error) { throw $message.error }; return $message
  }
 }
 throw "Timed out waiting for $Name"
}
function Set-Shortcut([string]$Key, [string]$Mode) {
 Send-Command @{ type='set_hotkey'; key=$Key; mode=$Mode; requestId='configure' }
 Read-Message 'configure' | Out-Null
}
function Key-Down([int]$Key) { $heldKeys.Add($Key) | Out-Null; [ShortcutTestInput]::Key($Key, $true); Start-Sleep -Milliseconds 20 }
function Key-Up([int]$Key) { [ShortcutTestInput]::Key($Key, $false); $heldKeys.Remove($Key) | Out-Null; Start-Sleep -Milliseconds 20 }
function Chord([int[]]$Keys) {
 foreach ($key in $Keys) { Key-Down $key }
 for ($index=$Keys.Length-1; $index -ge 0; $index--) { Key-Up $Keys[$index] }
}

try {
 foreach ($key in @(0x10,0x11,0x12,0xA0,0xA2,0xA4,0xA5,0x5B,0x77,0x20,0x4B,0x4D)) { [ShortcutTestInput]::Key($key, $false) }
 $form.Show(); $form.Activate(); $field.Focus() | Out-Null; [System.Windows.Forms.Application]::DoEvents()
 $helper.Start() | Out-Null; Read-Message 'ready' | Out-Null
 [ShortcutTestInput]::Focus($form.Handle); $field.Focus() | Out-Null; [System.Windows.Forms.Application]::DoEvents()
 foreach ($scenario in @(
  @{ key='F8'; keys=@(0x77) },
  @{ key='RALT'; keys=@(0xA5) },
  @{ key='Ctrl+Win'; keys=@(0xA2,0x5B) },
  @{ key='Ctrl+Win'; keys=@(0x5B,0xA2) },
  @{ key='Ctrl+Shift+Space'; keys=@(0xA2,0xA0,0x20) },
  @{ key='Ctrl+Alt+K'; keys=@(0xA2,0xA4,0x4B) }
 )) {
  Set-Shortcut $scenario.key 'push_to_talk'
  [ShortcutTestInput]::Focus($form.Handle); $field.Focus() | Out-Null; [System.Windows.Forms.Application]::DoEvents()
  $before = @($messages | Where-Object name -eq 'hotkey_down').Count
  foreach ($key in $scenario.keys) { Key-Down $key }
  $down = Read-Message 'hotkey_down'
  if ($down.targetHwnd -ne $form.Handle.ToInt64().ToString()) { throw "Hotkey captured the wrong window ($($down.targetHwnd), expected $($form.Handle.ToInt64()))" }
  Key-Down $scenario.keys[-1] # auto-repeat must not start another recording
  for ($index=$scenario.keys.Length-1; $index -ge 0; $index--) { Key-Up $scenario.keys[$index] }
  Read-Message 'hotkey_up' | Out-Null
  foreach ($key in $scenario.keys) { if (([ShortcutTestInput]::GetAsyncKeyState($key) -band 0x8000) -ne 0) { throw "Shortcut left key $key pressed in Windows" } }
  if (@($messages | Where-Object name -eq 'hotkey_down').Count -ne $before+1) { throw 'Auto-repeat triggered multiple recordings' }
  Write-Output "PASS: $($scenario.key) hold / release / repeat"
 }
 Set-Shortcut 'Alt+Win+M' 'toggle'
 [ShortcutTestInput]::Focus($form.Handle)
 Chord @(0x5B,0xA4,0x4D); Read-Message 'hotkey_toggle' | Out-Null
 Chord @(0x5B,0xA4,0x4D); Read-Message 'hotkey_toggle' | Out-Null
 Write-Output 'PASS: Alt+Win+M toggles twice'
 Set-Shortcut 'Ctrl+Alt+K' 'push_to_talk'
 $before = @($messages | Where-Object name -eq 'hotkey_down').Count
 Chord @(0xA2,0xA0,0x4B)
 Send-Command @{ type='ping'; requestId='sync' }; Read-Message 'pong' | Out-Null
 if (@($messages | Where-Object name -eq 'hotkey_down').Count -ne $before) { throw 'Wrong modifier combination triggered dictation' }
 Write-Output 'PASS: wrong modifiers do not trigger'
 Send-Command @{ type='begin_shortcut_capture'; requestId='capture' }; Read-Message 'capture' | Out-Null
 Chord @(0xA2,0xA4,0x4B)
 $captured = Read-Message 'shortcut_captured'
 if ($captured.shortcut -ne 'Ctrl+Alt+K') { throw 'Custom shortcut recorder lost keys' }
 Write-Output 'PASS: custom recorder captures Ctrl+Alt+K'
 Send-Command @{ type='begin_shortcut_test'; key='Ctrl+Win'; mode='push_to_talk'; requestId='test' }; Read-Message 'test' | Out-Null
 Chord @(0xA2,0x5B); $verified = Read-Message 'shortcut_tested'
 if ($verified.mode -ne 'push_to_talk') { throw 'Wrong mode was verified' }
 Send-Command @{ type='begin_shortcut_test'; key='Alt+Win+M'; mode='toggle'; requestId='test' }; Read-Message 'test' | Out-Null
 Chord @(0x5B,0xA4,0x4D); Read-Message 'shortcut_test_progress' | Out-Null
 Chord @(0x5B,0xA4,0x4D); $verified = Read-Message 'shortcut_tested'
 if ($verified.mode -ne 'toggle') { throw 'Toggle test did not verify two presses' }
 Write-Output 'PASS: in-app verification detects hold/release and both toggle presses'
} finally {
 foreach ($key in @($heldKeys)) { [ShortcutTestInput]::Key($key, $false) }
 if ($helper.Id -and !$helper.HasExited) { Send-Command @{ type='quit' }; if (!$helper.WaitForExit(1000)) { $helper.Kill() } }
 foreach ($key in @(0x10,0x11,0x12,0xA0,0xA2,0xA4,0xA5,0x5B,0x77,0x20,0x4B,0x4D)) { [ShortcutTestInput]::Key($key, $false) }
 $helper.Dispose(); $form.Dispose()
 [ShortcutTestInput]::SetForegroundWindow($previousWindow) | Out-Null
}
