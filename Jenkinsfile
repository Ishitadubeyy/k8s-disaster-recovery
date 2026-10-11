
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
                            throw "kubectl.exe not found at $kubectl"
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

                        & $kubectl get nodes

                        if ($LASTEXITCODE -ne 0) {
                            throw "Cannot access Kubernetes API"
                        }
                    '''
                }
            }
        }

        stage('Deploy Application') {
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
        }

        stage('Simulate Pod Failure') {
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

                        if (-not (Test-Path $env:KUBECONFIG)) {
                            throw "Kubernetes configuration file not found"
                        }

                        $pods = & $kubectl get pods -o name

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to list pods"
                        }

                        $pod = $pods |
                            Where-Object { $_ -match '^pod/dr-web-' } |
                            Select-Object -First 1

                        if (-not $pod) {
                            throw "No dr-web pod found"
                        }

                        Write-Host "Simulating failure by deleting $pod"

                        & $kubectl delete $pod --wait=true

                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to delete pod"
                        }

                        Write-Host "Waiting for Kubernetes to restore two ready replicas"

                        $recovered = $false

                        for ($i = 0; $i -lt 60; $i++) {
                            $ready = & $kubectl get deployment dr-web `
                                -o jsonpath='{.status.readyReplicas}'

                            if ($LASTEXITCODE -ne 0) {
                                throw "Unable to check deployment status"
                            }

                            if ("$ready".Trim() -eq "2") {
                                $recovered = $true
                                break
                            }

                            Start-Sleep -Seconds 2
                        }

                        & $kubectl get deployment dr-web
                        & $kubectl get pods

                        if (-not $recovered) {
                            throw "RECOVERY FAILED: deployment did not return to two ready replicas"
                        }

                        Write-Host "RECOVERY SUCCESS: 2 replicas are ready"
                    '''
                }
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
