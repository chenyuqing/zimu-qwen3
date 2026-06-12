from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .routes.transcribe import router as transcribe_router
from .routes.projects import router as projects_router, upload_router

STATIC_DIR = Path(__file__).parent.parent / "static"
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)


def create_app() -> FastAPI:
    """创建 FastAPI 应用。"""
    app = FastAPI(title="Zimu Qwen3")
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
    app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
    app.include_router(upload_router)  # 新的 API（优先）
    app.include_router(transcribe_router)  # 旧路由（首页和下载）
    app.include_router(projects_router)
    return app


app = create_app()
