from datetime import datetime, timezone

from fastapi import FastAPI

app = FastAPI(
    title="SentinelAI Engine",
    description="AI evaluation and risk intelligence service",
    version="0.1.0",
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "sentinelai-ai-engine",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": app.version,
    }
