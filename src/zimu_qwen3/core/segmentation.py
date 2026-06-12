"""字幕切句：基于 Silero VAD + 标点规则的智能切句。

策略优先级：
1. Silero VAD 检测语音/静音段
2. 按静音段 + 标点符号切句
3. 单句时长限制（默认 5-15 秒）
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# 标点切句模式（中英文通用）
_SENTENCE_END_PAT = re.compile(r"[。！？．!?.\n]")
_PAUSE_PAT = re.compile(r"[，,;；、]")


@dataclass
class SubtitleSegment:
    """字幕片段。"""

    index: int
    start: float  # seconds
    end: float  # seconds
    text: str
    confidence: float = 1.0
    speaker: str | None = None
    words: list[dict] = field(default_factory=list)


@dataclass
class SegmentationConfig:
    """切句配置。"""

    min_duration_s: float = 5.0
    max_duration_s: float = 15.0
    pause_threshold_s: float = 0.5  # 静音阈值
    # Silero VAD 参数
    vad_threshold: float = 0.5
    vad_min_speech_duration_ms: int = 250
    vad_min_silence_duration_ms: int = 300
    # 是否启用 VAD（关闭则纯标点切句）
    use_vad: bool = True
    # 字幕长度限制（横屏42字符，竖屏18字符）
    max_chars_per_line: int = 42


class SubtitleSegmenter:
    """字幕切句器。

    Usage:
        seg = SubtitleSegmenter()
        subtitles = seg.segment(audio, sample_rate=16000, full_text=transcription_text)
    """

    def __init__(self, config: SegmentationConfig | None = None):
        self._config = config or SegmentationConfig()
        self._vad_model = None

    def _load_vad(self):
        """懒加载 Silero VAD 模型。"""
        if self._vad_model is not None:
            return
        try:
            import torch
            self._vad_model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False
            )
            self._vad_get_speech_timestamps = utils[0]
            logger.info("Silero VAD loaded")
        except Exception as exc:
            logger.warning("VAD load failed (%s), falling back to punctuation segmentation", exc)
            self._config.use_vad = False

    def _detect_speech_segments(
        self, audio: np.ndarray, sample_rate: int
    ) -> list[tuple[float, float]]:
        """使用 VAD 检测语音段。

        Returns:
            [(start_s, end_s), ...] 列表。
        """
        self._load_vad()
        if self._vad_model is None:
            # 回退：整个音频作为一段
            return [(0.0, len(audio) / sample_rate)]

        # Silero VAD 需要 torch tensor
        import torch
        audio_tensor = torch.from_numpy(audio)

        speech_timestamps = self._vad_get_speech_timestamps(
            audio_tensor,
            self._vad_model,
            threshold=self._config.vad_threshold,
            min_speech_duration_ms=self._config.vad_min_speech_duration_ms,
            min_silence_duration_ms=self._config.vad_min_silence_duration_ms,
            sampling_rate=sample_rate,
        )
        return [
            (ts["start"] / sample_rate, ts["end"] / sample_rate) for ts in speech_timestamps
        ]

    def _calculate_display_width(self, text: str) -> int:
        """计算文本显示宽度（中文=2，英文=1）。"""
        width = 0
        for char in text:
            width += 2 if '一' <= char <= '鿿' else 1
        return width

    def _split_by_punctuation(
        self, text: str, max_chars: int | None = None
    ) -> list[str]:
        """按标点符号切分文本。

        Args:
            text: 输入文本。
            max_chars: 单句最大显示宽度（中文=2，英文=1），默认使用配置中的值。

        Returns:
            句子列表。
        """
        if max_chars is None:
            max_chars = self._config.max_chars_per_line

        # 检测是否主要是英文（超过50%是ASCII字符）
        ascii_count = sum(1 for c in text if ord(c) < 128)
        is_english = ascii_count > len(text) * 0.5

        # 英文无标点时按单词切分
        if is_english and not _SENTENCE_END_PAT.search(text):
            words = text.split()
            sentences = []
            current = ""
            for word in words:
                test = (current + " " + word).strip()
                if current and self._calculate_display_width(test) > max_chars:
                    sentences.append(current)
                    current = word
                else:
                    current = test
            if current:
                sentences.append(current)
            return sentences

        # 中文或有标点的文本按标点切分
        raw_parts = _SENTENCE_END_PAT.split(text)

        sentences: list[str] = []
        for part in raw_parts:
            part = part.strip()
            if not part:
                continue

            part_width = self._calculate_display_width(part)
            if part_width > max_chars:
                # 按逗号切分
                sub_parts = _PAUSE_PAT.split(part)
                current_chunk = ""

                for sp in sub_parts:
                    sp = sp.strip()
                    if not sp:
                        continue

                    sp_width = self._calculate_display_width(sp)

                    # 单个片段超限，尝试按空格（英文单词）切分
                    if sp_width > max_chars:
                        if current_chunk:
                            sentences.append(current_chunk)
                            current_chunk = ""

                        # 英文按单词切分
                        words = sp.split()
                        if len(words) > 1:
                            word_chunk = ""
                            for word in words:
                                test = (word_chunk + " " + word).strip()
                                if word_chunk and self._calculate_display_width(test) > max_chars:
                                    sentences.append(word_chunk)
                                    word_chunk = word
                                else:
                                    word_chunk = test
                            if word_chunk:
                                sentences.append(word_chunk)
                        else:
                            sentences.append(sp)
                        continue

                    test_chunk = (current_chunk + "，" + sp) if current_chunk else sp
                    test_width = self._calculate_display_width(test_chunk)

                    if current_chunk and test_width > max_chars:
                        sentences.append(current_chunk)
                        current_chunk = sp
                    elif current_chunk:
                        current_chunk += "，" + sp
                    else:
                        current_chunk = sp

                if current_chunk:
                    sentences.append(current_chunk)
            else:
                sentences.append(part)

        return sentences

    def segment(
        self,
        audio: np.ndarray,
        sample_rate: int,
        full_text: str,
        asr_segments: list[dict] | None = None,
    ) -> list[SubtitleSegment]:
        """对音频 + 转录文本执行切句。"""
        text_sentences = self._split_by_punctuation(full_text)
        if not text_sentences:
            return []

        # 使用MLX Qwen3 ForcedAligner获取词级时间戳
        try:
            from mlx_audio.stt import load
            aligner = load('models/qwen3-aligner')
            result = aligner.generate(audio, text=full_text)
            return self._map_word_items_to_sentences_smart(text_sentences, result.items)

        except Exception as e:
            logger.warning(f"Forced alignment failed: {e}, using energy-based timing")
            return self._segment_with_energy_adjustment(text_sentences, audio, sample_rate)

    def _normalize_text(self, text: str) -> str:
        """标准化文本用于匹配（移除标点和空格）。"""
        import re
        # 移除所有标点和空格
        return re.sub(r'[，。、！？；：""''（）\s]+', '', text)

    def _map_word_items_to_sentences_smart(
        self, text_sentences: list[str], word_items: list
    ) -> list[SubtitleSegment]:
        """智能匹配：ASR句子 → Aligner items。"""
        if not word_items or not text_sentences:
            return []

        # 构建aligner文本
        aligner_text = "".join(item.text for item in word_items)
        aligner_normalized = self._normalize_text(aligner_text)

        subtitles = []
        aligner_pos = 0  # 在aligner_normalized中的字符位置

        for i, sentence in enumerate(text_sentences):
            sentence_normalized = self._normalize_text(sentence)
            sentence_len = len(sentence_normalized)

            # 找到这个句子在aligner中的起始位置
            target_pos = aligner_pos + sentence_len

            # 计算对应的item索引范围
            chars_counted = 0
            start_item_idx = None
            end_item_idx = None

            for idx, item in enumerate(word_items):
                item_len = len(self._normalize_text(item.text))

                if start_item_idx is None and chars_counted >= aligner_pos:
                    start_item_idx = idx

                chars_counted += item_len

                if chars_counted >= target_pos:
                    end_item_idx = idx
                    break

            # 如果循环结束还没找到结束位置，用最后一个item
            if start_item_idx is not None and end_item_idx is None and word_items:
                end_item_idx = len(word_items) - 1

            if start_item_idx is not None and end_item_idx is not None:
                subtitles.append(
                    SubtitleSegment(
                        index=i + 1,
                        start=round(word_items[start_item_idx].start_time, 3),
                        end=round(word_items[end_item_idx].end_time, 3),
                        text=sentence,
                    )
                )

            aligner_pos = target_pos

        return subtitles

    def _map_word_items_to_sentences(
        self, text_sentences: list[str], word_items: list
    ) -> list[SubtitleSegment]:
        """将ForcedAligner的词级时间戳映射到句子（顺序匹配）。"""
        if not word_items or not text_sentences:
            return []

        subtitles = []
        item_idx = 0

        for i, sentence in enumerate(text_sentences):
            sentence_chars = sentence.replace(" ", "")
            start_idx = item_idx
            chars_matched = 0

            # 顺序消耗word_items直到匹配完这个句子
            while item_idx < len(word_items) and chars_matched < len(sentence_chars):
                item_text = word_items[item_idx].text.replace(" ", "")
                chars_matched += len(item_text)
                item_idx += 1

            # 获取这个句子的时间范围
            if start_idx < item_idx and start_idx < len(word_items):
                end_idx = min(item_idx - 1, len(word_items) - 1)
                subtitles.append(
                    SubtitleSegment(
                        index=i + 1,
                        start=round(word_items[start_idx].start_time, 3),
                        end=round(word_items[end_idx].end_time, 3),
                        text=sentence,
                    )
                )

        return subtitles

    def _segment_with_energy_adjustment(
        self, text_sentences: list[str], audio: np.ndarray, sample_rate: int
    ) -> list[SubtitleSegment]:
        """基于音频能量分布分配时间。"""
        duration = len(audio) / sample_rate
        total_chars = sum(len(s) for s in text_sentences)

        if total_chars == 0:
            return []

        # 计算音频能量（50ms帧）
        frame_size = int(sample_rate * 0.05)
        hop_size = frame_size // 2
        energy = []
        for i in range(0, len(audio) - frame_size, hop_size):
            frame = audio[i:i + frame_size]
            energy.append(np.sqrt(np.mean(frame ** 2)))

        energy = np.array(energy)
        if energy.max() > 0:
            energy = energy / energy.max()

        # 累积能量 - 高能量区域对应语音密集区
        cumulative_energy = np.cumsum(energy)
        total_energy = cumulative_energy[-1] if len(cumulative_energy) > 0 else 1.0

        subtitles = []
        current_char = 0

        for i, text in enumerate(text_sentences):
            text_len = len(text)
            next_char = current_char + text_len

            # 按字符比例映射到累积能量
            target_energy_ratio = next_char / total_chars
            target_cumulative = target_energy_ratio * total_energy

            # 找到对应的时间点
            frame_idx = np.searchsorted(cumulative_energy, target_cumulative)
            frame_idx = min(frame_idx, len(energy) - 1)

            end_time = (frame_idx * hop_size) / sample_rate
            start_time = subtitles[-1].end if subtitles else 0.0

            subtitles.append(
                SubtitleSegment(
                    index=i + 1,
                    start=round(start_time, 3),
                    end=round(min(end_time, duration), 3),
                    text=text,
                )
            )
            current_char = next_char

        # 确保最后一句到音频结尾
        if subtitles:
            subtitles[-1].end = round(duration, 3)

        return subtitles

    def _map_words_to_sentences(
        self, text_sentences: list[str], word_timestamps: list[dict]
    ) -> list[SubtitleSegment]:
        """将词级时间戳映射到句子。"""
        subtitles = []
        word_idx = 0

        for i, sentence in enumerate(text_sentences):
            # 找到句子中的所有单词
            sentence_words = sentence.split()
            if not sentence_words:
                continue

            sentence_start = None
            sentence_end = None

            # 匹配词级时间戳
            matched_words = 0
            while word_idx < len(word_timestamps) and matched_words < len(sentence_words):
                word_info = word_timestamps[word_idx]
                if sentence_start is None:
                    sentence_start = word_info["start"]
                sentence_end = word_info["end"]
                word_idx += 1
                matched_words += 1

            if sentence_start is not None and sentence_end is not None:
                subtitles.append(
                    SubtitleSegment(
                        index=i + 1,
                        start=round(sentence_start, 3),
                        end=round(sentence_end, 3),
                        text=sentence,
                    )
                )

        return subtitles if subtitles else self._fallback_proportional(text_sentences, len(word_timestamps) * 0.5)

    def _align_with_asr_segments(
        self, text_sentences: list[str], asr_segments: list[dict]
    ) -> list[SubtitleSegment]:
        """使用ASR segments的时间戳对齐文本句子。"""
        subtitles = []

        # 合并所有ASR segment文本
        asr_full_text = " ".join(seg.get("text", "").strip() for seg in asr_segments)

        # 计算每个sentence在完整文本中的字符位置
        current_pos = 0
        sentence_positions = []
        for sent in text_sentences:
            sentence_positions.append(current_pos)
            current_pos += len(sent)

        total_chars = current_pos

        # 根据字符位置映射到ASR segments的时间
        for i, text in enumerate(text_sentences):
            char_start = sentence_positions[i]
            char_end = char_start + len(text)

            # 计算这个句子的时间范围（按字符比例）
            char_ratio_start = char_start / total_chars if total_chars > 0 else 0
            char_ratio_end = char_end / total_chars if total_chars > 0 else 1

            # 找到对应的ASR segment时间范围
            asr_start = asr_segments[0]["start"]
            asr_end = asr_segments[-1]["end"]
            asr_duration = asr_end - asr_start

            start_time = asr_start + char_ratio_start * asr_duration
            end_time = asr_start + char_ratio_end * asr_duration

            subtitles.append(
                SubtitleSegment(
                    index=i + 1,
                    start=round(start_time, 3),
                    end=round(end_time, 3),
                    text=text,
                )
            )

        return subtitles

    def _fallback_proportional(self, text_sentences, duration):
        """按文本长度比例分配时间的回退方法。"""
        total_chars = sum(len(s) for s in text_sentences)
        subtitles = []
        current_time = 0.0

        for i, text in enumerate(text_sentences):
            char_ratio = len(text) / total_chars
            segment_duration = duration * char_ratio

            start = current_time
            end = current_time + segment_duration

            subtitles.append(
                SubtitleSegment(
                    index=i + 1,
                    start=round(start, 3),
                    end=round(end, 3),
                    text=text,
                )
            )
            current_time = end

        return subtitles


# ── Convenience ────────────────────────────────────────────

def segment_subtitles(
    audio: np.ndarray,
    sample_rate: int,
    full_text: str,
    *,
    min_duration: float = 5.0,
    max_duration: float = 15.0,
    use_vad: bool = True,
    max_chars_per_line: int = 42,
) -> list[SubtitleSegment]:
    """便捷函数：音频 + 文本 → 字幕片段。"""
    cfg = SegmentationConfig(
        min_duration_s=min_duration,
        max_duration_s=max_duration,
        use_vad=use_vad,
        max_chars_per_line=max_chars_per_line,
    )
    segmenter = SubtitleSegmenter(cfg)
    return segmenter.segment(audio, sample_rate, full_text)
