param(
  [ValidateSet('user','system')][string]$Scope = '',
  [ValidateSet('ae','premiere','both')][string]$App = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

if (-not $Scope) {
  Write-Host "Install scope?" -ForegroundColor Cyan
  Write-Host "  1) User (no admin) [default]"
  Write-Host "  2) System (all users, admin)"
  $choice = Read-Host 'Choose [1/2]'
  if ($choice -eq '2') { $Scope = 'system' } else { $Scope = 'user' }
}

if ($Scope -eq 'system') {
  $destBase = Join-Path $env:ProgramData 'Adobe\CEP\extensions'
} else {
  $destBase = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
}

if (-not $App) {
  Write-Host "Install which app?" -ForegroundColor Cyan
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

function Enable-PlayerDebugMode {
  Write-Host "Enabling PlayerDebugMode for unsigned extensions..." -ForegroundColor Yellow
  foreach ($v in 10,11,12,13,14) {
    New-Item -Path "HKCU:\Software\Adobe\CSXS.$v" -ErrorAction SilentlyContinue | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$v" -Name PlayerDebugMode -Type DWord -Value 1 -ErrorAction SilentlyContinue
  }
}

function Install-AE {
  $extId = 'com.sync.extension.ae.panel'
  $destDir = Join-Path $destBase $extId
  Write-Host "Installing AE panel to: $destDir" -ForegroundColor Green
  
  # Remove existing installation
  if (Test-Path $destDir) {
    Remove-Item -Path $destDir -Recurse -Force
  }
  
  # Create directory structure
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  
  # Copy core project files (mirror macOS rsync behavior)
  # Exclude: .git, dist, extensions, scripts, CSXS
  $excludeDirs = @(
    (Join-Path $repoRoot '.git'),
    (Join-Path $repoRoot 'dist'),
    (Join-Path $repoRoot 'extensions'),
    (Join-Path $repoRoot 'scripts'),
    (Join-Path $repoRoot 'CSXS')
  )
  robocopy $repoRoot $destDir /E /NFL /NDL /NJH /NJS /XD $excludeDirs | Out-Null
  
  # Overlay AE-specific files (host-detection + manifest)
  $aeExtDir = Join-Path $repoRoot 'extensions\ae-extension'
  if (Test-Path (Join-Path $aeExtDir 'ui')) { New-Item -ItemType Directory -Path (Join-Path $destDir 'ui') -Force | Out-Null }
  if (Test-Path (Join-Path $aeExtDir 'ui\host-detection.js')) { Copy-Item (Join-Path $aeExtDir 'ui\host-detection.js') (Join-Path $destDir 'ui\host-detection.js') -Force }
  New-Item -ItemType Directory -Path (Join-Path $destDir 'CSXS') -Force | Out-Null
  if (Test-Path (Join-Path $aeExtDir 'CSXS\manifest.xml')) { Copy-Item (Join-Path $aeExtDir 'CSXS\manifest.xml') (Join-Path $destDir 'CSXS\manifest.xml') -Force }
  
  # Install server dependencies
  $serverDir = Join-Path $destDir 'server'
  if (Test-Path $serverDir) {
    Write-Host "Installing server dependencies..." -ForegroundColor Yellow
    Push-Location $serverDir
    try {
      npm install --omit=dev
    } finally {
      Pop-Location
    }
  }
}

function Install-Premiere {
  $extId = 'com.sync.extension.ppro.panel'
  $destDir = Join-Path $destBase $extId
  Write-Host "Installing Premiere panel to: $destDir" -ForegroundColor Green
  
  # Remove existing installation
  if (Test-Path $destDir) {
    Remove-Item -Path $destDir -Recurse -Force
  }
  
  # Create directory structure
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  
  # Copy core project files (mirror macOS rsync behavior)
  # Exclude: .git, dist, extensions, scripts, CSXS
  $excludeDirs = @(
    (Join-Path $repoRoot '.git'),
    (Join-Path $repoRoot 'dist'),
    (Join-Path $repoRoot 'extensions'),
    (Join-Path $repoRoot 'scripts'),
    (Join-Path $repoRoot 'CSXS')
  )
  robocopy $repoRoot $destDir /E /NFL /NDL /NJH /NJS /XD $excludeDirs | Out-Null
  
  # Overlay Premiere-specific files (host-detection + manifest)
  $pproExtDir = Join-Path $repoRoot 'extensions\premiere-extension'
  if (Test-Path (Join-Path $pproExtDir 'ui')) { New-Item -ItemType Directory -Path (Join-Path $destDir 'ui') -Force | Out-Null }
  if (Test-Path (Join-Path $pproExtDir 'ui\host-detection.js')) { Copy-Item (Join-Path $pproExtDir 'ui\host-detection.js') (Join-Path $destDir 'ui\host-detection.js') -Force }
  New-Item -ItemType Directory -Path (Join-Path $destDir 'CSXS') -Force | Out-Null
  if (Test-Path (Join-Path $pproExtDir 'CSXS\manifest.xml')) { Copy-Item (Join-Path $pproExtDir 'CSXS\manifest.xml') (Join-Path $destDir 'CSXS\manifest.xml') -Force }
  
  # Install server dependencies
  $serverDir = Join-Path $destDir 'server'
  if (Test-Path $serverDir) {
    Write-Host "Installing server dependencies..." -ForegroundColor Yellow
    Push-Location $serverDir
    try {
      npm install --omit=dev
    } finally {
      Pop-Location
    }
  }
}

Enable-PlayerDebugMode

switch ($App) {
  'ae' { Install-AE }
  'premiere' { Install-Premiere }
  'both' { Install-AE; Install-Premiere }
}

Write-Host ""
Write-Host "✅ Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To use:"
switch ($App) {
  'ae' { Write-Host "• After Effects: Window > Extensions > 'sync. for After Effects'" }
  'premiere' { Write-Host "• Premiere Pro: Window > Extensions > 'sync. for Premiere'" }
  'both' { 
    Write-Host "• After Effects: Window > Extensions > 'sync. for After Effects'"
    Write-Host "• Premiere Pro: Window > Extensions > 'sync. for Premiere'"
  }
}
Write-Host ""
Write-Host "Note: Restart Adobe applications to see the extensions."
Write-Host ""
Write-Host "Tip: Re-run with parameters:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Scope user|system -App ae|premiere|both"
