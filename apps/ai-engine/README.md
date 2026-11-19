# SentinelAI AI Engine

FastAPI service for provider adapters, evaluation pipelines, and risk-analysis workloads.

## Local run

From this directory:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Health endpoint: `GET /health`.

The service currently exposes health metadata only. Evaluation and provider endpoints will be added with explicit authorization, quotas, and audit context.
