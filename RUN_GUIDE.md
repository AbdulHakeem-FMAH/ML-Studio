# AutoML Platform v2.0 — Local Development Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.11 | `pyenv install 3.11` or system package |
| Node.js | 20+ | `nvm install 20` |
| Docker + Docker Compose | latest | docker.com |
| Git | any | system |

---

## 1. Clone / Unzip the Project

```
automl-platform/
├── backend/
│   ├── app/
│   │   ├── api/v1/        # FastAPI routers
│   │   ├── core/          # Config, logging
│   │   ├── db/            # SQLAlchemy session
│   │   ├── models/        # ORM models
│   │   ├── schemas/       # Pydantic schemas
│   │   ├── services/      # Business logic
│   │   └── main.py
│   ├── alembic/           # DB migrations
│   ├── .env               # Local env (pre-filled)
│   ├── docker-compose.yml # Infrastructure only
│   ├── Dockerfile
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/           # Axios client
    │   ├── components/    # Sidebar, UI
    │   ├── pages/         # All 10 pages
    │   └── styles/        # Global CSS
    ├── index.html
    ├── package.json
    └── vite.config.js
```

---

## 2. Start Infrastructure (Docker)

This gives you PostgreSQL, Redis, and MinIO. The app and worker run locally.

```bash
cd backend
docker compose up -d
```

Verify all containers are healthy:
```bash
docker compose ps
```

Expected output — all should show `healthy`:
```
automl_postgres   Up (healthy)
automl_redis      Up (healthy)
automl_minio      Up (healthy)
automl_flower     Up
```

MinIO web console: http://localhost:9001 (user: minioadmin / pass: minioadmin)
Flower (Celery monitor): http://localhost:5555

---

## 3. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3.11 -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows

# Install dependencies
# NOTE: autogluon is ~5 GB — this takes 5–15 minutes on first install
pip install --upgrade pip wheel setuptools
pip install -r requirements.txt
```

### Verify the .env file

The `.env` file is pre-filled for local dev. Check it matches your setup:
```bash
cat .env
```

No changes needed unless you customised Docker ports.

---

## 4. Run the FastAPI Server

```bash
cd backend
source .venv/bin/activate

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

You should see:
```
INFO  | Starting AutoML Platform  env=development
INFO  | Database tables verified / created
INFO  | MinIO buckets verified
INFO  | Application startup complete.
```

API docs available at: http://localhost:8000/docs

---

## 5. Run the Celery Worker

Open a **new terminal tab** and run:

```bash
cd backend
source .venv/bin/activate

celery -A app.services.worker.celery_app worker \
  --loglevel=info \
  --concurrency=1 \
  -Q celery
```

> **Why concurrency=1?**  
> AutoGluon uses all CPU cores internally. Multiple concurrent workers would cause
> resource contention. One worker per machine is the correct setting.

You should see:
```
[tasks]
  . automl.train

[2024-...] celery@hostname ready.
```

---

## 6. Frontend Setup

Open a **new terminal tab**:

```bash
cd frontend

npm install
npm run dev
```

You should see:
```
  VITE v6.x.x  ready in 300ms
  ➜  Local:   http://localhost:5173/
```

Open http://localhost:5173 in your browser.

---

## 7. End-to-End Test (Quick Smoke Test)

### Step 1: Upload a dataset

1. Navigate to **Datasets** in the sidebar
2. Enter name: `test_data`
3. Select type: `tabular`
4. Upload any CSV file (e.g. the Titanic dataset, iris, etc.)
5. Click **Upload**

You should see the dataset appear in the table with row/col counts and quality score.

### Step 2: Train a model

1. Navigate to **Training**
2. Step 1: Model name = `test_model`, Dataset = `test_data`, Target = your target column
3. Step 2: Preset = `Fast`, Time limit = `120`
4. Click **Start Training**
5. Watch live logs stream in the terminal panel

### Step 3: Check the model

1. Navigate to **Models**
2. Your model should appear with status **Complete**
3. Click the expand arrow to see leaderboard, feature importance, confusion matrix

### Step 4: Generate EDA

1. Navigate to **EDA**
2. Select `test_data`
3. Click **Generate Report**
4. Wait ~60 seconds for ydata-profiling to run
5. The full interactive report appears inline (no CORS errors)

### Step 5: Check system health

1. Navigate to **System Health**
2. PostgreSQL, Redis, and MinIO should show **Connected**
3. InfluxDB and KServe show **Skipped** (not configured) — this is correct and expected

---

## 8. Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://automl:automl@localhost:5432/automl` | Async DB URL |
| `DATABASE_URL_SYNC` | `postgresql+psycopg2://automl:automl@localhost:5432/automl` | Sync DB URL (Celery) |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis broker URL |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO S3 endpoint |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO secret key |
| `INFLUX_TOKEN` | *(empty)* | Leave empty to skip InfluxDB |
| `KSERVE_GATEWAY` | *(empty)* | Leave empty for local-only mode |
| `APP_CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated frontend origins |
| `MAX_UPLOAD_SIZE_MB` | `500` | Max dataset upload size |

---

## 9. Common Issues & Fixes

### "ModuleNotFoundError: No module named 'app'"
Run uvicorn from the `backend/` directory with the venv active.

### "Connection refused" on PostgreSQL/Redis/MinIO
Run `docker compose ps` — containers may still be starting. Wait 10 seconds and retry.

### AutoGluon import errors after install
AutoGluon requires specific numpy/scikit-learn versions it pulls itself. Do NOT manually pin numpy/scikit-learn before AutoGluon installation. Let AutoGluon resolve its own deps first, then pip install the rest.

### EDA report shows blank iframe
The Vite dev server proxies `/api` to `http://localhost:8000`. If you see a blank iframe, check that the FastAPI server is running and the EDA report was generated (check the Flower UI or FastAPI logs).

### Celery worker not picking up tasks
- Check that `REDIS_URL` in `.env` matches your Redis container
- Verify Celery started without errors
- Check http://localhost:5555 (Flower) — tasks should appear there

### "Dataset not found" during training
Ensure the dataset was uploaded successfully — it should appear in the Datasets table with a non-zero row count.

---

## 10. Production Deployment

### Frontend → Vercel

```bash
cd frontend
npm run build           # Creates dist/

# Deploy to Vercel
npx vercel --prod
```

Set `VITE_API_URL` environment variable in Vercel to your backend URL:
```
VITE_API_URL=https://api.yourdomain.com/api/v1
```

### Backend → Docker / Kubernetes

Build the backend image:
```bash
cd backend
docker build -t automl-backend:latest .
```

For Kubernetes, set these env vars via Secrets/ConfigMap and use the provided Dockerfile. The Celery worker runs the same image with a different CMD:
```
CMD: celery -A app.services.worker.celery_app worker --loglevel=info --concurrency=1
```

---

## 11. Service Summary

| Service | URL (local) | Purpose |
|---------|-------------|---------|
| FastAPI | http://localhost:8000 | REST API + EDA/drift proxy |
| API Docs | http://localhost:8000/docs | Interactive Swagger UI |
| Frontend | http://localhost:5173 | React UI |
| MinIO Console | http://localhost:9001 | Object storage browser |
| Flower | http://localhost:5555 | Celery task monitor |
| PostgreSQL | localhost:5432 | Relational DB |
| Redis | localhost:6379 | Task broker + result backend |
