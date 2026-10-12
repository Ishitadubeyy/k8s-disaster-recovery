
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
                            throw "kubectl was not found at $env:KUBECTL"
                        }

                        $apiHost = "127.0.0.1"
                        $apiPort = 49706

                        $connection = Test-NetConnection `
                            $apiHost `
                            -Port $apiPort `
                            -WarningAction SilentlyContinue

                        if (-not $connection.TcpTestSucceeded) {
                            throw "Kubernetes API is unreachable at ${apiHost}:${apiPort}. Start Docker Desktop and Minikube."
                        }

                        if (-not (Test-Path $env:K8S_CA_FILE)) {
                            throw "Kubernetes CA certificate was not found."
                        }

                        $configDir = Split-Path $env:KUBECONFIG -Parent
                        New-Item -ItemType Directory -Force `
                            -Path $configDir | Out-Null

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

                        & $env:KUBECTL get deployments `
                            -n $env:NAMESPACE

                        if ($LASTEXITCODE -ne 0) {
                            throw "Cannot access deployments in the namespace."
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
                        throw "Application manifest not found: $manifest"
                    }

                    & $env:KUBECTL apply -f $manifest `
                        -n $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Application deployment failed."
                    }

                    & $env:KUBECTL rollout status `
                        "deployment/$env:DEPLOYMENT" `
                        -n $env:NAMESPACE `
                        --timeout=120s

                    if ($LASTEXITCODE -ne 0) {
                        throw "Application rollout did not complete."
                    }

                    & $env:KUBECTL get deployment $env:DEPLOYMENT `
                        -n $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Could not retrieve deployment status."
                    }

                    Write-Output "Application deployment verified."
                '''
            }
        }

        stage('Single Pod Failure') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"
                    $expectedReplicas = 2
                    $timeoutSeconds = 120

                    Write-Output "FAILURE TYPE: Single pod deletion"

                    $deployment = & $env:KUBECTL get deployment `
                        $env:DEPLOYMENT -n $env:NAMESPACE -o json |
                        ConvertFrom-Json

                    if ($LASTEXITCODE -ne 0 -or -not $deployment) {
                        throw "Could not retrieve deployment details."
                    }

                    $selector = (
                        $deployment.spec.selector.matchLabels.PSObject.Properties |
                        ForEach-Object { "$($_.Name)=$($_.Value)" }
                    ) -join ","

                    if ([string]::IsNullOrWhiteSpace($selector)) {
                        throw "Deployment selector is empty."
                    }

                    $ready = [int]$deployment.status.readyReplicas

                    if ($ready -ne $expectedReplicas) {
                        throw "Pre-test check failed: expected 2 ready replicas, found $ready."
                    }

                    $pods = @(
                        & $env:KUBECTL get pods `
                            -n $env:NAMESPACE `
                            -l $selector `
                            -o jsonpath='{.items[*].metadata.name}'
                    ) -join ' '

                    if ($LASTEXITCODE -ne 0 -or
                        [string]::IsNullOrWhiteSpace($pods)) {
                        throw "Could not find application pods."
                    }

                    $podNames = @($pods -split '\\s+' | Where-Object { $_ })

                    if ($podNames.Count -lt 2) {
                        throw "Expected at least two application pods."
                    }

                    $victim = $podNames[0]
                    Write-Output "Deleting pod/$victim"

                    $start = Get-Date

                    & $env:KUBECTL delete pod $victim `
                        -n $env:NAMESPACE --wait=false

                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to delete application pod."
                    }

                    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
                    $recovered = $false
                    $ready = 0

                    while ((Get-Date) -lt $deadline) {
                        $status = & $env:KUBECTL get deployment `
                            $env:DEPLOYMENT -n $env:NAMESPACE -o json |
                            ConvertFrom-Json

                        if ($LASTEXITCODE -eq 0 -and $status) {
                            $ready = [int]$status.status.readyReplicas
                            $available = [int]$status.status.availableReplicas

                            if ($ready -eq $expectedReplicas -and
                                $available -eq $expectedReplicas) {
                                $recovered = $true
                                break
                            }
                        }

                        Start-Sleep -Seconds 2
                    }

                    $recoverySeconds = [math]::Round(
                        ((Get-Date) - $start).TotalSeconds, 2
                    )

                    & $env:KUBECTL get pods `
                        -n $env:NAMESPACE -l $selector

                    Write-Output "FAILURE TYPE: Single pod deletion"
                    Write-Output "RECOVERY TIME: $recoverySeconds seconds"
                    Write-Output "READY REPLICAS: $ready/2"

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
                    $expectedReplicas = 2
                    $timeoutSeconds = 120

                    Write-Output "FAILURE TYPE: Simultaneous pod deletion"

                    $deployment = & $env:KUBECTL get deployment `
                        $env:DEPLOYMENT -n $env:NAMESPACE -o json |
                        ConvertFrom-Json

                    if ($LASTEXITCODE -ne 0 -or -not $deployment) {
                        throw "Could not retrieve deployment details."
                    }

                    $selector = (
                        $deployment.spec.selector.matchLabels.PSObject.Properties |
                        ForEach-Object { "$($_.Name)=$($_.Value)" }
                    ) -join ","

                    if ([string]::IsNullOrWhiteSpace($selector)) {
                        throw "Deployment selector is empty."
                    }

                    $ready = [int]$deployment.status.readyReplicas

                    if ($ready -ne $expectedReplicas) {
                        throw "Pre-test check failed: expected 2 ready replicas, found $ready."
                    }

                    $pods = @(
                        & $env:KUBECTL get pods `
                            -n $env:NAMESPACE `
                            -l $selector `
                            -o jsonpath='{.items[*].metadata.name}'
                    ) -join ' '

                    if ($LASTEXITCODE -ne 0 -or
                        [string]::IsNullOrWhiteSpace($pods)) {
                        throw "Could not find application pods."
                    }

                    $podNames = @($pods -split '\\s+' | Where-Object { $_ })

                    if ($podNames.Count -lt 2) {
                        throw "Expected two application pods for this test."
                    }

                    Write-Output "Deleting application pods: $pods"

                    $start = Get-Date

                    & $env:KUBECTL delete pods `
                        -l $selector `
                        -n $env:NAMESPACE `
                        --wait=false

                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to delete application pods."
                    }

                    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
                    $recovered = $false
                    $ready = 0

                    while ((Get-Date) -lt $deadline) {
                        $status = & $env:KUBECTL get deployment `
                            $env:DEPLOYMENT -n $env:NAMESPACE -o json |
                            ConvertFrom-Json

                        if ($LASTEXITCODE -eq 0 -and $status) {
                            $ready = [int]$status.status.readyReplicas
                            $available = [int]$status.status.availableReplicas

                            if ($ready -eq $expectedReplicas -and
                                $available -eq $expectedReplicas) {
                                $recovered = $true
                                break
                            }
                        }

                        Start-Sleep -Seconds 2
                    }

                    $recoverySeconds = [math]::Round(
                        ((Get-Date) - $start).TotalSeconds, 2
                    )

                    & $env:KUBECTL get pods `
                        -n $env:NAMESPACE -l $selector

                    Write-Output "FAILURE TYPE: Simultaneous pod deletion"
                    Write-Output "RECOVERY TIME: $recoverySeconds seconds"
                    Write-Output "READY REPLICAS: $ready/2"

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
