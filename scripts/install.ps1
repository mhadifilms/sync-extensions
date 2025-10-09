param(
  [ValidateSet('ae','premiere','both')][string]$App = ''
)

$ErrorActionPreference = 'Stop'

# Add timeout and better error handling for update operations
$script:UpdateTimeout = 240 # 4 minutes timeout for update operations
$script:NpmTimeout = 300 # 5 minutes timeout for npm operations

# Progress bar functions
function Show-Progress {
    param(
        [int]$Current,
        [int]$Total,
        [string]$Message
    )
    
    $width = 50
    $percentage = [math]::Round(($Current * 100) / $Total)
    $filled = [math]::Round(($Current * $width) / $Total)
    $empty = $width - $filled
    
    $progressBar = "[" + ("=" * $filled) + (" " * $empty) + "] $percentage% $Message"
    Write-Host "`r$progressBar" -NoNewline
    if ($Current -eq $Total) {
        Write-Host ""
    }
}

function Hide-Output {
    param([scriptblock]$ScriptBlock)
    try {
        & $ScriptBlock *>$null
    } catch {
        # Silent failure
    }
}

function Invoke-NpmWithTimeout {
    param(
        [string]$Command,
        [int]$TimeoutSeconds = 300
    )
    
    try {
        # Create a job to run the npm command
        $job = Start-Job -ScriptBlock { param($cmd) & $cmd } -ArgumentList $Command
        
        # Wait for the job to complete with timeout
        $result = Wait-Job -Job $job -Timeout $TimeoutSeconds
        
        if ($result) {
            # Job completed successfully
            $output = Receive-Job -Job $job
            Remove-Job -Job $job
            return $output
        } else {
            # Job timed out
            Stop-Job -Job $job
            Remove-Job -Job $job
            return $null
        }
    } catch {
        # Error occurred
        return $null
    }
}

Write-Host "sync. Extension Installer" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

$repoRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

