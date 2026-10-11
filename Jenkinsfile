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
                    string(credentialsId: 'k8s-jenkins-token',
                           variable: 'K8S_TOKEN'),
                    file(credentialsId: 'k8s-cluster-ca',
                         variable: 'K8S_CA')
                ]) {
                    sh '''
                        set +x
                        kubectl config set-cluster local-cluster \
                          --server=https://192.168.49.2:8443 \
                          --certificate-authority="$K8S_CA" \
                          --embed-certs=true

                        kubectl config set-credentials jenkins-dr \
                          --token="$K8S_TOKEN"

                        kubectl config set-context jenkins-dr-context \
                          --cluster=local-cluster \
                          --user=jenkins-dr \
                          --namespace=default

                        kubectl config use-context jenkins-dr-context
                        kubectl get nodes
                    '''
                }
            }
        }

        stage('Deploy Application') {
            steps {
                withCredentials([
                    string(credentialsId: 'k8s-jenkins-token',
                           variable: 'K8S_TOKEN'),
                    file(credentialsId: 'k8s-cluster-ca',
                         variable: 'K8S_CA')
                ]) {
                    sh '''
                        set +x
                        kubectl config set-cluster local-cluster \
                          --server=https://192.168.49.2:8443 \
                          --certificate-authority="$K8S_CA" \
                          --embed-certs=true
                        kubectl config set-credentials jenkins-dr \
                          --token="$K8S_TOKEN"
                        kubectl config set-context jenkins-dr-context \
                          --cluster=local-cluster \
                          --user=jenkins-dr \
                          --namespace=default
                        kubectl config use-context jenkins-dr-context

                        kubectl apply -f k8s/app.yaml
                        kubectl rollout status deployment/dr-web \
                          --timeout=120s
                        kubectl get deployment dr-web
                        kubectl get pods
                    '''
                }
            }
        }

        stage('Simulate Pod Failure') {
            steps {
                withCredentials([
                    string(credentialsId: 'k8s-jenkins-token',
                           variable: 'K8S_TOKEN'),
                    file(credentialsId: 'k8s-cluster-ca',
                         variable: 'K8S_CA')
                ]) {
                    sh '''
                        set +x
                        kubectl config set-cluster local-cluster \
                          --server=https://192.168.49.2:8443 \
                          --certificate-authority="$K8S_CA" \
                          --embed-certs=true
                        kubectl config set-credentials jenkins-dr \
                          --token="$K8S_TOKEN"
                        kubectl config set-context jenkins-dr-context \
                          --cluster=local-cluster \
                          --user=jenkins-dr \
                          --namespace=default
                        kubectl config use-context jenkins-dr-context

                        POD=$(kubectl get pods -o name |
                          grep '^pod/dr-web-' | head -n 1)

                        if [ -z "$POD" ]; then
                          echo "ERROR: No dr-web pod found"
                          exit 1
                        fi

                        echo "Simulating failure by deleting $POD"
                        kubectl delete "$POD" --wait=true

                        echo "Waiting for Kubernetes to restore 2 replicas"
                        READY=0
                        for i in $(seq 1 60); do
                          READY=$(kubectl get deployment dr-web \
                            -o jsonpath='{.status.readyReplicas}')
                          if [ "$READY" = "2" ]; then
                            break
                          fi
                          sleep 2
                        done

                        if [ "$READY" != "2" ]; then
                          echo "RECOVERY FAILED: expected 2 ready replicas"
                          kubectl get pods
                          exit 1
                        fi

                        echo "RECOVERY SUCCESS: 2 replicas are ready"
                        kubectl get deployment dr-web
                        kubectl get pods
                    '''
                }
            }
        }
    }

    post {
        always {
            echo 'Disaster recovery pipeline finished. Check stage logs for results.'
        }
    }
}
