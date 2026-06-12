"""说话人分离：Pyannote.audio 集成（可选）。

按 SDD 选型:
- 标准场景: Pyannote (segmentation 5.7 MB + embedding 25 MB ≈ 31 MB)
- 重叠语音场景: 标注为未来扩展 (Sortformer 240 MB)

Usage:
    diarizer = SpeakerDiarizer()
    speaker_segments = diarizer.diarize(audio, sample_rate=16000)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class DiarizationSegment:
    """说话人分离片段。"""

    speaker: str
    start: float  # seconds
    end: float  # seconds


@dataclass
class DiarizationConfig:
    """说话人分离配置。"""

    # 引擎: "pyannote", "sortformer"（未来）, "none"
    engine: str = "pyannote"
    # 说话人数量（None = 自动检测）
    num_speakers: int | None = None
    # 设备
    device: str = "cpu"


class SpeakerDiarizer:
    """说话人分离器。

    Usage:
        d = SpeakerDiarizer()
        if d.is_available:
            segments = d.diarize(audio, sample_rate=16000)
    """

    def __init__(self, config: DiarizationConfig | None = None):
        self._config = config or DiarizationConfig()
        self._pipeline = None
        self._available = None  # 懒检测

    @property
    def is_available(self) -> bool:
        """检查 Pyannote 是否可用。"""
        if self._available is None:
            try:
                from pyannote.audio import Pipeline

                self._available = True
            except ImportError:
                logger.warning("pyannote.audio not installed; speaker diarization disabled")
                self._available = False
            except Exception as exc:
                logger.warning("pyannote.audio init failed: %s", exc)
                self._available = False
        return self._available

    def diarize(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> list[DiarizationSegment]:
        """对音频执行说话人分离。

        Args:
            audio: float32 音频 [-1, 1]。
            sample_rate: 采样率。

        Returns:
            DiarizationSegment 列表。
        """
        if not self.is_available:
            logger.warning("Diarization not available, returning single speaker")
            duration = len(audio) / sample_rate
            return [DiarizationSegment(speaker="SPEAKER_00", start=0.0, end=duration)]

        if self._pipeline is None:
            self._load_pipeline()

        try:
            # pyannote.audio 3.x API
            # 将 numpy array 转为期望的格式
            import torch

            waveform = torch.from_numpy(audio).unsqueeze(0)
            result = self._pipeline(
                {"waveform": waveform, "sample_rate": sample_rate},
                num_speakers=self._config.num_speakers,
            )

            segments: list[DiarizationSegment] = []
            for turn, _, speaker in result.itertracks(yield_label=True):
                segments.append(
                    DiarizationSegment(
                        speaker=f"SPEAKER_{speaker.split('_')[-1]:0>2s}" if "_" in speaker else speaker,
                        start=round(turn.start, 3),
                        end=round(turn.end, 3),
                    )
                )
            return segments
        except Exception as exc:
            logger.warning("Diarization failed (%s), falling back to single speaker", exc)
            duration = len(audio) / sample_rate
            return [DiarizationSegment(speaker="SPEAKER_00", start=0.0, end=duration)]

    def _load_pipeline(self):
        """加载 Pyannote pipeline。"""
        from pyannote.audio import Pipeline

        # 需要 HuggingFace token 来访问 pyannote 模型
        # 用户可通过环境变量 HF_TOKEN 设置
        try:
            self._pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=True,
            )
            if self._config.device != "cpu":
                import torch
                self._pipeline.to(torch.device(self._config.device))
        except Exception as exc:
            logger.warning(
                "Could not load pyannote pipeline (%s). "
                "Set HF_TOKEN environment variable with a valid HuggingFace token.",
                exc,
            )
            raise


def merge_diarization_with_segments(
    diarization: list[DiarizationSegment],
    segments: list,
) -> list:
    """将说话人分离结果合并到字幕段中。

    Args:
        diarization: 说话人分离段列表。
        segments: SubtitleSegment 列表（带 .start/.end/.speaker 属性）。

    Returns:
        更新了 speaker 字段的 segments。
    """
    if not diarization:
        return segments

    for seg in segments:
        # 找到重叠最多的说话人
        best_speaker = diarization[0].speaker
        max_overlap = 0.0
        for d in diarization:
            overlap_start = max(seg.start, d.start)
            overlap_end = min(seg.end, d.end)
            overlap = max(0.0, overlap_end - overlap_start)
            if overlap > max_overlap:
                max_overlap = overlap
                best_speaker = d.speaker
        seg.speaker = best_speaker

    return segments
