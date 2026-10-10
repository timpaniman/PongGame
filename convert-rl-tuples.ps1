$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $root "telemetry.json"
$outputPath = Join-Path $root "rl_tuples.json"

$telemetry = Get-Content -Raw $sourcePath | ConvertFrom-Json
$lines = New-Object System.Collections.Generic.List[string]
$counts = @{
  tuples = 0
  paddle_returns = 0
  wins = 0
  losses = 0
}

function Format-Number($value) {
  return ([double]$value).ToString("0.#####", [Globalization.CultureInfo]::InvariantCulture)
}

function Format-State($state) {
  return "[{0},{1},{2},{3},{4}]" -f @(
    (Format-Number $state.x),
    (Format-Number $state.y),
    (Format-Number $state.vx),
    (Format-Number $state.vy),
    (Format-Number $state.paddleX)
  )
}

function Get-ActionIndex($action) {
  switch ([int]$action) {
    -1 { return 0 }
    0 { return 1 }
    1 { return 2 }
    default { throw "Unexpected action $action" }
  }
}

function Add-Tuple($roundNumber, $state, $action, $reward, $nextState, $done) {
  $script:counts.tuples++
  $doneText = $(if ($done) { "true" } else { "false" })
  $nextText = $(if ($null -eq $nextState) { "[0,0,0,0,0]" } else { Format-State $nextState })
  $script:lines.Add((
    '{{"round":{0},"state":{1},"action":{2},"action_index":{3},"reward":{4},"next_state":{5},"done":{6}}}' -f @(
      $roundNumber,
      (Format-State $state),
      ([int]$action),
      (Get-ActionIndex $action),
      (Format-Number $reward),
      $nextText,
      $doneText
    )
  ))
}

foreach ($round in $telemetry.rounds) {
  if ($round.result -eq "playing") { continue }
  $frames = @($round.tuples)
  if ($frames.Count -eq 0) { continue }

  for ($i = 0; $i -lt $frames.Count; $i++) {
    $current = $frames[$i]
    $isLast = $i -eq ($frames.Count - 1)
    $reward = 0.0
    $next = $null

    if (-not $isLast) {
      $next = $frames[$i + 1].state
      $returned = $current.state.vy -gt 0.2 -and $next.vy -lt -0.2 -and $next.y -gt 0.75
      if ($returned) {
        $reward = 1.0
        $counts.paddle_returns++
      }
    } else {
      if ($round.result -eq "win") {
        $reward = 1.0
        $counts.wins++
      } else {
        $reward = -1.0
        $counts.losses++
      }
    }

    Add-Tuple $round.round $current.state $current.action $reward $next $isLast
  }
}

$json = @"
{
  "task": "offline reinforcement learning transitions for a feed-forward network",
  "state_features": ["x", "y", "vx", "vy", "paddleX"],
  "action_index": {"0": -1, "1": 0, "2": 1},
  "reward": {"paddle_return": 1, "win": 1, "loss": -1, "otherwise": 0},
  "counts": {"tuples": $($counts.tuples), "paddle_returns": $($counts.paddle_returns), "wins": $($counts.wins), "losses": $($counts.losses)},
  "tuples": [
    $($lines -join ",`n    ")
  ]
}
"@

[IO.File]::WriteAllText($outputPath, $json)
Write-Output "wrote $outputPath"
Write-Output "tuples $($counts.tuples) returns $($counts.paddle_returns) wins $($counts.wins) losses $($counts.losses)"
