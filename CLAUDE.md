# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概览

针对 16GB Mac (Apple Silicon) 优化的高效语音转字幕系统，使用 Qwen3-ASR 0.6B。目标：内存 ≤1.5GB，RTF <0.02（50倍实时速度）。

**技术栈**: transformers (PyTorch + MPS 后端)、Qwen3-ASR 0.6B、Silero VAD、Pyannote.audio

## 开发命令

### 环境搭建
```bash
# 创建并激活虚拟环境（Python 3.11）
python3.11 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 测试
```bash
# 运行所有测试
pytest

# 仅运行基准测试
pytest --benchmark-only

# 运行特定测试模块
pytest tests/test_pipeline.py -v
```

### 模型下载
```bash
# 模型在首次使用时自动下载到 ~/.cache/huggingface/
# 手动预下载：
huggingface-cli download Qwen/Qwen3-ASR-0.6B

# Silero VAD 在首次使用时自动下载到 ~/.cache/torch/hub/
```

## 架构

### 核心管道 (`src/asr/`)

1. **`preprocessing.py`** - 音频加载与预处理
   - `load_audio()`: 加载音频，重采样至 16kHz，转换为单声道 float32
   - `split_audio()`: 将长音频分块并带重叠，用于流式处理
   - 格式支持：通过 soundfile + librosa 支持 MP3、WAV、M4A、FLAC

2. **`pipeline.py`** - ASR 转录（Qwen3-ASR MLX）
   - 后端：`mlx-lm` + MLX（Apple Silicon 原生优化）
   - 模型：从本地 `models/qwen3-asr-0.6b-mlx-8bit/` 加载
   - 精度：8-bit 量化以提高内存效率
   - `TranscriptionPipeline.transcribe()`: 完整音频转录
   - `transcribe_streaming()`: 分块流式模式
   - `transcribe_file()`: 文件输入的便捷封装

3. **`segmentation.py`** - 字幕句子切分
   - 策略：Silero VAD（语音活动检测）+ 标点规则
   - `SubtitleSegmenter.segment()`: 接收音频 + 全文本 → 带时间戳的字幕片段
   - 强制最小/最大时长（默认单句 5-15 秒）
   - 回退机制：VAD 不可用时纯标点切分

4. **`diarization.py`** - 说话人分离（可选）
   - 引擎：Pyannote MLX 版本（约 31MB 内存开销）
   - 多说话人标注场景使用

### 关键设计决策

- **后端选择**: MLX（而非 PyTorch），使用 Apple Silicon GPU/ANE 加速
- **模型来源**: Soniqo 项目优化的 MLX 量化版本（`aufklarer/*` 命名空间）
- **本地存储**: 所有模型存储在项目 `models/` 目录，不依赖全局缓存
- **懒加载**: VAD 模型通过 `_load_vad()` 在首次使用时加载，以减少启动内存
- **流式模拟**: 通过分块+重叠模拟，非真正的流式推理
- **内存管理**: 显式 `unload()` 方法释放模型

## 常见工作流

### 添加新音频格式
1. 检查 `soundfile` 是否支持（大多数格式开箱即用）
2. 如不支持，在 `preprocessing.load_audio()` 中通过 `librosa` 添加转换

### 调整字幕时长
- 修改 `segmentation.py` 中的 `SegmentationConfig.min_duration_s` / `max_duration_s`
- VAD 阈值：`vad_threshold`、`vad_min_silence_duration_ms`

### 调试内存问题
- 检查后端信息：`pipeline.device_info`
- MLX 会自动管理统一内存，无需手动清理
- 调用 `pipeline.unload()` 释放模型

### 测试转录准确性
- 在 `tests/fixtures/` 中创建测试音频样本
- 使用 `pytest-benchmark` 测量 RTF（参见 `TODO.md` 中的基准测试计划）

## 模型路径

所有模型存储在项目目录下（基于 Soniqo 优化的 MLX/CoreML 版本）：
- Qwen3-ASR: `models/qwen3-asr-0.6b-mlx-8bit/`
- Silero VAD: `models/silero-vad/`
- Pyannote（如使用）: `models/pyannote-segmentation-mlx/`、`models/wespeaker-mlx/`
- ForcedAligner（可选）: `models/qwen3-aligner-4bit/`

注意：使用 Soniqo 项目提供的 MLX 优化版本（`aufklarer/*` 命名空间），针对 Apple Silicon 优化。

## 性能指标（来自 REQUIREMENT.md）

- 内存：不含说话人分离 ≤1.5GB，含 Pyannote ≤1.6GB
- 速度：RTF <0.02（1 分钟音频在 1.2 秒内处理完成）
- 准确率：字幕切句准确率 >90%
- 句子时长：5-15 秒（可配置）
- 说话人分离：双人对话准确率 >85%
