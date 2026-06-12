"""ASR 转录管道：封装 Qwen3-ASR 模型的加载与推理。

后端：MLX Audio（Apple Silicon 优化）

按 SDD 选型: Qwen3-ASR 0.6B 8-bit（内存 1.3 GB, WER 1.82%, RTF 0.015）。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

import mlx.core as mx
import numpy as np

logger = logging.getLogger(__name__)


# ── Data types ──────────────────────────────────────────────

@dataclass
class WordTimestamp:
    """词级时间戳。"""
    word: str
    start: float  # seconds
    end: float  # seconds
    confidence: float = 1.0


@dataclass
class Segment:
    """转录片段。"""
    start: float  # seconds
    end: float  # seconds
    text: str
    words: list[WordTimestamp] = field(default_factory=list)
    confidence: float = 1.0
    speaker: str | None = None  # 说话人标签（可选）


@dataclass
class TranscriptionResult:
    """完整转录结果。"""
    text: str  # 全文本
    segments: list[Segment] = field(default_factory=list)
    language: str = ""
    duration_seconds: float = 0.0
    processing_time_seconds: float = 0.0

    @property
    def rtf(self) -> float:
        """Real-Time Factor。"""
        if self.duration_seconds <= 0:
            return 0.0
        return self.processing_time_seconds / self.duration_seconds


@dataclass
class TranscriptionConfig:
    """转录配置。"""
    model_path: str = "models/qwen3-asr-0.6b-mlx-8bit"
    # 采样率 (Qwen3-ASR 要求 16kHz)
    sample_rate: int = 16000
    # 流式模式块大小（秒）
    streaming_chunk_size_s: float = 10.0
    # 语言（None = 自动检测）
    language: str | None = None


# ── Pipeline ────────────────────────────────────────────────

class TranscriptionPipeline:
    """Qwen3-ASR MLX 转录管道。

    Usage:
        cfg = TranscriptionConfig()
        pipe = TranscriptionPipeline(cfg)
        result = pipe.transcribe("audio.wav")
        print(result.text)
    """

    def __init__(self, config: TranscriptionConfig | None = None):
        self._config = config or TranscriptionConfig()
        self._model = None
        self._processor = None
        self._loaded = False

    # ── model loading ──────────────────────────────────────

    def load(self) -> None:
        """加载 MLX 模型和处理器。"""
        if self._loaded:
            return

        logger.info("Loading %s (MLX Audio)...", self._config.model_path)
        t0 = time.monotonic()

        # 使用 mlx_audio.stt 加载模型
        from mlx_audio.stt import load_model
        self._model = load_model(self._config.model_path)
        self._processor = None  # mlx_audio models have built-in processor

        elapsed = time.monotonic() - t0
        logger.info("Model loaded in %.1fs", elapsed)
        self._loaded = True

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def device_info(self) -> dict:
        return {
            "backend": "mlx",
            "model_path": self._config.model_path,
        }

    # ── transcribe ─────────────────────────────────────────

    def transcribe(
        self,
        audio: np.ndarray,
        *,
        sample_rate: int | None = None,
        return_timestamps: bool = False,
    ) -> TranscriptionResult:
        """对音频执行全量转录。

        Args:
            audio: float32 音频数组 [-1, 1]。
            sample_rate: 音频采样率（None 则用 config.sample_rate）。
            return_timestamps: 是否请求词级时间戳。

        Returns:
            TranscriptionResult。
        """
        self.load()
        sr = sample_rate or self._config.sample_rate

        t0 = time.monotonic()
        duration = len(audio) / sr

        # 转换为 MLX array
        audio_mx = mx.array(audio)

        # 使用 generate_transcription
        from mlx_audio.stt.generate import generate_transcription
        result = generate_transcription(
            model=self._model,
            audio=audio_mx,
            output_path="/tmp/transcript",
            format="txt",
        )

        # 提取转录文本
        if hasattr(result, 'text'):
            text = result.text
        elif isinstance(result, list) and len(result) > 0:
            text = " ".join(seg.get('text', '') for seg in result)
        else:
            text = str(result)

        elapsed = time.monotonic() - t0

        return TranscriptionResult(
            text=text.strip(),
            segments=[],
            language=self._config.language or "auto",
            duration_seconds=duration,
            processing_time_seconds=elapsed,
        )

    def transcribe_file(
        self,
        path: str | Path,
        *,
        return_timestamps: bool = False,
    ) -> TranscriptionResult:
        """转录音频文件。"""
        from .preprocessing import load_audio

        audio, sr = load_audio(path, target_sr=self._config.sample_rate)
        result = self.transcribe(audio, sample_rate=sr, return_timestamps=return_timestamps)
        return result

    # ── streaming ──────────────────────────────────────────

    def transcribe_streaming(
        self,
        audio: np.ndarray,
        *,
        sample_rate: int | None = None,
        return_partial: bool = False,
    ) -> Iterator[str]:
        """流式转录生成器。

        每次 yield 一个增量文本片段。

        Args:
            audio: 完整音频或音频块。
            sample_rate: 采样率。
            return_partial: 是否返回中间部分结果（--partial 模式）。

        Yields:
            逐步完整的转录文本。
        """
        from .preprocessing import split_audio

        sr = sample_rate or self._config.sample_rate
        chunks = split_audio(audio, sr, chunk_duration_s=self._config.streaming_chunk_size_s, overlap_s=2.0)

        accumulated = ""
        for chunk in chunks:
            result = self.transcribe(chunk.audio, sample_rate=sr)
            if accumulated:
                accumulated += " " + result.text
            else:
                accumulated = result.text

            if return_partial:
                yield accumulated

        if not return_partial:
            yield accumulated

    def unload(self) -> None:
        """释放模型内存。"""
        self._model = None
        self._processor = None
        self._loaded = False


# ── Convenience ────────────────────────────────────────────

def create_pipeline(
    model_path: str = "models/qwen3-asr-0.6b-mlx-8bit",
) -> TranscriptionPipeline:
    """快速创建转录管道。"""
    cfg = TranscriptionConfig(model_path=model_path)
    return TranscriptionPipeline(cfg)
