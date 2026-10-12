
pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 10, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
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
                        variable: 'K8S_CA'
                    )
                ]) {
                    powershell '''
                        $ErrorActionPreference = "Stop"

                        $env:KUBECONFIG = Join-Path $env:WORKSPACE 'jenkins-kubeconfig'
                        $kubectl = "C:\\Users\\ishit\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\kubectl.exe"

                        if (-not (Test-Path $kubectl)) {
                            throw "kubectl.exe not found: $kubectl"
                        }

                        # Verify that the Kubernetes API endpoint is reachable.
                        $apiHost = "127.0.0.1"
                        $apiPort = 64079
                        $connection = Test-NetConnection $apiHost -Port $apiPort -WarningAction SilentlyContinue

                        if (-not $connection.TcpTestSucceeded) {
                            throw "Kubernetes API is unreachable at ${apiHost}:${apiPort}. Start Docker Desktop and Minikube, then retry."
                        }

                        & $kubectl config set-cluster local-cluster `
                            --server=https://127.0.0.1:64079 `
                            --certificate-authority="$env:K8S_CA" `
                            --embed-certs=true

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to configure Kubernetes cluster"
                        }

                        & $kubectl config set-credentials jenkins-dr `
                            --token="$env:K8S_TOKEN"

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to configure Kubernetes credentials"
                        }

                        & $kubectl config set-context jenkins-dr-context `
                            --cluster=local-cluster `
                            --user=jenkins-dr `
                            --namespace=default

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to configure Kubernetes context"
                        }

                        & $kubectl config use-context jenkins-dr-context

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to select Kubernetes context"
                        }

                        & $kubectl get deployments -n default

                        if ($LASTEXITCODE -ne 0) {
                            throw "Cannot access Kubernetes deployments. Check token permissions or expiry."
                        }

                        Write-Host "Kubernetes connection verified."
                    '''
                }
            }
        }

        stage('Deploy Application') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    $env:KUBECONFIG = Join-Path $env:WORKSPACE 'jenkins-kubeconfig'
                    $kubectl = "C:\\Users\\ishit\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\kubectl.exe"

                    if (-not (Test-Path $env:KUBECONFIG)) {
                        throw "Kubernetes configuration file not found"
                    }

                    & $kubectl apply -f k8s/app.yaml

                    if ($LASTEXITCODE -ne 0) {
                        throw "Deployment apply failed"
                    }

                    & $kubectl rollout status deployment/dr-web --timeout=120s

                    if ($LASTEXITCODE -ne 0) {
                        throw "Deployment rollout failed"
                    }

                    & $kubectl get deployment dr-web

                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to get deployment"
                    }

                    & $kubectl get pods

                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to list pods"
                    }
                '''
            }
        }

        stage('Simulate Pod Failure') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    $env:KUBECONFIG = Join-Path $env:WORKSPACE 'jenkins-kubeconfig'
                    $kubectl = "C:\\Users\\ishit\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\kubectl.exe"

                    if (-not (Test-Path $env:KUBECONFIG)) {
                        throw "Kubernetes configuration file not found"
                    }

                    # Confirm the deployment is healthy before testing.
                    $ready = & $kubectl get deployment dr-web `
                        -o jsonpath='{.status.readyReplicas}'

                    if ($LASTEXITCODE -ne 0) {
                        throw "Unable to inspect deployment"
                    }

                    if ("$ready".Trim() -ne "2") {
                        throw "Precondition failed: dr-web must have two ready replicas"
                    }

                    # Select only one dr-web pod.
                    $pods = @(
                        & $kubectl get pods -o name |
                        Where-Object { $_ -match '^pod/dr-web-' }
                    )

                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to list application pods"
                    }

                    if ($pods.Count -lt 2) {
                        throw "Expected at least two dr-web pods"
                    }

                    $pod = $pods[0]

                    Write-Host "FAILURE TYPE: Single pod deletion"
                    Write-Host "Deleting $pod"

                    # Start measuring immediately before deletion.
                    $start = Get-Date

                    & $kubectl delete $pod --wait=true

                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to delete application pod"
                    }

                    $recovered = $false

                    for ($i = 0; $i -lt 60; $i++) {
                        $ready = & $kubectl get deployment dr-web `
                            -o jsonpath='{.status.readyReplicas}'

                        if ($LASTEXITCODE -ne 0) {
                            throw "Unable to check recovery status"
                        }

                        if ("$ready".Trim() -eq "2") {
                            $recovered = $true
                            break
                        }

                        Start-Sleep -Seconds 1
                    }

                    $recoverySeconds = [math]::Round(
                        ((Get-Date) - $start).TotalSeconds, 2
                    )

                    & $kubectl get deployment dr-web
                    & $kubectl get pods

                    if (-not $recovered) {
                        Write-Host "TEST RESULT: FAIL"
                        Write-Host "RECOVERY TIME: $recoverySeconds seconds"
                        throw "Recovery was not confirmed within 60 seconds"
                    }

                    Write-Host "TEST RESULT: PASS"
                    Write-Host "FAILURE TYPE: Single pod deletion"
                    Write-Host "RECOVERY TIME: $recoverySeconds seconds"
                    Write-Host "READY REPLICAS: 2/2"
                '''
            }
        }
    }

    post {
        always {
            echo 'Disaster recovery pipeline finished. Check stage logs for results.'

            powershell '''
                $config = Join-Path $env:WORKSPACE 'jenkins-kubeconfig'

                if (Test-Path $config) {
                    Remove-Item $config -Force
                    Write-Host "Temporary Kubernetes configuration removed."
                }
            '''
        }
    }
}
