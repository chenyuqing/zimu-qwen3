from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates

logger = logging.getLogger(__name__)

router = APIRouter()

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/")
async def index(request: Request):
    """主页：上传界面。"""
    return templates.TemplateResponse(request, "index.html", {})


# 旧的 /transcribe 端点已移除，使用 projects.py 中的新端点


@router.get("/download/{filename}")
async def download(filename: str):
    """下载字幕文件。"""
    file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        return {"error": "文件不存在"}
    return FileResponse(file_path, filename=filename)
