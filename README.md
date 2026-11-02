# WeatherWatch

WeatherWatch is a responsive React/Vite weather dashboard backed by an Express API and PostgreSQL. City lookup and current/hourly/7-day weather are live Open-Meteo data; favorites and recent searches are stored in PostgreSQL.

## Run locally with Docker Compose

Requirements: Docker Desktop with Compose, and an internet connection for Open-Meteo.

From the repository root in PowerShell:

```powershell
if (-not (Test-Path .env)) {
    $password = [guid]::NewGuid().ToString('N')
    Set-Content -Path .env -Value "POSTGRES_PASSWORD=$password" -NoNewline
}
docker compose up --build
```

The first run creates a local `.env` file with a random database password; it is ignored by Git and reused on later starts so the password stays consistent with the persistent database volume. Open [http://localhost:8080](http://localhost:8080). The dashboard initially loads Mumbai; search for another city, select the star to save/remove a favorite, and use the favorite or recent-search lists to revisit locations. PostgreSQL data is kept in the `weatherwatch-data` Docker volume.

To use a different local port, set `$env:WEATHERWATCH_PORT` before `docker compose up`. Stop the app with `Ctrl+C`, then run:

```powershell
docker compose down
```

`docker compose down -v` also removes the database volume and all stored favorites/history.

## Run services directly with Node.js

Requirements: Node.js 20+, PostgreSQL, and PowerShell. Create a database and user, then set the backend connection variables in the shell. Start PostgreSQL separately.

```powershell
$env:PGHOST = 'localhost'
$env:PGPORT = '5432'
$env:PGDATABASE = 'weatherwatch'
$env:PGUSER = 'weatherwatch'
$env:PGPASSWORD = '<your-local-postgres-password>'
Set-Location app\backend
npm install
npm start
```

In another PowerShell window:

```powershell
Set-Location app\frontend
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally [http://localhost:5173](http://localhost:5173)). Vite proxies `/api` requests to `http://localhost:3001`.

## API

The backend listens on port `3001` by default. It requires PostgreSQL settings `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database readiness |
| GET | `/api/weather?city=Mumbai` | Current Open-Meteo conditions; records a successful search |
| GET | `/api/forecast?city=Mumbai` | Hourly and 7-day Open-Meteo forecast |
| GET | `/api/favorites` | List saved cities |
| POST | `/api/favorites` | Save a city with JSON body `{"city":"Mumbai"}` |
| DELETE | `/api/favorites/:id` | Remove a saved city |
| GET | `/api/history` | Ten most recent successful weather searches |

The Open-Meteo geocoding service resolves city names. The API validates city input, returns actionable HTTP errors, and reports upstream service failures instead of substituting sample weather.

## Build and test

```powershell
Set-Location app\backend
npm install
npm test
Set-Location ..\frontend
npm install
npm run build
Set-Location ..\..
docker compose config
```

## Kubernetes / Minikube

The manifests in `k8s\` define two frontend replicas, two backend replicas, a single PostgreSQL replica, internal services, health probes, ConfigMaps, and a 2 GiB PVC. Create the database password Secret before applying them; do not commit a Secret or password:

```powershell
$bytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($bytes) } finally { $random.Dispose() }
$dbPassword = [Convert]::ToBase64String($bytes)
kubectl create secret generic weatherwatch-db-credentials `
  "--from-literal=POSTGRES_PASSWORD=$dbPassword"
docker build -t weatherwatch-backend:latest app\backend
docker build -t weatherwatch-frontend:latest app\frontend
minikube image load weatherwatch-backend:latest
minikube image load weatherwatch-frontend:latest
kubectl apply -f k8s
kubectl rollout status deployment/weatherwatch-postgres --timeout=240s
kubectl rollout status deployment/weatherwatch-backend --timeout=240s
kubectl rollout status deployment/weatherwatch-frontend --timeout=240s
minikube service weatherwatch-frontend --url
```

Open the URL printed by Minikube. The frontend proxies API requests to the in-cluster backend Service. Keep the generated password available if you later need to recreate the Secret; changing it while retaining the existing PostgreSQL volume will make the database password and Secret disagree.

## Jenkins and recovery testing

The existing Windows Jenkins agent integration is retained: it uses the configured `k8s-jenkins-token` and `k8s-cluster-ca` credentials, existing local Kubernetes API endpoint, and `kubectl` path. The agent also needs Docker Desktop, Minikube on `PATH`, PowerShell, and `curl.exe`. It builds both images, loads them into Minikube, deploys the manifests, waits for all deployments, and checks frontend/backend health. The pipeline creates a random Kubernetes database Secret only when one does not already exist. It then deletes one frontend Pod, one backend Pod, and the PostgreSQL Pod; the database recovery check verifies a saved favorite survives the PostgreSQL restart and PVC remount. Measured recovery times are written to `recovery-report.txt` and archived, including a failure/not-run status if the checks do not complete.

The recovery tests require a reachable Minikube cluster and the existing Jenkins credentials; they are not reported as passed unless Jenkins executes them successfully. Review `recovery-report.txt` and the Jenkins stage results for actual outcomes.
