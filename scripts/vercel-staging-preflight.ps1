param(
  [switch]$SkipBuild,
  [switch]$SkipVercelAuth
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$failures = New-Object System.Collections.Generic.List[string]

function Write-Check($Name, $Ok, $Detail) {
  $status = if ($Ok) { 'OK' } else { 'FAIL' }
  $color = if ($Ok) { 'Green' } else { 'Red' }
  Write-Host "[$status] $Name - $Detail" -ForegroundColor $color
  if (-not $Ok) { $script:failures.Add($Name) | Out-Null }
}

function Test-VercelProjectLink {
  $projectPath = Join-Path (Get-Location) '.vercel/project.json'
  $repoPath = Join-Path (Get-Location) '.vercel/repo.json'

  if (Test-Path $projectPath) {
    try {
      $project = Get-Content -Raw $projectPath | ConvertFrom-Json
      return @{
        Ok = ($null -ne $project.projectId -and $null -ne $project.orgId)
        Detail = 'project.json found with projectId and orgId.'
      }
    } catch {
      return @{ Ok = $false; Detail = "project.json is invalid JSON: $($_.Exception.Message)" }
    }
  }

  if (Test-Path $repoPath) {
    try {
      $repo = Get-Content -Raw $repoPath | ConvertFrom-Json
      $rootProject = @($repo.projects) | Where-Object { $_.directory -eq '.' -and $_.id -and $_.orgId } | Select-Object -First 1
      return @{
        Ok = ($null -ne $rootProject)
        Detail = if ($rootProject) { "repo.json found; linked project '$($rootProject.name)' at directory '.'." } else { 'repo.json found, but no linked project for directory ''.''.' }
      }
    } catch {
      return @{ Ok = $false; Detail = "repo.json is invalid JSON: $($_.Exception.Message)" }
    }
  }

  return @{ Ok = $false; Detail = 'Repository is not linked. Run `npx vercel link` with the correct account/team.' }
}

$link = Test-VercelProjectLink
Write-Check 'Vercel project link' $link.Ok $link.Detail

if (Test-Path 'vercel.json') {
  try {
    $config = Get-Content -Raw 'vercel.json' | ConvertFrom-Json
    Write-Check 'vercel.json' ($config.buildCommand -eq 'npm run build' -and $config.outputDirectory -eq '.') 'Static app config matches local build.'
  } catch {
    Write-Check 'vercel.json' $false "vercel.json is invalid JSON: $($_.Exception.Message)"
  }
} else {
  Write-Check 'vercel.json' $false 'Missing Vercel config.'
}

if (-not $SkipVercelAuth) {
  $whoamiOutput = cmd /c "npx --yes vercel whoami 2>&1"
  $whoamiExit = $LASTEXITCODE
  $whoamiText = $whoamiOutput -join "`n"
  $loggedIn = $whoamiExit -eq 0 -and ($whoamiText -notmatch 'Logged out')
  $whoamiIdentity = @($whoamiOutput) | Where-Object { $_ -and $_ -notmatch '^Vercel CLI' -and $_ -notmatch '^>' } | Select-Object -Last 1
  Write-Check 'Vercel auth' $loggedIn ($(if ($loggedIn) { "Logged in as $whoamiIdentity." } else { 'CLI has no active session. Run `npx vercel login` before preview deploy.' }))
}

if (-not $SkipBuild) {
  & npm run build
  Write-Check 'npm run build' ($LASTEXITCODE -eq 0) 'Local build completed.'
}

if ($failures.Count -gt 0) {
  Write-Host "`nStaging preflight incomplete: $($failures -join ', ')" -ForegroundColor Yellow
  exit 1
}

Write-Host "`nStaging preflight OK. You can create a preview with npx vercel deploy. Production still requires separate explicit approval." -ForegroundColor Green
