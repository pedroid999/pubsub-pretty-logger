import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv
from pathlib import Path

# Import routes
from app.routes.api import router as api_router
from app.routes.views import router as views_router

# Load environment variables
load_dotenv()

# Create FastAPI app
app = FastAPI(
    title="Pub/Sub Pretty Logger",
    description="A beautiful way to monitor Google Cloud Pub/Sub messages",
    version="1.0.0"
)

# Mount static files
app.mount("/static", StaticFiles(directory=Path("app/static")), name="static")

# Include routers
app.include_router(views_router)
app.include_router(api_router, prefix="/api")

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app", 
        host="0.0.0.0", 
        port=int(os.getenv("PORT", "8000")),
        reload=True
    ) 