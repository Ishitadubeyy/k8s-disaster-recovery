
pipeline {
    agent {
        label 'weatherwatch'
    }

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        KUBECONFIG = "${WORKSPACE}\\jenkins-kubeconfig"
        KUBECTL = 'C:\\Users\\ishit\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\kubectl.exe'
        MINIKUBE = 'C:\\minikube\\minikube.exe'
        K8S_API = 'https://127.0.0.1:49706'
        NAMESPACE = 'default'
        REPORT = 'recovery-report.txt'
        MINIKUBE_PROFILE = 'local-cluster'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                powershell '''
                    Write-Output "WeatherWatch repository checked out."
                '''
            }
        }

        stage('Verify Tools') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    if (-not (Test-Path $env:KUBECTL)) {
                        throw "kubectl not found: $env:KUBECTL"
                    }

                    if (-not (Test-Path $env:MINIKUBE)) {
                        throw "Minikube not found: $env:MINIKUBE"
                    }

                    docker --version
                    if ($LASTEXITCODE -ne 0) {
                        throw "Docker is unavailable."
                    }

                    & $env:KUBECTL version --client
                    if ($LASTEXITCODE -ne 0) {
                        throw "kubectl is unavailable."
                    }

                    & $env:MINIKUBE version
                    if ($LASTEXITCODE -ne 0) {
                        throw "Minikube is unavailable."
                    }

                    & $env:MINIKUBE status -p $env:MINIKUBE_PROFILE
                    if ($LASTEXITCODE -ne 0) {
                        throw "Minikube is not running."
                    }

                    Write-Output "All required tools verified."
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

                        if (-not (Test-Path $env:K8S_CA_FILE)) {
                            throw "Kubernetes CA certificate not found."
                        }

                        $connection = Test-NetConnection 127.0.0.1 `
                            -Port 49706 `
                            -WarningAction SilentlyContinue

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

                        if ($LASTEXITCODE -ne 0) {
                            throw "Cluster configuration failed."
                        }

                        & $env:KUBECTL config set-credentials jenkins-weatherwatch `
                            "--token=$env:K8S_TOKEN"

                        if ($LASTEXITCODE -ne 0) {
                            throw "Credential configuration failed."
                        }

                        & $env:KUBECTL config set-context jenkins-weatherwatch `
                            --cluster=local-cluster `
                            --user=jenkins-weatherwatch `
                            "--namespace=$env:NAMESPACE"

                        if ($LASTEXITCODE -ne 0) {
                            throw "Context configuration failed."
                        }

                        & $env:KUBECTL config use-context jenkins-weatherwatch

                        if ($LASTEXITCODE -ne 0) {
                            throw "Context selection failed."
                        }

                        & $env:KUBECTL get nodes

                        if ($LASTEXITCODE -ne 0) {
                            throw "Kubernetes access failed."
                        }

                        Write-Output "Kubernetes connection successful."
                    '''
                }
            }
        }

        stage('Build and Load Images') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    $frontend = Join-Path $env:WORKSPACE "app\\frontend"
                    $backend = Join-Path $env:WORKSPACE "app\\backend"

                    docker build -t weatherwatch-frontend:latest $frontend

                    if ($LASTEXITCODE -ne 0) {
                        throw "Frontend image build failed."
                    }

                    docker build -t weatherwatch-backend:latest $backend

                    if ($LASTEXITCODE -ne 0) {
                        throw "Backend image build failed."
                    }

                    & $env:MINIKUBE image load weatherwatch-frontend:latest `
                        -p $env:MINIKUBE_PROFILE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Frontend image loading failed."
                    }

                    & $env:MINIKUBE image load weatherwatch-backend:latest `
                        -p $env:MINIKUBE_PROFILE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Backend image loading failed."
                    }

                    & $env:MINIKUBE image load postgres:16-alpine `
                        -p $env:MINIKUBE_PROFILE

                    if ($LASTEXITCODE -ne 0) {
                        throw "PostgreSQL image loading failed."
                    }

                    Write-Output "All images built and loaded successfully."
                '''
            }
        }

        stage('Deploy to Minikube') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    $secret = & $env:KUBECTL get secret `
                        weatherwatch-db-credentials `
                        -n $env:NAMESPACE `
                        --ignore-not-found `
                        -o name

                    if ($LASTEXITCODE -ne 0) {
                        throw "Could not check database Secret."
                    }

                    if (-not $secret) {
                        throw "Database Secret is missing."
                    }

                    $manifest = Join-Path $env:WORKSPACE "k8s"

                    & $env:KUBECTL apply -f $manifest `
                        -n $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Kubernetes manifests could not be applied."
                    }

                    foreach ($deployment in @(
                        "weatherwatch-postgres",
                        "weatherwatch-backend",
                        "weatherwatch-frontend"
                    )) {
                        & $env:KUBECTL rollout status `
                            "deployment/$deployment" `
                            -n $env:NAMESPACE `
                            --timeout=240s

                        if ($LASTEXITCODE -ne 0) {
                            throw "Deployment $deployment did not become ready."
                        }
                    }

                    Write-Output "WeatherWatch deployment successful."
                '''
            }
        }

        stage('Health Checks') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    & $env:KUBECTL get pods -n $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Pod health check failed."
                    }

                    & $env:KUBECTL get deployments -n $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Deployment health check failed."
                    }

                    & $env:KUBECTL get services -n $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "Service health check failed."
                    }

                    Write-Output "Health checks completed."
                '''
            }
        }

        stage('Disaster Recovery Tests') {
            steps {
                powershell '''
                    $ErrorActionPreference = "Stop"

                    $script = Join-Path $env:WORKSPACE `
                        "scripts\\recovery-test.ps1"

                    if (-not (Test-Path $script)) {
                        throw "Recovery test script not found."
                    }

                    & $script `
                        -Kubectl $env:KUBECTL `
                        -Workspace $env:WORKSPACE `
                        -Namespace $env:NAMESPACE

                    if ($LASTEXITCODE -ne 0) {
                        throw "WeatherWatch recovery tests failed."
                    }

                    Write-Output "Disaster recovery tests completed."
                '''
            }
        }
    }

    post {
        always {
            powershell '''
                $reportPath = Join-Path $env:WORKSPACE $env:REPORT

                if (-not (Test-Path $reportPath)) {
                    Set-Content $reportPath `
                        "Recovery tests did not produce a report. Check Jenkins Console Output."
                }

                if (Test-Path $env:KUBECONFIG) {
                    Remove-Item $env:KUBECONFIG -Force
                    Write-Output "Temporary kubeconfig removed."
                }
            '''

            archiveArtifacts artifacts: 'recovery-report.txt',
                allowEmptyArchive: false

            echo 'WeatherWatch pipeline execution finished.'
        }

        success {
            echo 'WEATHERWATCH CI/CD AND DISASTER RECOVERY PIPELINE PASSED.'
        }

        failure {
            echo 'PIPELINE FAILED. Check Console Output.'
        }
    }
}
