param(
  [ValidateSet('user','system')][string]$Scope = '',
  [ValidateSet('ae','premiere','both')][string]$App = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Scope) {
  Write-Host "Remove from which scope?" -ForegroundColor Cyan
  Write-Host "  1) User [default]"
  Write-Host "  2) System (all users)"
  $choice = Read-Host 'Choose [1/2]'
  if ($choice -eq '2') { $Scope = 'system' } else { $Scope = 'user' }
}

if ($Scope -eq 'system') {
  $destBase = Join-Path $env:ProgramData 'Adobe\CEP\extensions'
} else {
  $destBase = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
}

if (-not $App) {
  Write-Host "Remove which app?" -ForegroundColor Cyan
  Write-Host "  1) After Effects"
  Write-Host "  2) Premiere Pro"
  Write-Host "  3) Both"
  $choiceApp = Read-Host 'Choose [1/2/3]'
  switch ($choiceApp) {
    '1' { $App = 'ae' }
    '2' { $App = 'premiere' }
    '3' { $App = 'both' }
    default { $App = 'premiere' }
  }
}

function Remove-AE {
  $extId = 'com.sync.extension.ae.panel'
  $destDir = Join-Path $destBase $extId
  Write-Host "Removing AE panel from: $destDir" -ForegroundColor Yellow
  
  if (Test-Path $destDir) {
    Remove-Item -Path $destDir -Recurse -Force
    Write-Host "✅ After Effects extension removed successfully" -ForegroundColor Green
  } else {
    Write-Host "ℹ️  After Effects extension not found (already removed)" -ForegroundColor Blue
  }
}

function Remove-Premiere {
  $extId = 'com.sync.extension.ppro.panel'
  $destDir = Join-Path $destBase $extId
  Write-Host "Removing Premiere panel from: $destDir" -ForegroundColor Yellow
  
  if (Test-Path $destDir) {
    Remove-Item -Path $destDir -Recurse -Force
    Write-Host "✅ Premiere Pro extension removed successfully" -ForegroundColor Green
  } else {
    Write-Host "ℹ️  Premiere Pro extension not found (already removed)" -ForegroundColor Blue
  }
}

switch ($App) {
  'ae' { Remove-AE }
  'premiere' { Remove-Premiere }
  'both' { Remove-AE; Remove-Premiere }
}

Write-Host ""
Write-Host "✅ Removal complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Note: Restart Adobe applications to see changes."
Write-Host ""
Write-Host "Tip: Re-run with parameters:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/remove.ps1 -Scope user|system -App ae|premiere|both"
