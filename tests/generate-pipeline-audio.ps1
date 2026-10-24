param([string]$Output = (Join-Path $PSScriptRoot '.runtime\pipeline-live\audio'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.SelectVoice('Microsoft Ravi')
    $speaker.Rate = -1
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $samples = @{
        'dictation' = 'Kal meeting hai aur Rahul ko report bhejna hai.'
        'short' = 'Isko short karo.'
        'points' = 'Points mein banao.'
        'spelling' = 'Spelling theek karo.'
        'hindi-short' = 'Isko chhota kar do.'
        'english' = 'Please send the report tomorrow morning.'
    }
    foreach ($id in $samples.Keys) {
        $speaker.SetOutputToWaveFile((Join-Path $Output "$id.wav"), $format)
        $speaker.Speak($samples[$id])
        $speaker.SetOutputToNull()
    }
    $samples | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'references.json') -Encoding utf8
    Write-Output "Generated $($samples.Count) synthetic clips with Microsoft Ravi."
} finally { $speaker.Dispose() }
