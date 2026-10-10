$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://127.0.0.1:8765/"
$datasetPath = Join-Path $root "telemetry.json"

function Read-TelemetryFile($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function ConvertTo-PlainRound($round, $session, $sourceRound, $globalRound) {
  $tuples = New-Object System.Collections.Generic.List[hashtable]
  foreach ($tuple in @($round.tuples)) {
    if (-not $tuple -or -not $tuple.state) { continue }
    $state = $tuple.state
    $tuples.Add(@{
      state = @{
        x = [double]$state.x
        y = [double]$state.y
        vx = [double]$state.vx
        vy = [double]$state.vy
        paddleX = [double]$state.paddleX
      }
      action = [int]$tuple.action
    })
  }
  return @{
    round = [int]$globalRound
    session = [string]$session
    sourceRound = [int]$sourceRound
    result = [string]$round.result
    tuples = $tuples
  }
}

function Merge-Telemetry($existing, $incoming) {
  $stored = New-Object System.Collections.Generic.List[object]
  if ($existing -and $existing.rounds) {
    foreach ($round in @($existing.rounds)) {
      $session = [string]$round.session
      if (-not $session) { $session = [string]$existing.session }
      $sourceRound = $round.sourceRound
      if ($null -eq $sourceRound) { $sourceRound = $round.round }
      $stored.Add((ConvertTo-PlainRound $round $session $sourceRound 0))
    }
  }

  $incomingSession = [string]$incoming.session
  foreach ($round in @($incoming.rounds)) {
    $sourceRound = [int]$round.round
    $match = -1
    for ($i = 0; $i -lt $stored.Count; $i++) {
      if ($stored[$i].session -eq $incomingSession -and [int]$stored[$i].sourceRound -eq $sourceRound) {
        $match = $i
        break
      }
    }
    $plain = ConvertTo-PlainRound $round $incomingSession $sourceRound 0
    if ($match -ge 0) {
      $stored[$match] = $plain
    } else {
      $stored.Add($plain)
    }
  }

  for ($i = 0; $i -lt $stored.Count; $i++) {
    $stored[$i].round = $i + 1
  }

  $features = New-Object System.Collections.Generic.List[string]
  $featureSource = $incoming.features
  if (-not $featureSource -and $existing) { $featureSource = $existing.features }
  foreach ($feature in @($featureSource)) {
    if ($feature) { $features.Add([string]$feature) }
  }
  $normalizationSource = $incoming.normalization
  if (-not $normalizationSource -and $existing) { $normalizationSource = $existing.normalization }
  $normalization = @{
    x = [string]$normalizationSource.x
    y = [string]$normalizationSource.y
    vx = [string]$normalizationSource.vx
    vy = [string]$normalizationSource.vy
    paddleX = [string]$normalizationSource.paddleX
  }
  return @{
    features = $features
    normalization = $normalization
    rounds = $stored
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "LISTENING $prefix"
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/telemetry") {
        $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        if ($body -notmatch '"tuples"' -or $body -notmatch '"state"' -or $body -notmatch '"action"') {
          throw "Telemetry must include state and action tuples."
        }
        $incoming = $body | ConvertFrom-Json
        $merged = Merge-Telemetry (Read-TelemetryFile $datasetPath) $incoming
        $json = $merged | ConvertTo-Json -Depth 12 -Compress
        [IO.File]::WriteAllText($datasetPath, $json)
        $bytes = [Text.Encoding]::UTF8.GetBytes("{""ok"":true,""rounds"":$($merged.rounds.Count)}")
        $context.Response.StatusCode = 200
        $context.Response.ContentType = "application/json"
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        if ($path -eq "/") { $path = "/index.html" }
        $relative = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
        $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
        $fullRoot = [IO.Path]::GetFullPath($root)
        if ($file.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
          $bytes = [IO.File]::ReadAllBytes($file)
          switch ([IO.Path]::GetExtension($file).ToLowerInvariant()) {
            ".html" { $context.Response.ContentType = "text/html; charset=utf-8" }
            ".css" { $context.Response.ContentType = "text/css; charset=utf-8" }
            ".js" { $context.Response.ContentType = "application/javascript; charset=utf-8" }
            ".json" { $context.Response.ContentType = "application/json; charset=utf-8" }
            default { $context.Response.ContentType = "application/octet-stream" }
          }
          $context.Response.Headers["Cache-Control"] = "no-store"
          $context.Response.StatusCode = 200
          $context.Response.ContentLength64 = $bytes.Length
          $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
          $context.Response.StatusCode = 404
        }
      }
    } catch {
      $context.Response.StatusCode = 500
      $message = [Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      $context.Response.OutputStream.Write($message, 0, $message.Length)
    } finally {
      $context.Response.Close()
    }
  }
} finally {
  $listener.Stop()
}
