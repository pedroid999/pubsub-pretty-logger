from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pathlib import Path

router = APIRouter(tags=["views"])

# Templates directory
templates = Jinja2Templates(directory=Path("app/templates"))

@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Render the main page."""
    return templates.TemplateResponse(
        "index.html", 
        {"request": request}
    ) 