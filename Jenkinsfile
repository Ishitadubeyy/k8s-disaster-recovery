
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
                    string(
                        credentialsId: 'k8s-jenkins-token',
                        variable: 'K8S_TOKEN'
                    ),
                    file(
                        credentialsId: 'k8s-cluster-ca',
                        variable: 'K8S_CA_FILE'
                    )
                ]) {
                    powershell '''
                        $ErrorActionPreference = "Stop"

                        if (-not (Test-Path $env:KUBECTL)) {
                            throw "kubectl not found: $env:KUBECTL"
                        }

                        $connection = Test-NetConnection `
                            127.0.0.1 -Port 49706 `
                            -WarningAction SilentlyContinue

                        if (-not $connection.TcpTestSucceeded) {
                            throw "Kubernetes API is unreachable at $env:K8S_API. Start Minikube and verify its API port."
                        }

                        if (-not (Test-Path $env:K8S_CA_FILE)) {
                            throw "Kubernetes CA certificate not found."
                        }

                        if (Test-Path $env:KUBECONFIG) {
                            Remove-Item $env:KUBECONFIG -Force
                        }

                        & $env:KUBECTL config set-cluster local-cluster `
                            "--server=$env:K8S_API" `
                            "--certificate-authority=$env:K8S_CA_FILE" `
                            --embed-certs=true

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to configure Kubernetes cluster."
                        }

                        & $env:KUBECTL config set-credentials jenkins-dr `
                            "--token=$env:K8S_TOKEN"

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to configure Kubernetes credentials."
                        }

                        & $env:KUBECTL config set-context jenkins-context `
                            --cluster=local-cluster `
                            --user=jenkins-dr `
                            "--namespace=$env:NAMESPACE"

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to configure Kubernetes context."
                        }

                        & $env:KUBECTL config use-context jenkins-context

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to select Kubernetes context."
                        }

                        & $env:KUBECTL get deployments -n $env:NAMESPACE

                        if ($LASTEXITCODE -ne 0) {
                            throw "Cannot access Kubernetes deployments."
                        }

                        Write-Output "Kubernetes access configured successfully."
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

                    if ($LASTEXITCODE -ne 0) {
                        throw "Application deployment failed."
                    }

                    & $env:KUBECTL rollout status `
                        "deployment/$env:DEPLOYMENT" `
                        -n $env:NAMESPACE --timeout=120s

                    if ($LASTEXITCODE -ne 0) {
                        throw "Application rollout failed."
                    }

                    Write-Output "Application deployment verified."
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

                    $json = & $env:KUBECTL get pods -n $env:NAMESPACE `
                        -l $selector -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot list application pods." }
                    $data = $json | ConvertFrom-Json

                    $readyPods = @($data.items | Where-Object {
                        -not $_.metadata.deletionTimestamp -and
                        @($_.status.conditions | Where-Object {
                            $_.type -eq "Ready" -and $_.status -eq "True"
                        }).Count -gt 0
                    })

                    if ($readyPods.Count -ne 2) {
                        throw "Pre-test check failed: expected 2 ready pods, found $($readyPods.Count)."
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
                        $json = & $env:KUBECTL get pods -n $env:NAMESPACE `
                            -l $selector -o json

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
                            $oldPodActive = @($active | Where-Object {
                                $_.metadata.name -eq $victim
                            }).Count -gt 0

                            if ($readyCount -eq 2 -and -not $oldPodActive) {
                                $recovered = $true
                                break
                            }
                        }

                        Start-Sleep -Seconds 2
                    }

                    $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
                    & $env:KUBECTL get pods -n $env:NAMESPACE -l $selector

                    Write-Output "RECOVERY TIME: $elapsed seconds"
                    Write-Output "READY PODS: $readyCount/2"

                    if (-not $recovered) {
                        Write-Output "TEST RESULT: FAIL"
                        throw "Single-pod recovery timed out."
                    }

                    Write-Output "TEST RESULT: PASS"
                '''
            }
        }

        stage('Simultaneous Pod Failure') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $timeoutSeconds = 120

                    # Wait for a healthy, stable starting state.
                    & $env:KUBECTL rollout status `
                        "deployment/$env:DEPLOYMENT" `
                        -n $env:NAMESPACE --timeout=120s

                    if ($LASTEXITCODE -ne 0) {
                        throw "Deployment did not stabilize before simultaneous-failure test."
                    }

                    $depJson = & $env:KUBECTL get deployment $env:DEPLOYMENT `
                        -n $env:NAMESPACE -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot read deployment." }
                    $dep = $depJson | ConvertFrom-Json

                    $selector = ($dep.spec.selector.matchLabels.PSObject.Properties |
                        ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ","

                    $json = & $env:KUBECTL get pods -n $env:NAMESPACE `
                        -l $selector -o json
                    if ($LASTEXITCODE -ne 0) { throw "Cannot list application pods." }
                    $data = $json | ConvertFrom-Json

                    $readyPods = @($data.items | Where-Object {
                        -not $_.metadata.deletionTimestamp -and
                        @($_.status.conditions | Where-Object {
                            $_.type -eq "Ready" -and $_.status -eq "True"
                        }).Count -gt 0
                    })

                    if ($readyPods.Count -ne 2) {
                        throw "Pre-test check failed: expected 2 ready pods, found $($readyPods.Count)."
                    }

                    $oldNames = @($readyPods | ForEach-Object {
                        $_.metadata.name
                    })

                    Write-Output "FAILURE TYPE: Simultaneous pod deletion"
                    Write-Output "Deleting both application pods"

                    $start = Get-Date
                    & $env:KUBECTL delete pods -l $selector `
                        -n $env:NAMESPACE --wait=false

                    if ($LASTEXITCODE -ne 0) {
                        throw "Simultaneous pod deletion failed."
                    }

                    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
                    $recovered = $false
                    $readyCount = 0

                    while ((Get-Date) -lt $deadline) {
                        $json = & $env:KUBECTL get pods -n $env:NAMESPACE `
                            -l $selector -o json

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
                            $oldPodActive = @($active | Where-Object {
                                $oldNames -contains $_.metadata.name
                            }).Count -gt 0

                            if ($readyCount -eq 2 -and -not $oldPodActive) {
                                $recovered = $true
                                break
                            }
                        }

                        Start-Sleep -Seconds 2
                    }

                    $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
                    & $env:KUBECTL get pods -n $env:NAMESPACE -l $selector

                    Write-Output "RECOVERY TIME: $elapsed seconds"
                    Write-Output "READY PODS: $readyCount/2"

                    if (-not $recovered) {
                        Write-Output "TEST RESULT: FAIL"
                        throw "Simultaneous-pod recovery timed out."
                    }

                    Write-Output "TEST RESULT: PASS"
                '''
            }
        }
    }

    post {
        always {
            echo 'Disaster recovery pipeline finished. Check stage logs for results.'

            powershell '''
                if (Test-Path $env:KUBECONFIG) {
                    Remove-Item $env:KUBECONFIG -Force
                    Write-Output "Temporary Kubernetes configuration removed."
                } else {
                    Write-Output "No temporary Kubernetes configuration to remove."
                }
            '''
        }
    }
}
