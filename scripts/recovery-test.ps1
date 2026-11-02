
param(
    [Parameter(Mandatory = $true)][string]$Kubectl,
    [Parameter(Mandatory = $true)][string]$Workspace,
    [string]$Namespace = "default"
)

$ErrorActionPreference = "Stop"

$reportPath = Join-Path $Workspace "recovery-report.txt"
$frontendPort = 18083
$backendPort = 13001
$processes = @()

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("WeatherWatch Disaster Recovery Report - $(Get-Date -Format s)")
$lines.Add("Namespace: $Namespace")

function Invoke-Kubectl {
    param([string[]]$Arguments)

    $result = & $Kubectl @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "kubectl $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }

    return $result
}

function Stop-PortForwards {
    foreach ($proc in $script:processes) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }

    $script:processes = @()
}

function Start-PortForward {
    param(
        [string]$Service,
        [int]$LocalPort,
        [int]$RemotePort
    )

    $outFile = Join-Path $Workspace "port-forward-$LocalPort-out.txt"
    $errFile = Join-Path $Workspace "port-forward-$LocalPort-err.txt"

    $proc = Start-Process -FilePath $Kubectl `
        -ArgumentList @(
            "port-forward",
            "svc/$Service",
            "$LocalPort`:$RemotePort",
            "-n",
            $Namespace,
            "--address=127.0.0.1"
        ) `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outFile `
        -RedirectStandardError $errFile

    $script:processes += $proc

    return $proc
}

function Wait-Http {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $code = & curl.exe -sS -o NUL -w "%{http_code}" `
            --max-time 3 $Url 2>$null

        if ($LASTEXITCODE -eq 0 -and "$code" -eq "200") {
            return
        }

        Start-Sleep -Seconds 2
    }

    throw "HTTP health check failed for $Url after $TimeoutSeconds seconds."
}

function Start-AppPortForwards {
    Stop-PortForwards

    $null = Start-PortForward "weatherwatch-frontend" $frontendPort 80
    $null = Start-PortForward "weatherwatch-backend" $backendPort 3001

    Wait-Http "http://127.0.0.1:$frontendPort/health"
    Wait-Http "http://127.0.0.1:$backendPort/api/health"
}

function Get-ReadyPods {
    param([string]$Label)

    $json = Invoke-Kubectl @(
        "get", "pods",
        "-n", $Namespace,
        "-l", $Label,
        "-o", "json"
    )

    $data = $json | ConvertFrom-Json

    return @(
        $data.items | Where-Object {
            -not $_.metadata.deletionTimestamp -and
            @(
                $_.status.conditions | Where-Object {
                    $_.type -eq "Ready" -and $_.status -eq "True"
                }
            ).Count -gt 0
        }
    )
}

function Wait-Replacement {
    param(
        [string]$Label,
        [int]$ExpectedCount,
        [string[]]$OldNames,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $ready = @(Get-ReadyPods $Label)

        $oldReady = @(
            $ready | Where-Object {
                $OldNames -contains $_.metadata.name
            }
        )

        if ($ready.Count -eq $ExpectedCount -and $oldReady.Count -eq 0) {
            return $ready
        }

        Start-Sleep -Seconds 2
    }

    throw "Timed out waiting for $ExpectedCount replacement pod(s) with selector $Label."
}

function Test-DeploymentRecovery {
    param(
        [string]$Name,
        [string]$Label,
        [int]$ReplicaCount,
        [string]$HealthUrl
    )

    $ready = @(Get-ReadyPods $Label)

    if ($ready.Count -ne $ReplicaCount) {
        throw "$Name expected $ReplicaCount ready pods; found $($ready.Count)."
    }

    $victim = $ready[0].metadata.name
    $timer = [System.Diagnostics.Stopwatch]::StartNew()

    Invoke-Kubectl @(
        "delete", "pod", $victim,
        "-n", $Namespace,
        "--wait=false"
    ) | Out-Null

    $null = Wait-Replacement $Label $ReplicaCount @($victim)

    $timer.Stop()

    Start-AppPortForwards
    Wait-Http $HealthUrl

    $elapsed = [math]::Round($timer.Elapsed.TotalSeconds, 2)

    $lines.Add(
        "$Name pod recovery: PASS; recovery time: $elapsed seconds; ready pods: $ReplicaCount/$ReplicaCount"
    )

    Write-Output "$Name recovery completed in $elapsed seconds."
}

function Test-DatabaseRecovery {
    Write-Output "Starting PostgreSQL recovery and persistence test."

    $runId = if ($env:BUILD_NUMBER) {
        $env:BUILD_NUMBER
    }
    else {
        Get-Date -Format "yyyyMMddHHmmss"
    }

    $marker = "WeatherWatch-DR-$runId-$([guid]::NewGuid().ToString('N').Substring(0,8))"

    Write-Output "Creating test favorite: $marker"

    # Save the favorite before the database failure.
    $body = ConvertTo-Json @{ city = $marker }

    $saved = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:$backendPort/api/favorites" `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 15

    if (-not $saved.favorite -or $saved.favorite.city -ne $marker) {
        throw "Could not save the database persistence test favorite."
    }

    # Confirm that it can be retrieved before restart.
    $before = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$backendPort/api/favorites" `
        -TimeoutSec 15

    $beforeMatch = @(
        $before.favorites | Where-Object { $_.city -eq $marker }
    )

    if ($beforeMatch.Count -eq 0) {
        throw "Favorite could not be retrieved before PostgreSQL restart."
    }

    Write-Output "Favorite saved and retrieved before restart."

    # Find PostgreSQL pod.
    $databasePods = @(Get-ReadyPods "app=weatherwatch-postgres")

    if ($databasePods.Count -ne 1) {
        throw "Expected one ready PostgreSQL pod; found $($databasePods.Count)."
    }

    $victim = $databasePods[0].metadata.name

    Write-Output "Deleting PostgreSQL pod: $victim"

    $timer = [System.Diagnostics.Stopwatch]::StartNew()

    Invoke-Kubectl @(
        "delete", "pod", $victim,
        "-n", $Namespace,
        "--wait=false"
    ) | Out-Null

    # Wait for replacement PostgreSQL pod.
    $replacement = Wait-Replacement `
        "app=weatherwatch-postgres" `
        1 `
        @($victim) `
        180

    Write-Output "Replacement PostgreSQL pod: $($replacement[0].metadata.name)"

    # IMPORTANT: Recreate backend port-forward after PostgreSQL recovery.
    # The previous port-forward may have exited or become unusable.
    Stop-PortForwards

    $null = Start-PortForward "weatherwatch-backend" $backendPort 3001

    Write-Output "Waiting for backend to become reachable..."

    Wait-Http "http://127.0.0.1:$backendPort/api/health" 90

    Write-Output "Backend port-forward reconnected successfully."

    # Verify database connectivity and favorite persistence.
    $deadline = (Get-Date).AddSeconds(180)
    $persisted = $false
    $lastError = "No successful API verification yet."
    $lastHealth = $null
    $lastFavorites = @()

    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod `
                -Uri "http://127.0.0.1:$backendPort/api/health" `
                -TimeoutSec 5

            $lastHealth = $health

            if ($health.status -ne "ok" -or
                $health.database -ne "connected") {

                $lastError = "Backend has not confirmed database connectivity."
                Start-Sleep -Seconds 3
                continue
            }

            $favorites = Invoke-RestMethod `
                -Uri "http://127.0.0.1:$backendPort/api/favorites" `
                -TimeoutSec 5

            $lastFavorites = @($favorites.favorites)

            $matching = @(
                $lastFavorites | Where-Object {
                    $_.city -eq $marker
                }
            )

            if ($matching.Count -gt 0) {
                $persisted = $true
                Write-Output "Database connection recovered."
                Write-Output "Favorite persisted after PostgreSQL restart."
                break
            }

            $lastError = "Database connected, but the test favorite was missing."
        }
        catch {
            $lastError = $_.Exception.Message
            Write-Output "Database recovery retry: $lastError"
        }

        Start-Sleep -Seconds 3
    }

    $timer.Stop()
    $elapsed = [math]::Round($timer.Elapsed.TotalSeconds, 2)

    if (-not $persisted) {
        $healthJson = $lastHealth | ConvertTo-Json -Compress
        $favoritesJson = $lastFavorites | ConvertTo-Json -Compress

        throw @"
PostgreSQL recovery verification failed after $elapsed seconds.
Last error: $lastError
Expected favorite: $marker
Last health: $healthJson
Retrieved favorites: $favoritesJson
"@
    }

    $lines.Add(
        "PostgreSQL pod restart and PVC persistence: PASS; recovery time: $elapsed seconds; test favorite persisted"
    )

    Write-Output "PostgreSQL recovery completed in $elapsed seconds."
}

