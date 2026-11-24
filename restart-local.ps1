$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$web = Join-Path $root "web"
$standaloneServer = Join-Path $web ".next\standalone\server.js"
$bridgeStart = Join-Path $root "canvas-bridge\bridge-start.mjs"
$bridgeDataHome = Join-Path $root "data\storages\canvas-bridge"
$processes = Get-CimInstance Win32_Process

foreach ($port in @(3000, 18080)) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($processId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $owner = $processes | Where-Object ProcessId -eq $processId
        if (-not $owner) { continue }

        if ($port -eq 3000) {
            $launcher = $owner
            for ($depth = 0; $depth -lt 4 -and $launcher; $depth++) {
                if ($launcher.CommandLine -like "*$standaloneServer*" -or $launcher.CommandLine -like "*$web\node_modules\next\dist\bin\next*") { break }
                $launcher = $processes | Where-Object ProcessId -eq $launcher.ParentProcessId
            }
            if (-not $launcher -or ($launcher.CommandLine -notlike "*$standaloneServer*" -and $launcher.CommandLine -notlike "*$web\node_modules\next\dist\bin\next*")) {
                throw "Port $port is not owned by this project's Next.js process. No process was stopped."
            }
        } else {
            $launcher = $processes | Where-Object ProcessId -eq $owner.ParentProcessId
            $ownerName = Split-Path $owner.ExecutablePath -Leaf
            $launcherName = Split-Path $launcher.ExecutablePath -Leaf
            if ($ownerName -ne 'infinite-canvas.exe') { throw "Port $port is not owned by this project's Go process. No process was stopped." }
            if ($launcherName -ne 'go.exe') { throw "Port $port is not owned by this project's Go process. No process was stopped." }
            if (-not $launcher.CommandLine.Trim().EndsWith('run .')) { throw "Port $port is not owned by this project's Go process. No process was stopped." }
        }

        Stop-Process -Id $owner.ProcessId
        if ($launcher.ProcessId -ne $owner.ProcessId) {
            Stop-Process -Id $launcher.ProcessId
        }
    }
}

foreach ($bridgeProcess in ($processes | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($bridgeStart, [StringComparison]::OrdinalIgnoreCase) -ge 0
})) {
    Stop-Process -Id $bridgeProcess.ProcessId
}

$goCommand = Get-Command go.exe -ErrorAction SilentlyContinue
if ($goCommand) {
    $goExe = $goCommand.Source
} elseif ($env:GOROOT -and (Test-Path (Join-Path $env:GOROOT "bin\go.exe"))) {
    $goExe = Join-Path $env:GOROOT "bin\go.exe"
} elseif (Test-Path "D:\software\Go\go\bin\go.exe") {
    $goExe = "D:\software\Go\go\bin\go.exe"
} else {
    throw "Go was not found. Add go.exe to PATH or set GOROOT."
}
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $env:TEMP "infinite-canvas-logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$backendOut = Join-Path $logDir "backend.out.log"
$backendErr = Join-Path $logDir "backend.err.log"
$frontendBuildOut = Join-Path $logDir "frontend-build.out.log"
$frontendBuildErr = Join-Path $logDir "frontend-build.err.log"
$frontendOut = Join-Path $logDir "frontend.out.log"
$frontendErr = Join-Path $logDir "frontend.err.log"
$bridgeOut = Join-Path $logDir "bridge.out.log"
$bridgeErr = Join-Path $logDir "bridge.err.log"

