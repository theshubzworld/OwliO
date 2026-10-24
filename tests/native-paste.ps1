param(
    [string]$HelperPath = (Join-Path $PSScriptRoot '..\windows-helper\bin\Release\net8.0-windows\publish\windows-helper.exe'),
    [string]$TextToPaste = 'Hello world',
    [switch]$TestLearning
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DictationTestWindows {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
'@
$previousWindow = [DictationTestWindows]::GetForegroundWindow()
$previousClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Owlio disposable insertion test'
$form.Width = 480
$form.Height = 180
$first = New-Object System.Windows.Forms.TextBox
$first.Text = 'Do not change this field'
$first.Width = 400
$first.Top = 20
$second = New-Object System.Windows.Forms.TextBox
$second.Text = 'Before: '
$second.Width = 400
$second.Top = 60
$form.Controls.AddRange(@($first, $second))
$otherWindow = New-Object System.Windows.Forms.Form
$otherWindow.Text = 'Owlio focus diversion test'
$otherField = New-Object System.Windows.Forms.TextBox
$otherField.Text = 'Leave this window alone'
$otherField.Width = 240
$otherWindow.Controls.Add($otherField)
$helper = New-Object System.Diagnostics.Process
$helper.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
$helper.StartInfo.FileName = [System.IO.Path]::GetFullPath($HelperPath)
$helper.StartInfo.UseShellExecute = $false
$helper.StartInfo.CreateNoWindow = $true
$helper.StartInfo.RedirectStandardInput = $true
$helper.StartInfo.RedirectStandardOutput = $true
$helper.StartInfo.RedirectStandardError = $true
$script:ForbiddenLearningTarget = ''

function Read-HelperMessage([string]$Type, [string]$RequestId = '', [string]$Name = '') {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        $read = $helper.StandardOutput.ReadLineAsync()
        while (!$read.IsCompleted -and [DateTime]::UtcNow -lt $deadline) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 10
        }
        if (!$read.IsCompleted) { throw "Timed out waiting for $Type" }
        $line = $read.GetAwaiter().GetResult()
        if ($null -eq $line) { throw "Helper exited while waiting for $Type" }
        $message = $line | ConvertFrom-Json
        if ($script:ForbiddenLearningTarget -and $message.name -eq 'learning-correction' -and $message.targetId -eq $script:ForbiddenLearningTarget) { throw 'A cancelled or unfocused field produced a learning correction' }
        if ($message.type -eq $Type -and (!$RequestId -or $message.requestId -eq $RequestId) -and (!$Name -or $message.name -eq $Name)) { return $message }
    }
    throw "Timed out waiting for $Type"
}
function Send-HelperMessage($Message) {
    $helper.StandardInput.WriteLine(($Message | ConvertTo-Json -Compress))
    $helper.StandardInput.Flush()
}

