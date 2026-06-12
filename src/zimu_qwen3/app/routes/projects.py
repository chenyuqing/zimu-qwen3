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


@upload_router.post("/project/reset")
async def reset_project():
    """清理上传文件，只保留最新3个。"""
    try:
        files = sorted(UPLOAD_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
        for f in files[3:]:
            f.unlink()
        return {"status": "ok", "kept": len(files[:3]), "deleted": len(files[3:])}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@upload_router.post("/correct")
async def correct_subtitles(
    subtitles_json: str = Form(...),
    script_text: str = Form(...),
):
    """字符级对齐校正字幕。"""
    import json
    from difflib import SequenceMatcher

    subtitles = json.loads(subtitles_json)

    # 构建 ASR 文本和字符时间戳映射
    asr_text = ""
    char_times = []  # [(start, end), ...]

    for sub in subtitles:
        text = sub["text"]
        start, end = sub["start"], sub["end"]
        duration = end - start
        char_duration = duration / len(text) if text else 0

        for i, char in enumerate(text):
            asr_text += char
            char_start = start + i * char_duration
            char_end = start + (i + 1) * char_duration
            char_times.append((char_start, char_end))

    # 字符级对齐
    matcher = SequenceMatcher(None, asr_text, script_text)
    script_char_times = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal' or tag == 'replace':
            # 映射时间戳
            for j in range(j1, j2):
                if i1 + (j - j1) < len(char_times):
                    script_char_times.append(char_times[i1 + (j - j1)])
                else:
                    # 超出范围，用最后一个时间
                    script_char_times.append(char_times[-1] if char_times else (0, 0))
        elif tag == 'insert':
            # 脚本插入字符，复用前一个时间
            prev_time = script_char_times[-1] if script_char_times else (0, 0)
            for _ in range(j1, j2):
                script_char_times.append(prev_time)

    # 重新切分句子
    import re
    sentences = re.split(r'([。！？\n])', script_text)
    corrected = []
    idx = 1
    char_pos = 0
    asr_last_end = subtitles[-1]["end"] if subtitles else 0

    for i in range(0, len(sentences), 2):
        sent = sentences[i]
        punct = sentences[i + 1] if i + 1 < len(sentences) else ""
        text = sent + punct

        if not text.strip():
            continue

        # 获取这段文本的时间范围
        start_pos = char_pos
        end_pos = char_pos + len(text)

        if start_pos < len(script_char_times):
            start_time = script_char_times[start_pos][0]
            # 最后一句用 ASR 原始结束时间
            if end_pos >= len(script_char_times):
                end_time = asr_last_end
            else:
                end_time = script_char_times[end_pos - 1][1]

            corrected.append({
                "index": idx,
                "start": round(start_time, 3),
                "end": round(end_time, 3),
                "text": text.strip(),
            })
            idx += 1

        char_pos = end_pos

    return {"corrected_subtitles": corrected}