$migrationMarker = Join-Path $bridgeDataHome ".legacy-dsh-migration-complete"
if (-not (Test-Path -LiteralPath $migrationMarker)) {
    New-Item -ItemType Directory -Path $bridgeDataHome -Force | Out-Null
    $legacyBridgeHome = if ($env:DSH_HOME) { Join-Path $env:DSH_HOME "storages\canvas-bridge" } else { Join-Path $env:USERPROFILE ".dsh\storages\canvas-bridge" }
    $legacySettings = Join-Path $legacyBridgeHome "settings.json"
    $projectSettings = Join-Path $bridgeDataHome "settings.json"
    if (-not (Test-Path -LiteralPath $projectSettings) -and (Test-Path -LiteralPath $legacySettings)) {
        Copy-Item -LiteralPath $legacySettings -Destination $projectSettings
    }
    $legacyMedia = Join-Path $legacyBridgeHome "media"
    $projectMedia = Join-Path $bridgeDataHome "media"
    if (-not (Test-Path -LiteralPath $projectMedia) -and (Test-Path -LiteralPath $legacyMedia -PathType Container)) {
        New-Item -ItemType Directory -Path $projectMedia -Force | Out-Null
        Get-ChildItem -LiteralPath $legacyMedia -Force | Copy-Item -Destination $projectMedia -Recurse -Force
    }
    Set-Content -LiteralPath $migrationMarker -Value "complete" -Encoding utf8
}

$env:CANVAS_BRIDGE_HOME = $bridgeDataHome
Start-Process -FilePath $nodeExe -ArgumentList "`"$bridgeStart`"" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr | Out-Null

$bridgeReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $bridgeProcess = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($bridgeStart, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
    if ($bridgeProcess) {
        try {
            $settings = Get-Content -Raw -LiteralPath (Join-Path $bridgeDataHome "settings.json") | ConvertFrom-Json
            $bridgeUrl = "http://127.0.0.1:$($settings.port)"
            $bootstrap = Invoke-RestMethod -Uri "$bridgeUrl/bootstrap" -Headers @{ Origin = "http://localhost:3000" } -TimeoutSec 2
            if ($bootstrap.standalone -eq $true -and $bootstrap.url -eq $bridgeUrl -and $bootstrap.token -eq $settings.token) { $bridgeReady = $true; break }
        } catch {}
    }
    Start-Sleep -Seconds 1
}
if (-not $bridgeReady) { throw "Canvas bridge startup timed out. Logs: $logDir" }
Write-Host "Canvas bridge ready: http://127.0.0.1:$($settings.port)"

$buildCommand = "/d /c `"$npmCmd`" run build"
$build = Start-Process -FilePath $env:ComSpec -ArgumentList $buildCommand -WorkingDirectory $web -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $frontendBuildOut -RedirectStandardError $frontendBuildErr
if ($build.ExitCode -ne 0) {
    throw "Frontend production build failed with exit code $($build.ExitCode). Logs: $logDir"
}

$staticSource = Join-Path $web ".next\static"
$publicSource = Join-Path $web "public"
if (-not (Test-Path -LiteralPath $standaloneServer)) { throw "Standalone server was not generated. Logs: $logDir" }
if (-not (Test-Path -LiteralPath $staticSource)) { throw "Next.js static assets were not generated. Logs: $logDir" }

$standaloneStatic = Join-Path (Split-Path $standaloneServer) ".next\static"
$standalonePublic = Join-Path (Split-Path $standaloneServer) "public"
New-Item -ItemType Directory -Path $standaloneStatic -Force | Out-Null
New-Item -ItemType Directory -Path $standalonePublic -Force | Out-Null
Get-ChildItem -LiteralPath $staticSource -Force | Copy-Item -Destination $standaloneStatic -Recurse -Force
Get-ChildItem -LiteralPath $publicSource -Force | Copy-Item -Destination $standalonePublic -Recurse -Force

Start-Sleep -Seconds 1
Start-Process -FilePath $goExe -ArgumentList @("run", ".") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr | Out-Null
$env:NODE_ENV = "production"
$env:PORT = "3000"
$env:HOSTNAME = "0.0.0.0"
Start-Process -FilePath $nodeExe -ArgumentList "`"$standaloneServer`"" -WorkingDirectory $web -WindowStyle Hidden -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr | Out-Null

$checks = @(
    [pscustomobject]@{ Name = "Backend"; Url = "http://127.0.0.1:18080/api/health" }
    [pscustomobject]@{ Name = "Frontend"; Url = "http://127.0.0.1:3000" }
)
foreach ($service in $checks) {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $service.Url -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "$($service.Name) startup timed out: $($service.Url). Logs: $logDir" }
    Write-Host "$($service.Name) ready: $($service.Url)"
}
