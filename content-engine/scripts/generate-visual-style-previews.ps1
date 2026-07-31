param(
  [ValidateSet('gpt-image-2', 'gpt-image-2-ext')]
  [string]$Model = 'gpt-image-2',
  [ValidateSet('1k', '2k', '4k')]
  [string]$Resolution = '2k',
  [string[]]$Only = @(),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $PSScriptRoot 'visual-style-previews.json'
$outputDir = Join-Path $projectRoot 'public\visual-style-previews'
$generatorScript = Join-Path $env:USERPROFILE '.codex\skills\apimart-imagegen\scripts\apimart_generate_image.py'
if (-not (Test-Path -LiteralPath $generatorScript)) {
  throw "APIMart image generator not found: $generatorScript"
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$manifest = Get-Content -Raw -Encoding utf8 $manifestPath | ConvertFrom-Json
$items = $manifest.items
$sharedPrompt = $manifest.sharedPrompt

foreach ($item in $items) {
  if ($Only.Count -gt 0 -and $Only -notcontains $item.id) { continue }
  $target = Join-Path $outputDir $item.filename
  if ((Test-Path -LiteralPath $target) -and -not $Force) {
    Write-Host "Skip existing: $($item.id)"
    continue
  }

  $prompt = $sharedPrompt + [Environment]::NewLine + 'Visual direction: ' + $item.style + '. Deliver a polished production template, not a concept sketch.'
  Write-Host "Generating: $($item.id)"
  & python $generatorScript --prompt $prompt --model $Model --size '4:3' --resolution $Resolution --out-dir $outputDir --filename $item.filename
  if ($LASTEXITCODE -ne 0) { throw "Generation failed: $($item.id)" }
}

Write-Host "Generated previews: $outputDir"