try {
    Write-Output "Starting WeatherWatch disaster recovery tests."

    # Initial application checks.
    Start-AppPortForwards

    Wait-Http "http://127.0.0.1:$frontendPort/health"
    Wait-Http "http://127.0.0.1:$frontendPort/api/health"
    Wait-Http "http://127.0.0.1:$backendPort/api/health"

    $lines.Add("Frontend and backend initial health checks: PASS")

    # Test frontend recovery.
    Test-DeploymentRecovery `
        "Frontend" `
        "app=weatherwatch-frontend" `
        2 `
        "http://127.0.0.1:$frontendPort/health"

    # Test backend recovery.
    Test-DeploymentRecovery `
        "Backend" `
        "app=weatherwatch-backend" `
        2 `
        "http://127.0.0.1:$backendPort/api/health"

    Wait-Http "http://127.0.0.1:$frontendPort/api/health"

    # Test PostgreSQL recovery and PVC persistence.
    Test-DatabaseRecovery

    # Final application health checks.
    Start-AppPortForwards

    Wait-Http "http://127.0.0.1:$frontendPort/health"
    Wait-Http "http://127.0.0.1:$backendPort/api/health"

    $lines.Add("Frontend and backend health after database recovery: PASS")
    $lines.Add("RECOVERY TESTS: PASS")

    Write-Output "All WeatherWatch disaster recovery tests passed."
}
catch {
    $lines.Add("RECOVERY TESTS: FAIL - " + $_.Exception.Message)
    Write-Output "RECOVERY TESTS FAILED: $($_.Exception.Message)"
    throw
}
finally {
    Stop-PortForwards

    Set-Content -Path $reportPath -Value $lines -Encoding UTF8

    Write-Output "Recovery report saved to: $reportPath"
}