try {
    $form.Show()
    $form.Activate()
    $second.Focus() | Out-Null
    $second.SelectionStart = $second.Text.Length
    $second.SelectionLength = 0
    [System.Windows.Forms.Application]::DoEvents()
    for ($settle=0; $settle -lt 10; $settle++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 10 }
    $helper.Start() | Out-Null
    Read-HelperMessage 'ready' | Out-Null
    Send-HelperMessage @{ type = 'get_context'; requestId = 'capture'; targetHwnd = $form.Handle.ToInt64().ToString() }
    $context = Read-HelperMessage 'context_result' 'capture'
    if ($context.error) { throw $context.error }
    # Move to the other field; the helper must restore the originally selected text field.
    $first.Focus() | Out-Null
    $otherWindow.Show()
    $otherWindow.Activate()
    $otherField.Focus() | Out-Null
    [System.Windows.Forms.Application]::DoEvents()
    Send-HelperMessage @{ type = 'paste'; requestId = 'insert'; targetId = 'capture'; text = $TextToPaste; learn = [bool]$TestLearning }
    $result = Read-HelperMessage 'paste_completed' 'insert'
    if (!$result.success) { throw $result.error }
    for ($step = 0; $step -lt 30 -and $second.Text -ne ('Before: ' + $TextToPaste); $step++) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 10
    }
    if ($second.Text -ne ('Before: ' + $TextToPaste)) { throw "Text was not inserted in the selected field: $($second.Text)" }
    $expectedText = 'Before: ' + $TextToPaste
    if ($TestLearning) {
        if ($context.beforeText -ne 'Before: ' -or $context.afterText -ne '') { throw "Cursor ranges were not captured correctly: $($context | ConvertTo-Json -Compress)" }
        $watch = Read-HelperMessage 'event' '' 'learning-observing'
        if ($watch.targetId -ne 'capture') { throw 'Wrong learning target' }
        $corrected = $TextToPaste.Replace('Jhon','John')
        if ($corrected -eq $TextToPaste) { throw 'TestLearning needs a Jhon spelling in TextToPaste' }
        $second.Text = 'Before: ' + $corrected
        $second.SelectionStart = $second.Text.Length
        [System.Windows.Forms.Application]::DoEvents()
        $correction = Read-HelperMessage 'event' '' 'learning-correction'
        if ($correction.originalText -ne $TextToPaste -or $correction.editedText -ne $corrected -or $correction.editedText.Contains('Before:')) { throw 'Learning did not isolate the inserted dictation' }
        $expectedText = 'Before: ' + $corrected
        Write-Output 'PASS: native edit observation isolated a correction to the inserted dictation without including surrounding text.'
        foreach ($learningScenario in @('cancel','focus','new-session')) {
            $form.Activate(); $second.Focus() | Out-Null
            $second.Text = 'Before: '; $second.SelectionStart = $second.Text.Length; $second.SelectionLength=0
            [System.Windows.Forms.Application]::DoEvents()
            Send-HelperMessage @{type='get_context';requestId="watch-$learningScenario";targetHwnd=$form.Handle.ToInt64().ToString()}
            Read-HelperMessage 'context_result' "watch-$learningScenario" | Out-Null
            Send-HelperMessage @{type='paste';requestId="paste-$learningScenario";targetId="watch-$learningScenario";text=$TextToPaste;learn=$true}
            $learningPaste=Read-HelperMessage 'paste_completed' "paste-$learningScenario"
            if (!$learningPaste.success) {throw $learningPaste.error}
            Read-HelperMessage 'event' '' 'learning-observing' | Out-Null
            $script:ForbiddenLearningTarget="watch-$learningScenario"
            if ($learningScenario -eq 'cancel') { Send-HelperMessage @{type='cancel_learning'} }
            elseif ($learningScenario -eq 'focus') { $first.Focus() | Out-Null }
            else { Send-HelperMessage @{type='get_context';requestId='new-context';targetHwnd=$form.Handle.ToInt64().ToString()}; Read-HelperMessage 'context_result' 'new-context' | Out-Null }
            for ($settle=0; $settle -lt 30; $settle++) {[System.Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
            $second.Text = 'Before: ' + $corrected
            for ($settle=0; $settle -lt 160; $settle++) {[System.Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
            Send-HelperMessage @{type='ping'}
            Read-HelperMessage 'pong' | Out-Null
            $script:ForbiddenLearningTarget=''
        }
        Write-Output 'PASS: turning learning off, changing focus and starting a new session stop native edit observation.'
        # Restore the original target for the existing stale/expiry insertion checks.
        $second.Focus() | Out-Null
        Send-HelperMessage @{type='get_context';requestId='capture';targetHwnd=$form.Handle.ToInt64().ToString()}
        Read-HelperMessage 'context_result' 'capture' | Out-Null
    }
    if ($first.Text -ne 'Do not change this field') { throw 'The wrong field was modified' }
    if ($otherField.Text -ne 'Leave this window alone') { throw 'The wrong window was modified' }
    Send-HelperMessage @{ type = 'paste'; requestId = 'stale'; targetId = 'wrong-session'; text = 'Wrong' }
    $stale = Read-HelperMessage 'paste_completed' 'stale'
    if ($stale.success) { throw 'Stale target ID was accepted' }
    Send-HelperMessage @{ type = 'paste'; requestId = 'expired'; targetId = 'capture'; text = 'Wrong'; expiresAt = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 1000) }
    $expired = Read-HelperMessage 'paste_completed' 'expired'
    if ($expired.success -or $expired.error -notmatch 'timed out') { throw 'Expired insertion was accepted' }
    [System.Windows.Forms.Application]::DoEvents()
    if ($second.Text -ne $expectedText) { throw 'Expired insertion changed the text field' }
    $form.Activate(); $second.Focus() | Out-Null
    $second.Text = 'Before: old source after.'
    $second.Select(8, 10)
    [System.Windows.Forms.Application]::DoEvents()
    Send-HelperMessage @{type='get_context';requestId='rewrite-source';targetHwnd=$form.Handle.ToInt64().ToString()}
    $rewriteContext = Read-HelperMessage 'context_result' 'rewrite-source'
    if ($rewriteContext.selectedText -ne 'old source') {throw 'Rewrite source selection was not captured exactly'}
    Send-HelperMessage @{type='paste';requestId='rewrite';targetId='rewrite-source';text='Revised';expectedSelection='old source'}
    $rewrite = Read-HelperMessage 'paste_completed' 'rewrite'
    if (!$rewrite.success) {throw $rewrite.error}
    for ($step=0;$step -lt 30 -and $second.Text -ne 'Before: Revised after.';$step++) {[System.Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
    if ($second.Text -ne 'Before: Revised after.') {throw 'Rewrite did not replace only the selection'}
    foreach ($changed in @('selection','content')) {
        $second.Text='Before: old source after.';$second.Select(8,10)
        [System.Windows.Forms.Application]::DoEvents()
        Send-HelperMessage @{type='get_context';requestId="changed-$changed";targetHwnd=$form.Handle.ToInt64().ToString()}
        Read-HelperMessage 'context_result' "changed-$changed" | Out-Null
        if ($changed -eq 'selection') {$second.Select($second.Text.Length,0)}
        else {$second.Text='Other: old source after.';$second.Select(7,10)}
        $unchanged=$second.Text
        Send-HelperMessage @{type='paste';requestId="reject-$changed";targetId="changed-$changed";text='Wrong';expectedSelection='old source'}
        $rejected=Read-HelperMessage 'paste_completed' "reject-$changed"
        if ($rejected.success -or $rejected.error -notmatch 'selected rewrite text changed') {throw 'A stale rewrite selection was accepted'}
        [System.Windows.Forms.Application]::DoEvents()
        if ($second.Text -ne $unchanged) {throw 'A rejected rewrite changed the field'}
    }
    Send-HelperMessage @{type='get_context';requestId='capture';targetHwnd=$form.Handle.ToInt64().ToString()}
    Read-HelperMessage 'context_result' 'capture' | Out-Null
    Write-Output 'PASS: rewrite replaces only its captured selection and rejects changed selections or source content.'
    $form.Close()
    Send-HelperMessage @{ type = 'paste'; requestId = 'closed'; targetId = 'capture'; text = 'Wrong' }
    $closed = Read-HelperMessage 'paste_completed' 'closed'
    if ($closed.success) { throw 'Closed target window was accepted' }
    Send-HelperMessage @{ type = 'get_context'; requestId = 'invalid-context'; targetHwnd = '1' }
    $invalid = Read-HelperMessage 'context_result' 'invalid-context'
    if (!$invalid.error) { throw 'Invalid window context was accepted' }
    Write-Output 'PASS: actual Ctrl+V inserted in the captured text field; stale, expired and closed targets rejected; context failures correlated.'
} finally {
    if ($helper.Id -and !$helper.HasExited) {
        Send-HelperMessage @{ type = 'quit' }
        if (!$helper.WaitForExit(1000)) { $helper.Kill() }
    }
    if ($env:OWLIO_HELPER_DIAGNOSTICS -eq '1') {Write-Output $helper.StandardError.ReadToEnd()}
    $helper.Dispose()
    $form.Dispose()
    $otherWindow.Dispose()
    if ($previousClipboard) { [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true) }
    else { [System.Windows.Forms.Clipboard]::Clear() }
    if ($previousWindow -ne [IntPtr]::Zero) { [DictationTestWindows]::SetForegroundWindow($previousWindow) | Out-Null }
}
