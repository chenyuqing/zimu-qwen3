from fastapi import APIRouter, File, UploadFile, Form, BackgroundTasks
from fastapi.responses import JSONResponse
import uuid
import asyncio
from pathlib import Path
from typing import Optional

router = APIRouter(prefix="/api/projects")
upload_router = APIRouter()

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# 任务状态存储
tasks = {}

@upload_router.post("/upload")
async def upload_file_compat(file: UploadFile = File(...)):
    """兼容前端 /upload 端点。"""
    if not file.filename:
        return {"error": "No file provided"}

    file_id = uuid.uuid4().hex[:8]
    filename = f"{file_id}_{file.filename}"
    upload_path = UPLOAD_DIR / filename

    with upload_path.open("wb") as f:
        content = await file.read()
        f.write(content)

    return {
        "task_id": file_id,
        "filename": filename,
        "url": f"/uploads/{filename}",
    }

async def transcribe_task(task_id: str, filename: str, language: str, max_width: int):
    """后台转录任务。"""
    try:
        tasks[task_id] = {"status": "processing", "subtitles": []}

        from zimu_qwen3.core.pipeline import TranscriptionPipeline, TranscriptionConfig
        from zimu_qwen3.core.segmentation import SubtitleSegmenter, SegmentationConfig
        from zimu_qwen3.core.preprocessing import load_audio
        import subprocess
        import json

        upload_path = UPLOAD_DIR / filename

        # 检测视频分辨率判断横竖屏
        max_chars = 42  # 默认横屏
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "json", str(upload_path)],
                capture_output=True, text=True, timeout=10
            )
            if probe.returncode == 0:
                info = json.loads(probe.stdout)
                if info.get("streams"):
                    width = info["streams"][0].get("width", 1920)
                    height = info["streams"][0].get("height", 1080)
                    max_chars = 18 if height > width else 42
        except:
            pass

        # 转录（一次性完成）
        config = TranscriptionConfig()
        pipeline = TranscriptionPipeline(config)
        result = pipeline.transcribe_file(upload_path)

        # 切句
        audio, sr = load_audio(upload_path, target_sr=16000)
        seg_config = SegmentationConfig(use_vad=False, max_chars_per_line=max_chars)
        segmenter = SubtitleSegmenter(seg_config)
        subtitles = segmenter.segment(audio, sr, result.text)

        # 转换为前端格式
        subtitle_data = [
            {
                "index": s.index,
                "start": s.start,
                "end": s.end,
                "text": s.text,
            }
            for s in subtitles
        ]

        # 生成 SRT
        from zimu_qwen3.core.export import export_srt
        srt_content = export_srt(subtitles)
        srt_path = OUTPUT_DIR / f"{task_id}.srt"
        srt_path.write_text(srt_content, encoding="utf-8")

        tasks[task_id] = {
            "status": "completed",
            "subtitles": subtitle_data,
            "srt_url": f"/outputs/{task_id}.srt",
        }

    except Exception as e:
        tasks[task_id] = {"status": "error", "error": str(e)}

@upload_router.post("/transcribe")
async def transcribe(
    background_tasks: BackgroundTasks,
    filename: str = Form(...),
    language: str = Form("auto"),
    max_width: str = Form("40"),
    original_filename: Optional[str] = Form(None),
    time_ranges: Optional[str] = Form(None),
    existing_subtitles: Optional[str] = Form(None),
):
    """开始转录任务。"""
    task_id = uuid.uuid4().hex[:8]
    background_tasks.add_task(transcribe_task, task_id, filename, language, int(max_width))
    return {"task_id": task_id}

@upload_router.get("/status/{task_id}")
async def get_status(task_id: str):
    """查询任务状态。"""
    if task_id not in tasks:
        return JSONResponse(status_code=404, content={"error": "Task not found"})
    return tasks[task_id]

@upload_router.post("/translate")
async def translate_subtitles(
    subtitles_json: str = Form(...),
    target_lang: str = Form("Chinese"),
    api_key: Optional[str] = Form(None),
    translate_base_url: Optional[str] = Form(None),
    translate_model: Optional[str] = Form(None),
    system_prompt: Optional[str] = Form(None),
    task_id: Optional[str] = Form(None),
):
    """翻译字幕（简单版：直接返回原文作为占位）。"""
    import json
    subtitles = json.loads(subtitles_json)

    # TODO: 实现真正的翻译逻辑
    # 目前返回原文
    translated = [
        {
            "index": s["index"],
            "start": s["start"],
            "end": s["end"],
            "text": f"[{target_lang}] {s['text']}",
        }
        for s in subtitles
    ]

    return {"translated_subtitles": translated}
