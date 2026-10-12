
pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 15, unit: 'MINUTES')
    }

    environment {
        KUBECONFIG = "${WORKSPACE}\\jenkins-kubeconfig"
        KUBECTL = 'C:\\Users\\ishit\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\kubectl.exe'
        K8S_API = 'https://127.0.0.1:49706'
        NAMESPACE = 'default'
        DEPLOYMENT = 'dr-web'
        SERVICE = 'dr-web-service'
        REPORT = 'recovery-report.txt'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                powershell '''
                    Write-Output "Repository checked out."
                    Write-Output "Workspace: $env:WORKSPACE"
                '''
            }
        }

        stage('Configure Kubernetes Access') {
            steps {
                withCredentials([
                    string(credentialsId: 'k8s-jenkins-token', variable: 'K8S_TOKEN'),
                    file(credentialsId: 'k8s-cluster-ca', variable: 'K8S_CA_FILE')
                ]) {
                    powershell '''
                        $ErrorActionPreference = "Stop"
			Set-Content (Join-Path $env:WORKSPACE $env:REPORT) `
    			"Disaster Recovery Test Report - $(Get-Date -Format s)"

                        if (-not (Test-Path $env:KUBECTL)) {
                            throw "kubectl not found: $env:KUBECTL"
                        }

                        $connection = Test-NetConnection 127.0.0.1 `
                            -Port 49706 -WarningAction SilentlyContinue

                        if (-not $connection.TcpTestSucceeded) {
                            throw "Kubernetes API is unreachable at $env:K8S_API."
                        }

                        if (Test-Path $env:KUBECONFIG) {
                            Remove-Item $env:KUBECONFIG -Force
                        }

                        & $env:KUBECTL config set-cluster local-cluster `
                            "--server=$env:K8S_API" `
                            "--certificate-authority=$env:K8S_CA_FILE" `
                            --embed-certs=true
                        if ($LASTEXITCODE -ne 0) { throw "Cluster configuration failed." }

                        & $env:KUBECTL config set-credentials jenkins-dr `
                            "--token=$env:K8S_TOKEN"
                        if ($LASTEXITCODE -ne 0) { throw "Credential configuration failed." }

                        & $env:KUBECTL config set-context jenkins-context `
                            --cluster=local-cluster `
                            --user=jenkins-dr `
                            "--namespace=$env:NAMESPACE"
                        if ($LASTEXITCODE -ne 0) { throw "Context configuration failed." }

                        & $env:KUBECTL config use-context jenkins-context
                        if ($LASTEXITCODE -ne 0) { throw "Context selection failed." }

                        & $env:KUBECTL get deployments -n $env:NAMESPACE
                        if ($LASTEXITCODE -ne 0) { throw "Kubernetes access failed." }

                        Write-Output "Kubernetes access configured."
                    '''
                }
            }
        }

        stage('Deploy Application') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $manifest = Join-Path $env:WORKSPACE "k8s\\app.yaml"

                    if (-not (Test-Path $manifest)) {
                        throw "Manifest not found: $manifest"
                    }

                    & $env:KUBECTL apply -f $manifest -n $env:NAMESPACE
                    if ($LASTEXITCODE -ne 0) { throw "Deployment apply failed." }

                    & $env:KUBECTL rollout status `
                        "deployment/$env:DEPLOYMENT" `
                        -n $env:NAMESPACE --timeout=120s
                    if ($LASTEXITCODE -ne 0) { throw "Deployment rollout failed." }

                    Write-Output "Application deployment verified."
                '''
            }
        }

        stage('HTTP Health Check - Deployment') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $port = 18083
                    $base = Join-Path $env:WORKSPACE "http-check"
                    $outFile = "$base-out.txt"
                    $errFile = "$base-err.txt"
                    $proc = $null

                    try {
                        if (Get-NetTCPConnection -LocalPort $port -State Listen `
                            -ErrorAction SilentlyContinue) {
                            throw "Local port $port is already occupied."
                        }

                        $proc = Start-Process -FilePath $env:KUBECTL `
                            -ArgumentList @(
                                "port-forward",
                                "svc/$env:SERVICE",
                                "$port`:80",
                                "-n", $env:NAMESPACE,
                                "--address=127.0.0.1"
                            ) -PassThru -WindowStyle Hidden `
                            -RedirectStandardOutput $outFile `
                            -RedirectStandardError $errFile

                        $healthy = $false
                        $deadline = (Get-Date).AddSeconds(20)

                        while ((Get-Date) -lt $deadline) {
                            if ($proc.HasExited) {
                                throw "Port-forward exited early. Check $errFile"
                            }

                            $code = & curl.exe -sS -o NUL -w "%{http_code}" `
                                --max-time 3 "http://127.0.0.1:$port/"

                            if ($LASTEXITCODE -eq 0 -and "$code" -eq "200") {
                                $healthy = $true
                                break
                            }

                            Start-Sleep -Seconds 1
                        }

                        if (-not $healthy) {
                            throw "Application did not return HTTP 200."
                        }

                        Write-Output "HTTP HEALTH: PASS (200 OK)"
                        Add-Content (Join-Path $env:WORKSPACE $env:REPORT) `
                            "Deployment HTTP health: PASS (200 OK)"
                    }
                    finally {
                        if ($proc -and -not $proc.HasExited) {
                            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                        }
                    }
                '''
            }
        }

        stage('Single Pod Failure') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $timeoutSeconds = 120

                    $depJson = & $env:KUBECTL get deployment $env:DEPLOYMENT `
                        -n $env:NAMESPACE -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot read deployment." }
                    $dep = $depJson | ConvertFrom-Json

                    $selector = ($dep.spec.selector.matchLabels.PSObject.Properties |
                        ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ","

                    $json = & $env:KUBECTL get pods -n $env:NAMESPACE -l $selector -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot list pods." }
                    $data = $json | ConvertFrom-Json

                    $readyPods = @($data.items | Where-Object {
                        -not $_.metadata.deletionTimestamp -and
                        @($_.status.conditions | Where-Object {
                            $_.type -eq "Ready" -and $_.status -eq "True"
                        }).Count -gt 0
                    })

                    if ($readyPods.Count -ne 2) {
                        throw "Expected 2 ready pods before test; found $($readyPods.Count)."
                    }

                    $victim = $readyPods[0].metadata.name
                    Write-Output "FAILURE TYPE: Single pod deletion"
                    Write-Output "Deleting pod/$victim"
                    $start = Get-Date

                    & $env:KUBECTL delete pod $victim -n $env:NAMESPACE --wait=false
                    if ($LASTEXITCODE -ne 0) { throw "Pod deletion failed." }

                    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
                    $recovered = $false
                    $readyCount = 0

                    while ((Get-Date) -lt $deadline) {
                        $json = & $env:KUBECTL get pods -n $env:NAMESPACE -l $selector -o json

                        if ($LASTEXITCODE -eq 0) {
                            $data = $json | ConvertFrom-Json
                            $active = @($data.items | Where-Object {
                                -not $_.metadata.deletionTimestamp
                            })
                            $ready = @($active | Where-Object {
                                @($_.status.conditions | Where-Object {
                                    $_.type -eq "Ready" -and $_.status -eq "True"
                                }).Count -gt 0
                            })
                            $readyCount = $ready.Count
                            $oldActive = @($active | Where-Object {
                                $_.metadata.name -eq $victim
                            }).Count -gt 0

                            if ($readyCount -eq 2 -and -not $oldActive) {
                                $recovered = $true
                                break
                            }
                        }
                        Start-Sleep -Seconds 2
                    }

                    $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
                    Write-Output "RECOVERY TIME: $elapsed seconds"
                    Write-Output "READY PODS: $readyCount/2"

                    if (-not $recovered) { throw "Single-pod recovery timed out." }

                    Add-Content (Join-Path $env:WORKSPACE $env:REPORT) `
                        "Single-pod deletion: PASS; recovery time: $elapsed seconds; ready pods: $readyCount/2"
                    Write-Output "TEST RESULT: PASS"
                '''
            }
        }

        stage('HTTP Health Check - Single Pod Recovery') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $port = 18083
                    $outFile = Join-Path $env:WORKSPACE "http-single-out.txt"
                    $errFile = Join-Path $env:WORKSPACE "http-single-err.txt"
                    $proc = $null

                    try {
                        if (Get-NetTCPConnection -LocalPort $port -State Listen `
                            -ErrorAction SilentlyContinue) {
                            throw "Local port $port is already occupied."
                        }

                        $proc = Start-Process -FilePath $env:KUBECTL `
                            -ArgumentList @("port-forward", "svc/$env:SERVICE",
                                "$port`:80", "-n", $env:NAMESPACE,
                                "--address=127.0.0.1") `
                            -PassThru -WindowStyle Hidden `
                            -RedirectStandardOutput $outFile `
                            -RedirectStandardError $errFile

                        $healthy = $false
                        $deadline = (Get-Date).AddSeconds(20)

                        while ((Get-Date) -lt $deadline) {
                            if ($proc.HasExited) { throw "Port-forward exited unexpectedly." }

                            $code = & curl.exe -sS -o NUL -w "%{http_code}" `
                                --max-time 3 "http://127.0.0.1:$port/"

                            if ($LASTEXITCODE -eq 0 -and "$code" -eq "200") {
                                $healthy = $true
                                break
                            }
                            Start-Sleep -Seconds 1
                        }

                        if (-not $healthy) { throw "HTTP health check failed after single-pod recovery." }

                        Write-Output "HTTP HEALTH AFTER SINGLE-POD RECOVERY: PASS (200 OK)"
                        Add-Content (Join-Path $env:WORKSPACE $env:REPORT) `
                            "After single-pod recovery HTTP health: PASS (200 OK)"
                    }
                    finally {
                        if ($proc -and -not $proc.HasExited) {
                            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                        }
                    }
                '''
            }
        }

        stage('Simultaneous Pod Failure') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $timeoutSeconds = 120

                    & $env:KUBECTL rollout status "deployment/$env:DEPLOYMENT" `
                        -n $env:NAMESPACE --timeout=120s
                    if ($LASTEXITCODE -ne 0) { throw "Deployment not stable before test." }

                    $depJson = & $env:KUBECTL get deployment $env:DEPLOYMENT `
                        -n $env:NAMESPACE -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot read deployment." }
                    $dep = $depJson | ConvertFrom-Json

                    $selector = ($dep.spec.selector.matchLabels.PSObject.Properties |
                        ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ","

                    $json = & $env:KUBECTL get pods -n $env:NAMESPACE -l $selector -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot list pods." }
                    $data = $json | ConvertFrom-Json

                    $readyPods = @($data.items | Where-Object {
                        -not $_.metadata.deletionTimestamp -and
                        @($_.status.conditions | Where-Object {
                            $_.type -eq "Ready" -and $_.status -eq "True"
                        }).Count -gt 0
                    })

                    if ($readyPods.Count -ne 2) {
                        throw "Expected 2 ready pods before test; found $($readyPods.Count)."
                    }

                    $oldNames = @($readyPods | ForEach-Object { $_.metadata.name })
                    Write-Output "FAILURE TYPE: Simultaneous pod deletion"
                    Write-Output "Deleting both application pods"
                    $start = Get-Date

                    & $env:KUBECTL delete pods -l $selector -n $env:NAMESPACE --wait=false
                    if ($LASTEXITCODE -ne 0) { throw "Simultaneous pod deletion failed." }

                    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
                    $recovered = $false
                    $readyCount = 0

                    while ((Get-Date) -lt $deadline) {
                        $json = & $env:KUBECTL get pods -n $env:NAMESPACE -l $selector -o json

                        if ($LASTEXITCODE -eq 0) {
                            $data = $json | ConvertFrom-Json
                            $active = @($data.items | Where-Object {
                                -not $_.metadata.deletionTimestamp
                            })
                            $ready = @($active | Where-Object {
                                @($_.status.conditions | Where-Object {
                                    $_.type -eq "Ready" -and $_.status -eq "True"
                                }).Count -gt 0
                            })
                            $readyCount = $ready.Count
                            $oldActive = @($active | Where-Object {
                                $oldNames -contains $_.metadata.name
                            }).Count -gt 0

                            if ($readyCount -eq 2 -and -not $oldActive) {
                                $recovered = $true
                                break
                            }
                        }
                        Start-Sleep -Seconds 2
                    }

                    $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
                    Write-Output "RECOVERY TIME: $elapsed seconds"
                    Write-Output "READY PODS: $readyCount/2"

                    if (-not $recovered) { throw "Simultaneous-pod recovery timed out." }

                    Add-Content (Join-Path $env:WORKSPACE $env:REPORT) `
                        "Simultaneous-pod deletion: PASS; recovery time: $elapsed seconds; ready pods: $readyCount/2"
                    Write-Output "TEST RESULT: PASS"
                '''
            }
        }

        stage('HTTP Health Check - Simultaneous Recovery') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $port = 18083
                    $outFile = Join-Path $env:WORKSPACE "http-both-out.txt"
                    $errFile = Join-Path $env:WORKSPACE "http-both-err.txt"
                    $proc = $null

                    try {
                        if (Get-NetTCPConnection -LocalPort $port -State Listen `
                            -ErrorAction SilentlyContinue) {
                            throw "Local port $port is already occupied."
                        }

                        $proc = Start-Process -FilePath $env:KUBECTL `
                            -ArgumentList @("port-forward", "svc/$env:SERVICE",
                                "$port`:80", "-n", $env:NAMESPACE,
                                "--address=127.0.0.1") `
                            -PassThru -WindowStyle Hidden `
                            -RedirectStandardOutput $outFile `
                            -RedirectStandardError $errFile

                        $healthy = $false
                        $deadline = (Get-Date).AddSeconds(20)

                        while ((Get-Date) -lt $deadline) {
                            if ($proc.HasExited) { throw "Port-forward exited unexpectedly." }

                            $code = & curl.exe -sS -o NUL -w "%{http_code}" `
                                --max-time 3 "http://127.0.0.1:$port/"

                            if ($LASTEXITCODE -eq 0 -and "$code" -eq "200") {
                                $healthy = $true
                                break
                            }
                            Start-Sleep -Seconds 1
                        }

                        if (-not $healthy) { throw "HTTP health check failed after simultaneous recovery." }

                        Write-Output "HTTP HEALTH AFTER SIMULTANEOUS RECOVERY: PASS (200 OK)"
                        Add-Content (Join-Path $env:WORKSPACE $env:REPORT) `
                            "After simultaneous recovery HTTP health: PASS (200 OK)"
                    }
                    finally {
                        if ($proc -and -not $proc.HasExited) {
                            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                        }
                    }
                '''
            }
        }
    }

    post {
        always {
            powershell '''
                if (Test-Path $env:KUBECONFIG) {
                    Remove-Item $env:KUBECONFIG -Force
                    Write-Output "Temporary Kubernetes configuration removed."
                }
            '''

            archiveArtifacts artifacts: 'recovery-report.txt', allowEmptyArchive: true
            echo 'Pipeline finished. Check test stages and archived report.'
        }
    }
}
