param(
  [ValidateSet('user','system')][string]$Scope = '',
  [ValidateSet('ae','premiere','both')][string]$App = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

function Test-NodeJS {
  # Check common Node.js installation paths
  $nodePaths = @(
    "node",  # PATH lookup
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "$env:APPDATA\npm\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  
  foreach ($nodePath in $nodePaths) {
    try {
      if ($nodePath -eq "node") {
        # Try PATH lookup
        $nodeVersion = & node --version 2>$null
        $npmVersion = & npm --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $nodeVersion -and $npmVersion) {
          return $true
        }
      } else {
        # Try specific path
        if (Test-Path $nodePath) {
          $nodeVersion = & $nodePath --version 2>$null
          if ($LASTEXITCODE -eq 0 -and $nodeVersion) {
            # Also check for npm in the same directory
            $npmPath = Join-Path (Split-Path $nodePath) "npm.cmd"
            if (Test-Path $npmPath) {
              $npmVersion = & $npmPath --version 2>$null
              if ($LASTEXITCODE -eq 0 -and $npmVersion) {
                return $true
              }
            }
          }
        }
      }
    } catch {
      # Continue to next path
    }
  }
  
  return $false
}

function Install-NodeJS {
  Write-Host ""
  Write-Host "❌ Node.js not found!" -ForegroundColor Red
  Write-Host ""
  Write-Host "Node.js is required for the extension to work." -ForegroundColor Yellow
  Write-Host ""
  
  # Try to install Node.js automatically with winget
  Write-Host "Attempting to install Node.js automatically..." -ForegroundColor Cyan
  
  try {
    # Check if winget is available
    $wingetVersion = winget --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Installing Node.js LTS with winget..." -ForegroundColor Green
      winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      
      if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Node.js installed successfully!" -ForegroundColor Green
        Write-Host "Please restart PowerShell and run this script again." -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 0
      } else {
        Write-Host "❌ winget installation failed" -ForegroundColor Red
      }
    } else {
      Write-Host "❌ winget not available" -ForegroundColor Red
    }
  } catch {
    Write-Host "❌ winget installation failed: $($_.Exception.Message)" -ForegroundColor Red
  }
  
  Write-Host ""
  Write-Host "Manual installation required:" -ForegroundColor Cyan
  Write-Host "1. Download from https://nodejs.org (choose LTS version)"
  Write-Host "2. Run the installer"
  Write-Host "3. Restart PowerShell"
  Write-Host "4. Run this script again"
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

# Check for Node.js before proceeding
if (-not (Test-NodeJS)) {
  Install-NodeJS
}

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
  
  $enabledVersions = @()
  foreach ($v in 10,11,12,13,14) {
    try {
      New-Item -Path "HKCU:\Software\Adobe\CSXS.$v" -ErrorAction SilentlyContinue | Out-Null
      Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$v" -Name PlayerDebugMode -Type DWord -Value 1 -ErrorAction SilentlyContinue
      $enabledVersions += $v
    } catch {
      Write-Host "Warning: Could not enable PlayerDebugMode for CSXS.$v" -ForegroundColor Yellow
    }
  }
  
  if ($enabledVersions.Count -gt 0) {
    Write-Host "✅ PlayerDebugMode enabled for CSXS versions: $($enabledVersions -join ', ')" -ForegroundColor Green
  } else {
    Write-Host "❌ Failed to enable PlayerDebugMode" -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator and try again" -ForegroundColor Yellow
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
      # Try npm from PATH first, then common locations
      $npmPaths = @(
        "npm",
        "C:\Program Files\nodejs\npm.cmd",
        "C:\Program Files (x86)\nodejs\npm.cmd",
        "$env:APPDATA\npm\npm.cmd",
        "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
      )
      
      $npmInstalled = $false
      foreach ($npmPath in $npmPaths) {
        try {
          if ($npmPath -eq "npm") {
            & npm install --omit=dev
          } else {
            if (Test-Path $npmPath) {
              & $npmPath install --omit=dev
            }
          }
          if ($LASTEXITCODE -eq 0) {
            $npmInstalled = $true
            break
          }
        } catch {
          # Continue to next path
        }
      }
      
      if (-not $npmInstalled) {
        Write-Host "❌ Failed to install server dependencies" -ForegroundColor Red
        Write-Host "Please ensure Node.js and npm are properly installed" -ForegroundColor Yellow
      }
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
      # Try npm from PATH first, then common locations
      $npmPaths = @(
        "npm",
        "C:\Program Files\nodejs\npm.cmd",
        "C:\Program Files (x86)\nodejs\npm.cmd",
        "$env:APPDATA\npm\npm.cmd",
        "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
      )
      
      $npmInstalled = $false
      foreach ($npmPath in $npmPaths) {
        try {
          if ($npmPath -eq "npm") {
            & npm install --omit=dev
          } else {
            if (Test-Path $npmPath) {
              & $npmPath install --omit=dev
            }
          }
          if ($LASTEXITCODE -eq 0) {
            $npmInstalled = $true
            break
          }
        } catch {
          # Continue to next path
        }
      }
      
      if (-not $npmInstalled) {
        Write-Host "❌ Failed to install server dependencies" -ForegroundColor Red
        Write-Host "Please ensure Node.js and npm are properly installed" -ForegroundColor Yellow
      }
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

# Verify installation
Write-Host "Verifying installation..." -ForegroundColor Cyan
$installSuccess = $true

switch ($App) {
  'ae' { 
    $aeDir = Join-Path $destBase 'com.sync.extension.ae.panel'
    if (Test-Path $aeDir) {
      Write-Host "✅ AE extension installed: $aeDir" -ForegroundColor Green
    } else {
      Write-Host "❌ AE extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
  }
  'premiere' { 
    $pproDir = Join-Path $destBase 'com.sync.extension.ppro.panel'
    if (Test-Path $pproDir) {
      Write-Host "✅ Premiere extension installed: $pproDir" -ForegroundColor Green
    } else {
      Write-Host "❌ Premiere extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
  }
  'both' { 
    $aeDir = Join-Path $destBase 'com.sync.extension.ae.panel'
    $pproDir = Join-Path $destBase 'com.sync.extension.ppro.panel'
    if (Test-Path $aeDir) {
      Write-Host "✅ AE extension installed: $aeDir" -ForegroundColor Green
    } else {
      Write-Host "❌ AE extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
    if (Test-Path $pproDir) {
      Write-Host "✅ Premiere extension installed: $pproDir" -ForegroundColor Green
    } else {
      Write-Host "❌ Premiere extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
  }
}

Write-Host ""
if ($installSuccess) {
  Write-Host "🎉 Installation successful!" -ForegroundColor Green
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "1. Close Adobe applications completely"
  Write-Host "2. Wait 10 seconds"
  Write-Host "3. Launch Adobe application"
  Write-Host "4. Go to Window > Extensions > 'sync. for [App]'"
  Write-Host ""
  Write-Host "If extension doesn't appear:" -ForegroundColor Yellow
  Write-Host "• Make sure PlayerDebugMode is enabled (done automatically)"
  Write-Host "• Restart Adobe application"
  Write-Host "• Check that Node.js is installed and working"
} else {
  Write-Host "❌ Installation failed!" -ForegroundColor Red
  Write-Host "Please run this script as Administrator and try again" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Tip: Re-run with parameters:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Scope user|system -App ae|premiere|both"
