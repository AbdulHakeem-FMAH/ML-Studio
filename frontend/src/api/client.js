import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "/api/v1";

const api = axios.create({
  baseURL: BASE,
  timeout: 120_000,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor ────────────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response interceptor ───────────────────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status  = err.response?.status;
    const message = err.response?.data?.detail || err.message || "An error occurred";

    // Surface a clean error message
    const cleaned     = new Error(message);
    cleaned.status    = status;
    cleaned.original  = err;
    return Promise.reject(cleaned);
  }
);

export default api;

// ── Helper factories ───────────────────────────────────────────────────────────

export const datasets = {
  list:    ()                    => api.get("/datasets").then(r => r.data),
  get:     (id)                  => api.get(`/datasets/${id}`).then(r => r.data),
  preview: (id, rows = 50)       => api.get(`/datasets/${id}/preview?rows=${rows}`).then(r => r.data),
  columns: (id)                  => api.get(`/datasets/${id}/columns`).then(r => r.data),
  quality: (id)                  => api.get(`/datasets/${id}/quality`).then(r => r.data),
  downloadUrl: (id)              => `${BASE}/datasets/${id}/download`,
  delete:  (id)                  => api.delete(`/datasets/${id}`),

  upload: (name, file, owner = "admin") => {
    const fd = new FormData();
    fd.append("name",  name);
    fd.append("owner", owner);
    fd.append("file",  file);
    return api.post("/datasets", fd, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
  },
};

export const database = {
  testConnection: (config) => api.post("/database/test-connection", config).then(r => r.data),
  listDatabases:  (config) => api.post("/database/databases", config).then(r => r.data),
  listTables:     (config) => api.post("/database/tables", config).then(r => r.data),
  ingest:         (config) => api.post("/database/ingest", config).then(r => r.data),
};

export const training = {
  start:      (cfg)     => api.post("/training/start", cfg).then(r => r.data),
  getRun:     (runId)   => api.get(`/training/runs/${runId}`).then(r => r.data),
  modelRuns:  (modelId) => api.get(`/training/model/${modelId}/runs`).then(r => r.data),

  /** Returns an EventSource for SSE log streaming. */
  streamLogs: (runId) => {
    const base = import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL
      : "/api/v1";
    return new EventSource(`${base}/training/runs/${runId}/logs/stream`);
  },
};

export const models = {
  list:            ()        => api.get("/models").then(r => r.data),
  get:             (id)      => api.get(`/models/${id}`).then(r => r.data),
  delete:          (id)      => api.delete(`/models/${id}`),
  schema:          (id)      => api.get(`/models/${id}/schema`).then(r => r.data),
  downloadArtifact: (id)    => api.get(`/models/${id}/download-artifact`).then(r => r.data),
};

export const predictions = {
  single: (modelName, features) =>
    api.post("/predictions/predict", { model_name: modelName, features }).then(r => r.data),

  batch: (modelName, file) => {
    const fd = new FormData();
    fd.append("model_name", modelName);
    fd.append("file", file);
    return api.post("/predictions/batch", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
};

export const eda = {
  generate: (datasetName)  => api.post(`/eda/generate?dataset_name=${encodeURIComponent(datasetName)}`).then(r => r.data),
  status:   (datasetName)  => api.get(`/eda/status/${encodeURIComponent(datasetName)}`).then(r => r.data),
  /** Returns URL to proxy endpoint for iframe embedding */
  reportUrl: (datasetName) => `${BASE}/eda/report/${encodeURIComponent(datasetName)}`,
};

export const drift = {
  list:    ()          => api.get("/drift").then(r => r.data),
  forModel: (modelId)  => api.get(`/drift/${modelId}`).then(r => r.data),
  check:   (data)      => {
    if (data instanceof FormData) {
      return api.post("/drift/check", data, {
        headers: { "Content-Type": "multipart/form-data" },
      }).then(r => r.data);
    }
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v != null) fd.append(k, v);
    });
    return api.post("/drift/check", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  retrain: (payload)   => api.post("/drift/retrain", payload).then(r => r.data),
  delete:  (reportId)  => api.delete(`/drift/${reportId}`),
  reportUrl: (reportId) => `${BASE}/drift/report/${reportId}/html`,
};

export const forecasting = {
  run: (cfg) => api.post("/forecasting", cfg).then(r => r.data),
};

export const deployments = {
  list:   ()           => api.get("/deployments").then(r => r.data),
  get:    (id)         => api.get(`/deployments/${id}`).then(r => r.data),
  create: (cfg)        => api.post("/deployments", cfg).then(r => r.data),
  delete: (id)         => api.delete(`/deployments/${id}`),
  test:   (id, payload) => api.post(`/deployments/${id}/test`, payload).then(r => r.data),
};

export const health = {
  check:    () => api.get("/health").then(r => r.data),
  stats:    () => api.get("/health/stats").then(r => r.data),
  activity: () => api.get("/health/activity").then(r => r.data),
};