# GNU-style flag normalization to support --app usage
# Example: .\install.ps1 --app premiere
try {
  for ($i = 0; $i -lt $args.Count; $i++) {
    switch -Regex ($args[$i]) {
      '^--app$' {
        if ($i + 1 -lt $args.Count -and -not [string]::IsNullOrWhiteSpace($args[$i+1])) {
          $AppCandidate = ($args[$i+1]).ToLowerInvariant()
          if ($AppCandidate -in @('ae','aftereffects','after-effects')) { $App = 'ae' }
          elseif ($AppCandidate -in @('premiere','ppro','premierepro')) { $App = 'premiere' }
          elseif ($AppCandidate -in @('both','all')) { $App = 'both' }
        }
      }
    }
  }
} catch {}

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
        if ($LASTEXITCODE -eq 0 -and $nodeVersion) {
          # Test npm separately with better error handling
          try {
            $npmVersion = & npm --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $npmVersion) {
              return $true
            }
          } catch {
            # npm failed, continue to next path
            continue
          }
        }
      } else {
        # Try specific path
        if (Test-Path $nodePath) {
          $nodeVersion = & $nodePath --version 2>$null
          if ($LASTEXITCODE -eq 0 -and $nodeVersion) {
            # Also check for npm in the same directory
            $npmPath = Join-Path (Split-Path $nodePath) "npm.cmd"
            if (Test-Path $npmPath) {
              try {
                $npmVersion = & $npmPath --version 2>$null
                if ($LASTEXITCODE -eq 0 -and $npmVersion) {
                  return $true
                }
              } catch {
                # npm failed, continue to next path
                continue
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

# Always use user scope (no admin required)
$Scope = 'user'

# User-specific CEP extensions directory (no admin required)
$destBase = Join-Path $env:APPDATA 'Adobe\CEP\extensions'

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

# Calculate total steps
$totalSteps = 0
if ($App -eq 'ae' -or $App -eq 'both') { $totalSteps += 5 }
if ($App -eq 'premiere' -or $App -eq 'both') { $totalSteps += 5 }
$currentStep = 0

Show-Progress $currentStep $totalSteps "Starting installation..."

function Enable-PlayerDebugMode {
  $enabledVersions = @()
  foreach ($v in 10,11,12,13,14) {
    try {
      Hide-Output { New-Item -Path "HKCU:\Software\Adobe\CSXS.$v" -ErrorAction SilentlyContinue }
      Hide-Output { Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$v" -Name PlayerDebugMode -Type DWord -Value 1 -ErrorAction SilentlyContinue }
      $enabledVersions += $v
    } catch {
      # Silent failure
    }
  }
}

function Install-AE {
  $extId = 'com.sync.extension.ae.panel'
  $destDir = Join-Path $destBase $extId
  
  $currentStep++
  Show-Progress $currentStep $totalSteps "Preparing After Effects extension..."
  
  # Remove existing installation
  if (Test-Path $destDir) {
    Hide-Output { Remove-Item -Path $destDir -Recurse -Force }
  }
  
  # Create directory structure
  Hide-Output { New-Item -ItemType Directory -Path $destDir -Force }
  
  # Copy core project files (mirror macOS rsync behavior)
  $currentStep++
  Show-Progress $script:currentStep $totalSteps "Copying extension files..."
  # Exclude: .git, dist, extensions, scripts, CSXS, node_modules, .DS_Store, *.log, .env, .vscode
  $excludeDirs = @(
    (Join-Path $repoRoot '.git'),
    (Join-Path $repoRoot 'dist'),
    (Join-Path $repoRoot 'extensions'),
    (Join-Path $repoRoot 'scripts'),
    (Join-Path $repoRoot 'CSXS'),
    (Join-Path $repoRoot 'node_modules'),
    (Join-Path $repoRoot 'server\node_modules'),
    (Join-Path $repoRoot '.vscode')
  )
  Hide-Output { robocopy $repoRoot $destDir /E /NFL /NDL /NJH /NJS /XD $excludeDirs }
  
  # Overlay AE-specific files (host-detection + manifest)
  $aeExtDir = Join-Path $repoRoot 'extensions\ae-extension'
  Hide-Output { 
    if (Test-Path (Join-Path $aeExtDir 'ui')) { New-Item -ItemType Directory -Path (Join-Path $destDir 'ui') -Force }
    if (Test-Path (Join-Path $aeExtDir 'ui\host-detection.js')) { Copy-Item (Join-Path $aeExtDir 'ui\host-detection.js') (Join-Path $destDir 'ui\host-detection.js') -Force }
    New-Item -ItemType Directory -Path (Join-Path $destDir 'CSXS') -Force
    if (Test-Path (Join-Path $aeExtDir 'CSXS\manifest.xml')) { 
      Copy-Item (Join-Path $aeExtDir 'CSXS\manifest.xml') (Join-Path $destDir 'CSXS\manifest.xml') -Force
    }
  }
  
  # Unblock downloaded files (Mark-of-the-Web)
  Hide-Output { Get-ChildItem -Path $destDir -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue }
  
  # Install server dependencies
  $serverDir = Join-Path $destDir 'server'
  if (Test-Path $serverDir) {
    $currentStep++
    Show-Progress $script:currentStep $totalSteps "Installing server dependencies..."
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
            # Test npm first to avoid "pm" error
            try {
              $testResult = & npm --version 2>$null
              if ($LASTEXITCODE -ne 0 -or -not $testResult) {
                continue
              }
            } catch {
              continue
            }
            
            # Try standard install first (silent)
            try {
              & npm install --omit=dev --silent 2>$null
              if ($LASTEXITCODE -eq 0) {
                $npmInstalled = $true
                break
              }
            } catch {
              # Continue to next attempt
            }
            
            # If that fails, try with flags for Windows compatibility
            try {
              & npm install --no-optional --ignore-scripts --silent 2>$null
              if ($LASTEXITCODE -eq 0) {
                # Detect Windows architecture and set appropriate flags
                $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
                & npm rebuild sharp --platform=win32 --arch=$arch --libc= --target=7 --runtime=napi 2>$null
                $npmInstalled = $true
                break
              }
            } catch {
              # Continue to next path
            }
          } else {
            if (Test-Path $npmPath) {
              # Test npm first to avoid "pm" error
              try {
                $testResult = & $npmPath --version 2>$null
                if ($LASTEXITCODE -ne 0 -or -not $testResult) {
                  continue
                }
              } catch {
                continue
              }
              
              # Try standard install first (silent)
              try {
                & $npmPath install --omit=dev --silent 2>$null
                if ($LASTEXITCODE -eq 0) {
                  $npmInstalled = $true
                  break
                }
              } catch {
                # Continue to next attempt
              }
              
              # If that fails, try with flags for Windows compatibility
              try {
                & $npmPath install --no-optional --ignore-scripts --silent 2>$null
                if ($LASTEXITCODE -eq 0) {
                  # Detect Windows architecture and set appropriate flags
                  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
                  & $npmPath rebuild sharp --platform=win32 --arch=$arch --libc= --target=7 --runtime=napi 2>$null
                  $npmInstalled = $true
                  break
                }
              } catch {
                # Continue to next path
              }
            }
          }
        } catch {
          # Continue to next path
        }
      }
      
      if (-not $npmInstalled) {
        Write-Host ""
        Write-Host "❌ Failed to install server dependencies" -ForegroundColor Red
        Write-Host "Please ensure Node.js and npm are properly installed" -ForegroundColor Yellow
        Write-Host "This may be due to network issues or npm registry problems" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Common fixes:" -ForegroundColor Cyan
        Write-Host "• Reinstall Node.js from https://nodejs.org" -ForegroundColor Yellow
        Write-Host "• Run: npm cache clean --force" -ForegroundColor Yellow
        Write-Host "• Check if antivirus is blocking npm" -ForegroundColor Yellow
        Write-Host "• Try running PowerShell as Administrator" -ForegroundColor Yellow
        Write-Host "• Check Windows PATH includes Node.js directory" -ForegroundColor Yellow
      } else {
        Write-Host "✅ Server dependencies installed successfully" -ForegroundColor Green
      }
    } finally {
      Pop-Location
    }
  }
}

function Install-Premiere {
  $extId = 'com.sync.extension.ppro.panel'
  $destDir = Join-Path $destBase $extId
  
  $currentStep++
  Show-Progress $script:currentStep $totalSteps "Preparing Premiere Pro extension..."
  
  # Remove existing installation
  if (Test-Path $destDir) {
    Hide-Output { Remove-Item -Path $destDir -Recurse -Force }
  }
  
  # Create directory structure
  Hide-Output { New-Item -ItemType Directory -Path $destDir -Force }
  
  # Copy core project files (mirror macOS rsync behavior)
  $currentStep++
  Show-Progress $script:currentStep $totalSteps "Copying extension files..."
  # Exclude: .git, dist, extensions, scripts, CSXS, node_modules, .DS_Store, *.log, .env, .vscode
  $excludeDirs = @(
    (Join-Path $repoRoot '.git'),
    (Join-Path $repoRoot 'dist'),
    (Join-Path $repoRoot 'extensions'),
    (Join-Path $repoRoot 'scripts'),
    (Join-Path $repoRoot 'CSXS'),
    (Join-Path $repoRoot 'node_modules'),
    (Join-Path $repoRoot 'server\node_modules'),
    (Join-Path $repoRoot '.vscode')
  )
  Hide-Output { robocopy $repoRoot $destDir /E /NFL /NDL /NJH /NJS /XD $excludeDirs }
  
  # Overlay Premiere-specific files (host-detection + manifest)
  $pproExtDir = Join-Path $repoRoot 'extensions\premiere-extension'
  Hide-Output { 
    if (Test-Path (Join-Path $pproExtDir 'ui')) { New-Item -ItemType Directory -Path (Join-Path $destDir 'ui') -Force }
    if (Test-Path (Join-Path $pproExtDir 'ui\host-detection.js')) { Copy-Item (Join-Path $pproExtDir 'ui\host-detection.js') (Join-Path $destDir 'ui\host-detection.js') -Force }
    New-Item -ItemType Directory -Path (Join-Path $destDir 'CSXS') -Force
    if (Test-Path (Join-Path $pproExtDir 'CSXS\manifest.xml')) { 
      Copy-Item (Join-Path $pproExtDir 'CSXS\manifest.xml') (Join-Path $destDir 'CSXS\manifest.xml') -Force
    }
  }
  
  # Copy EPR files for Premiere
  if (Test-Path (Join-Path $pproExtDir 'epr')) {
    Hide-Output { Copy-Item (Join-Path $pproExtDir 'epr') (Join-Path $destDir 'epr') -Recurse -Force }
  }
  
  # Unblock downloaded files (Mark-of-the-Web)
  Hide-Output { Get-ChildItem -Path $destDir -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue }
  
  # Install server dependencies
  $serverDir = Join-Path $destDir 'server'
  if (Test-Path $serverDir) {
    $currentStep++
    Show-Progress $script:currentStep $totalSteps "Installing server dependencies..."
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
            # Test npm first to avoid "pm" error
            try {
              $testResult = & npm --version 2>$null
              if ($LASTEXITCODE -ne 0 -or -not $testResult) {
                continue
              }
            } catch {
              continue
            }
            
            # Try standard install first (silent)
            try {
              & npm install --omit=dev --silent 2>$null
              if ($LASTEXITCODE -eq 0) {
                $npmInstalled = $true
                break
              }
            } catch {
              # Continue to next attempt
            }
            
            # If that fails, try with flags for Windows compatibility
            try {
              & npm install --no-optional --ignore-scripts --silent 2>$null
              if ($LASTEXITCODE -eq 0) {
                # Detect Windows architecture and set appropriate flags
                $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
                & npm rebuild sharp --platform=win32 --arch=$arch --libc= --target=7 --runtime=napi 2>$null
                $npmInstalled = $true
                break
              }
            } catch {
              # Continue to next path
            }
          } else {
            if (Test-Path $npmPath) {
              # Test npm first to avoid "pm" error
              try {
                $testResult = & $npmPath --version 2>$null
                if ($LASTEXITCODE -ne 0 -or -not $testResult) {
                  continue
                }
              } catch {
                continue
              }
              
              # Try standard install first (silent)
              try {
                & $npmPath install --omit=dev --silent 2>$null
                if ($LASTEXITCODE -eq 0) {
                  $npmInstalled = $true
                  break
                }
              } catch {
                # Continue to next attempt
              }
              
              # If that fails, try with flags for Windows compatibility
              try {
                & $npmPath install --no-optional --ignore-scripts --silent 2>$null
                if ($LASTEXITCODE -eq 0) {
                  # Detect Windows architecture and set appropriate flags
                  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
                  & $npmPath rebuild sharp --platform=win32 --arch=$arch --libc= --target=7 --runtime=napi 2>$null
                  $npmInstalled = $true
                  break
                }
              } catch {
                # Continue to next path
              }
            }
          }
        } catch {
          # Continue to next path
        }
      }
      
      if (-not $npmInstalled) {
        Write-Host ""
        Write-Host "❌ Failed to install server dependencies" -ForegroundColor Red
        Write-Host "Please ensure Node.js and npm are properly installed" -ForegroundColor Yellow
        Write-Host "This may be due to network issues or npm registry problems" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Common fixes:" -ForegroundColor Cyan
        Write-Host "• Reinstall Node.js from https://nodejs.org" -ForegroundColor Yellow
        Write-Host "• Run: npm cache clean --force" -ForegroundColor Yellow
        Write-Host "• Check if antivirus is blocking npm" -ForegroundColor Yellow
        Write-Host "• Try running PowerShell as Administrator" -ForegroundColor Yellow
        Write-Host "• Check Windows PATH includes Node.js directory" -ForegroundColor Yellow
      } else {
        Write-Host "✅ Server dependencies installed successfully" -ForegroundColor Green
      }
    } finally {
      Pop-Location
    }
  }
}

