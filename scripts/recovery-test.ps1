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

function Start-PortForward {
    param([string]$Service, [int]$LocalPort, [int]$RemotePort)
    $outFile = Join-Path $Workspace "port-forward-$LocalPort-out.txt"
    $errFile = Join-Path $Workspace "port-forward-$LocalPort-err.txt"
    $proc = Start-Process -FilePath $Kubectl `
        -ArgumentList @("port-forward", "svc/$Service", "$LocalPort`:$RemotePort",
            "-n", $Namespace, "--address=127.0.0.1") `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $outFile `
        -RedirectStandardError $errFile
    $script:processes += $proc
    return $proc
}

function Restart-PortForwards {
    foreach ($proc in $processes) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    $script:processes = @()
    $null = Start-PortForward "weatherwatch-frontend" $frontendPort 80
    $null = Start-PortForward "weatherwatch-backend" $backendPort 3001
    Wait-Http "http://127.0.0.1:$frontendPort/health"
    Wait-Http "http://127.0.0.1:$backendPort/api/health"
}

function Wait-Http {
    param([string]$Url, [int]$TimeoutSeconds = 40)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $code = & curl.exe -sS -o NUL -w "%{http_code}" --max-time 3 $Url 2>$null
        if ($LASTEXITCODE -eq 0 -and "$code" -eq "200") { return }
        Start-Sleep -Seconds 2
    }
    throw "HTTP health check failed for $Url."
}

function Get-ReadyPods {
    param([string]$Label)
    $json = Invoke-Kubectl @("get", "pods", "-n", $Namespace, "-l", $Label, "-o", "json")
    $data = $json | ConvertFrom-Json
    return @($data.items | Where-Object {
        -not $_.metadata.deletionTimestamp -and
        @($_.status.conditions | Where-Object {
            $_.type -eq "Ready" -and $_.status -eq "True"
        }).Count -gt 0
    })
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
        $oldReady = @($ready | Where-Object { $OldNames -contains $_.metadata.name })
        if ($ready.Count -eq $ExpectedCount -and $oldReady.Count -eq 0) {
            return $ready
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for $ExpectedCount replacement pod(s) with selector $Label."
}

function Test-DeploymentRecovery {
    param([string]$Name, [string]$Label, [int]$ReplicaCount, [string]$HealthUrl)
    $ready = @(Get-ReadyPods $Label)
    if ($ready.Count -ne $ReplicaCount) {
        throw "$Name expected $ReplicaCount ready pods before failure test; found $($ready.Count)."
    }
    $victim = $ready[0].metadata.name
    $start = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-Kubectl @("delete", "pod", $victim, "-n", $Namespace, "--wait=false") | Out-Null
    $null = Wait-Replacement $Label $ReplicaCount @($victim)
    $start.Stop()
    Restart-PortForwards
    Wait-Http $HealthUrl
    $elapsed = [math]::Round($start.Elapsed.TotalSeconds, 2)
    $script:lines.Add("$Name pod recovery: PASS; recovery time: $elapsed seconds; ready pods: $ReplicaCount/$ReplicaCount")
    Write-Output "$Name recovery completed in $elapsed seconds."
}

try {
    $null = Start-PortForward "weatherwatch-frontend" $frontendPort 80
    $null = Start-PortForward "weatherwatch-backend" $backendPort 3001
    Wait-Http "http://127.0.0.1:$frontendPort/health"
    Wait-Http "http://127.0.0.1:$frontendPort/api/health"
    Wait-Http "http://127.0.0.1:$backendPort/api/health"
    $lines.Add("Frontend and backend initial health checks: PASS")

    Test-DeploymentRecovery "Frontend" "app=weatherwatch-frontend" 2 `
        "http://127.0.0.1:$frontendPort/health"
    Test-DeploymentRecovery "Backend" "app=weatherwatch-backend" 2 `
        "http://127.0.0.1:$backendPort/api/health"
    Wait-Http "http://127.0.0.1:$frontendPort/api/health"

    $marker = "WeatherWatch-DR-$env:BUILD_NUMBER"
    $body = ConvertTo-Json @{ city = $marker }
    $saved = Invoke-RestMethod -Method Post `
        -Uri "http://127.0.0.1:$backendPort/api/favorites" `
        -ContentType "application/json" -Body $body
    if ($saved.favorite.city -ne $marker) { throw "Could not seed database persistence check." }

    $databasePods = @(Get-ReadyPods "app=weatherwatch-postgres")
    if ($databasePods.Count -ne 1) { throw "Expected one ready PostgreSQL pod." }
    $victim = $databasePods[0].metadata.name
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-Kubectl @("delete", "pod", $victim, "-n", $Namespace, "--wait=false") | Out-Null
    $null = Wait-Replacement "app=weatherwatch-postgres" 1 @($victim)

    $deadline = (Get-Date).AddSeconds(180)
    $persisted = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/api/health" -TimeoutSec 4
            $favorites = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/api/favorites" -TimeoutSec 4
            if ($health.status -eq "ok" -and
                @($favorites.favorites | Where-Object { $_.city -eq $marker }).Count -gt 0) {
                $persisted = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 2
        }
        Start-Sleep -Seconds 2
    }
    $timer.Stop()
    $elapsed = [math]::Round($timer.Elapsed.TotalSeconds, 2)
    if (-not $persisted) { throw "Database pod restart did not recover or the favorite was not persisted." }
    $lines.Add("PostgreSQL pod restart and PVC persistence: PASS; recovery time: $elapsed seconds; test favorite persisted")
    Wait-Http "http://127.0.0.1:$frontendPort/health"
    $lines.Add("Frontend and backend health after database recovery: PASS")
} catch {
    $lines.Add("RECOVERY TESTS: FAIL - " + $_.Exception.Message)
    throw
} finally {
    foreach ($proc in $processes) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($lines.Count -eq 3) {
        $lines.Add("Recovery tests: NOT RUN")
    }
    Set-Content -Path $reportPath -Value $lines -Encoding UTF8
}
