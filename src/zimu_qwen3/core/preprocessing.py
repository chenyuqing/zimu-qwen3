"""音频预处理：重采样、归一化、分块、格式转换。"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


@dataclass
class AudioChunk:
    """音频块，包含采样数据和元信息。"""

    audio: np.ndarray
    sample_rate: int
    start_offset: float  # 在原始音频中的起始偏移（秒）
    chunk_index: int


def load_audio(
    path: str | Path,
    target_sr: int = 16000,
    mono: bool = True,
) -> tuple[np.ndarray, int]:
    """加载音频文件并重采样到目标采样率。

    Args:
        path: 音频文件路径。
        target_sr: 目标采样率，默认 16000 Hz（Qwen3-ASR 要求）。
        mono: 是否转为单声道。

    Returns:
        (audio_array, sample_rate) 元组。audio 为 float32 [-1, 1]。
    """
    path = Path(path)

    # 如果是视频格式，用 ffmpeg 提取音频
    if path.suffix.lower() in ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv']:
        import subprocess
        import tempfile

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            tmp_path = tmp.name

        try:
            subprocess.run([
                'ffmpeg', '-i', str(path),
                '-ar', str(target_sr),
                '-ac', '1' if mono else '2',
                '-f', 'wav', tmp_path, '-y'
            ], check=True, capture_output=True)

            audio, sr = sf.read(tmp_path, dtype="float32", always_2d=False)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
    else:
        audio, sr = sf.read(str(path), dtype="float32", always_2d=False)

        if mono and audio.ndim > 1:
            audio = audio.mean(axis=1).astype(np.float32)

        if sr != target_sr:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            sr = target_sr

    # 归一化到 [-1, 1]
    peak = np.abs(audio).max()
    if peak > 0:
        audio = audio / max(peak, 1.0)

    return audio.astype(np.float32), sr


def normalize_audio(audio: np.ndarray, target_db: float = -3.0) -> np.ndarray:
    """音频归一化到目标 dB 电平。

    Args:
        audio: 输入音频。
        target_db: 目标峰值 dB，默认 -3 dBFS。

    Returns:
        归一化后的音频。
    """
    rms = np.sqrt(np.mean(audio**2)) + 1e-10
    target_rms = 10 ** (target_db / 20.0)
    gain = target_rms / rms
    return (audio * gain).astype(np.float32)


def split_audio(
    audio: np.ndarray,
    sample_rate: int,
    chunk_duration_s: float = 30.0,
    overlap_s: float = 1.0,
) -> list[AudioChunk]:
    """将长音频分块，支持重叠。

    Args:
        audio: 输入音频。
        sample_rate: 采样率。
        chunk_duration_s: 每块时长（秒），默认 30。
        overlap_s: 相邻块重叠时长（秒），默认 1。

    Returns:
        AudioChunk 列表。
    """
    chunk_samples = int(chunk_duration_s * sample_rate)
    overlap_samples = int(overlap_s * sample_rate)
    stride = chunk_samples - overlap_samples

    if len(audio) <= chunk_samples:
        return [
            AudioChunk(
                audio=audio, sample_rate=sample_rate, start_offset=0.0, chunk_index=0
            )
        ]

    chunks: list[AudioChunk] = []
    idx = 0
    start_sample = 0
    while start_sample < len(audio):
        end_sample = min(start_sample + chunk_samples, len(audio))
        chunk_audio = audio[start_sample:end_sample]
        chunks.append(
            AudioChunk(
                audio=chunk_audio,
                sample_rate=sample_rate,
                start_offset=start_sample / sample_rate,
                chunk_index=idx,
            )
        )
        start_sample += stride
        idx += 1

    return chunks


def get_audio_info(path: str | Path) -> dict:
    """获取音频文件信息。

    Returns:
        包含 duration, sample_rate, channels, format 的字典。
    """
    info = sf.info(str(path))
    return {
        "duration": info.duration,
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "format": info.format,
        "frames": info.frames,
    }
