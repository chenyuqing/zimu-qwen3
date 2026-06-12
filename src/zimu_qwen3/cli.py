"""CLI 入口。"""

import argparse
import logging
from pathlib import Path

from .core.pipeline import TranscriptionPipeline, TranscriptionConfig
from .core.segmentation import SubtitleSegmenter, SegmentationConfig
from .core.export import export_srt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Qwen3-ASR 语音转字幕")
    parser.add_argument("audio", help="音频文件路径")
    parser.add_argument("-o", "--output", help="输出文件路径")
    parser.add_argument("-f", "--format", choices=["srt", "vtt"], default="srt", help="字幕格式")
    parser.add_argument("--min-duration", type=float, default=5.0, help="单句最小时长（秒）")
    parser.add_argument("--max-duration", type=float, default=15.0, help="单句最大时长（秒）")
    parser.add_argument("--no-vad", action="store_true", help="禁用 VAD，仅使用标点切句")

    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        logger.error(f"音频文件不存在: {audio_path}")
        return 1

    # 转录
    logger.info("加载模型...")
    config = TranscriptionConfig()
    pipeline = TranscriptionPipeline(config)

    logger.info("转录中...")
    result = pipeline.transcribe_file(audio_path)
    logger.info(f"转录完成，RTF: {result.rtf:.3f}")

    # 切句
    logger.info("切句中...")
    from .core.preprocessing import load_audio
    audio, sr = load_audio(audio_path, target_sr=16000)

    seg_config = SegmentationConfig(
        min_duration_s=args.min_duration,
        max_duration_s=args.max_duration,
        use_vad=not args.no_vad,
    )
    segmenter = SubtitleSegmenter(seg_config)
    subtitles = segmenter.segment(audio, sr, result.text)

    # 导出
    output_path = Path(args.output) if args.output else audio_path.with_suffix(f".{args.format}")
    srt_content = export_srt(subtitles)
    output_path.write_text(srt_content, encoding="utf-8")
    logger.info(f"字幕已保存: {output_path}")

    return 0


if __name__ == "__main__":
    exit(main())