$currentStep++
Show-Progress $script:currentStep $totalSteps "Enabling debug mode..."
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
    $aeManifest = Join-Path $aeDir 'CSXS\manifest.xml'
    if (Test-Path $aeDir) {
      Write-Host "✅ AE extension installed: $aeDir" -ForegroundColor Green
      if (Test-Path $aeManifest) {
        Write-Host "✅ AE manifest.xml found" -ForegroundColor Green
      } else {
        Write-Host "❌ AE manifest.xml missing" -ForegroundColor Red
        $installSuccess = $false
      }
    } else {
      Write-Host "❌ AE extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
  }
  'premiere' { 
    $pproDir = Join-Path $destBase 'com.sync.extension.ppro.panel'
    $pproManifest = Join-Path $pproDir 'CSXS\manifest.xml'
    if (Test-Path $pproDir) {
      Write-Host "✅ Premiere extension installed: $pproDir" -ForegroundColor Green
      if (Test-Path $pproManifest) {
        Write-Host "✅ Premiere manifest.xml found" -ForegroundColor Green
      } else {
        Write-Host "❌ Premiere manifest.xml missing" -ForegroundColor Red
        $installSuccess = $false
      }
    } else {
      Write-Host "❌ Premiere extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
  }
  'both' { 
    $aeDir = Join-Path $destBase 'com.sync.extension.ae.panel'
    $pproDir = Join-Path $destBase 'com.sync.extension.ppro.panel'
    $aeManifest = Join-Path $aeDir 'CSXS\manifest.xml'
    $pproManifest = Join-Path $pproDir 'CSXS\manifest.xml'
    
    if (Test-Path $aeDir) {
      Write-Host "✅ AE extension installed: $aeDir" -ForegroundColor Green
      if (Test-Path $aeManifest) {
        Write-Host "✅ AE manifest.xml found" -ForegroundColor Green
      } else {
        Write-Host "❌ AE manifest.xml missing" -ForegroundColor Red
        $installSuccess = $false
      }
    } else {
      Write-Host "❌ AE extension not found" -ForegroundColor Red
      $installSuccess = $false
    }
    
    if (Test-Path $pproDir) {
      Write-Host "✅ Premiere extension installed: $pproDir" -ForegroundColor Green
      if (Test-Path $pproManifest) {
        Write-Host "✅ Premiere manifest.xml found" -ForegroundColor Green
      } else {
        Write-Host "❌ Premiere manifest.xml missing" -ForegroundColor Red
        $installSuccess = $false
      }
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
  Write-Host "• Check installation location: %APPDATA%\\Adobe\\CEP\\extensions\\" -ForegroundColor Yellow
} else {
  Write-Host "❌ Installation failed!" -ForegroundColor Red
  Write-Host "Please run this script as Administrator and try again" -ForegroundColor Yellow
  Write-Host "Check the error messages above for specific issues" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Tip: Re-run with parameters:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -App ae|premiere|both"
