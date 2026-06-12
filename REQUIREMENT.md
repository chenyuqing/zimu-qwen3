# Mac 16GB 运行 Qwen3-ASR 最优配置方案

## 背景

需要在 Mac 16GB 内存环境下部署 Qwen3-ASR 语音识别模型，要求同时满足高效率和高准确度。

## 目标

确定最适合 Mac 16GB 配置的模型版本和推理框架组合。

## 技术分析

### 模型选项对比（Apple Silicon）

| 模型 | 框架 | 量化 | RTF | 内存占用 | WER | 模型大小 |
|------|------|------|-----|---------|-----|------------|
| **Qwen3-ASR 0.6B** | **MLX** | **4-bit** | **0.012** | **1.0 GB** | **2.20%** | **680 MB** |
| Qwen3-ASR 0.6B | MLX | 8-bit | 0.015 | 1.3 GB | 1.82% | 1.0 GB |
| Qwen3-ASR 1.7B | MLX | 8-bit | 0.033 | 2.7 GB | 1.52% | 3.2 GB |
| Qwen3-ASR 1.7B | MLX | 4-bit | - | ~2.1 GB | - | 2.1 GB |
| Qwen3-ASR 0.6B | CoreML | INT8 | 0.098 | 1.4 GB | 3.02% | 180 MB |

**RTF (Real-Time Factor)**: 小于 1.0 表示处理速度快于实时播放

### 推荐方案

**16GB Mac 最优配置**：
- **模型**: Qwen3-ASR 0.6B
- **框架**: MLX
- **量化**: 8-bit（平衡准确度和性能）

**理由**：
1. **内存安全**: 1.3 GB 峰值内存，为系统和其他应用留足空间
2. **准确度**: WER 1.82%，仅比 1.7B 模型低 0.3 个百分点
3. **速度**: RTF 0.015（67倍实时速度），响应极快
4. **框架优势**: MLX 针对 Apple Silicon GPU 优化，比 CoreML 快 6.5 倍

**备选方案**（极限性能）：
- Qwen3-ASR 0.6B MLX 4-bit：RTF 0.012，内存 1.0 GB，WER 2.20%（准确度略降 0.38%）

**不推荐**：
- 1.7B 模型：内存占用 2.7 GB，在 16GB 系统中可能导致内存压力
- CoreML 方案：速度慢（RTF 0.098），准确度最差（WER 3.02%）

## 字幕切句方案

ASR 模型输出连续文本，需要额外处理实现准确切句：

### 方案 1：基于 VAD + 标点预测
```python
# 使用 Silero VAD 检测静音段(假设模型已加载)
speech_segments = vad_model(audio, return_seconds=True)

# 按静音段切分转录
for segment in speech_segments:
    text = asr_model.transcribe(segment)
```

**优点**：切句位置与语音停顿自然对应，内存开销小（~10MB）

### 方案 2：使用词级时间戳切句
```python
result = asr_model.transcribe(audio, word_timestamps=True)

# 根据时间间隔切句（间隔 > 0.5s 视为句子边界）
sentences = []
current = []
for word in result['words']:
    current.append(word)
    if word['end'] - word['start'] > 0.5:
        sentences.append(current)
        current = []
```

**优点**：无需额外模型，基于实际停顿，可调节阈值

### 方案 3：集成 Soniqo 强制对齐
```python
# 假设音频和模型已准备好
text = asr_model.transcribe(audio)
alignment = align_audio(audio, text)
sentences = split_by_pause_and_punctuation(alignment.words, pause_threshold=0.3)
```

**优点**：时间戳精度 ±50ms，适合专业字幕制作

### 推荐配置

**标准方案**：方案 1（VAD + 标点预测）
- 适用场景：新闻、访谈、演讲
- 内存增量：~10MB

**高精度方案**：方案 3（Soniqo 对齐）
- 适用场景：电影、纪录片、专业字幕
- 内存增量：~50MB

## 说话人分离方案（可选）

多人对话场景下，需要标注不同说话人，可选集成以下方案：

### 方案对比

| 引擎 | 模型大小 | 内存占用 | 流式支持 | 重叠语音 | 适用场景 |
|------|---------|---------|---------|---------|---------| 
| **Pyannote** | **31 MB** | **~50 MB** | **否** | 较差 | 访谈、演讲 |
| Sortformer | 240 MB | ~300 MB | 是 | 优秀 | 会议、辩论 |

### 推荐配置

**标准场景**（推荐）：Pyannote
```python
# 假设已加载必要的模型
result = diarize(audio, engine="pyannote", num_speakers=2)
# 输出: [{speaker: "SPEAKER_00", start: 0.0, end: 2.5, text: "..."}]
```

**优势**：
- 内存占用仅 50 MB，适合 16GB Mac
- 自动检测说话人数量
- 非重叠语音精度高

**重叠语音场景**：Sortformer
```python
result = diarize(audio, engine="sortformer", streaming=True)
```

**优势**：
- 端到端实时分离，精度更高
- 支持流式处理（FIFO + 说话人缓存）
- 更好处理多人同时说话

**劣势**：内存占用 300 MB，需权衡内存预算

### 完整管道示例

```python
# ASR + 切句 + 说话人分离(假设所有模型和函数已准备)
text = asr_model.transcribe(audio, word_timestamps=True)
alignment = align_audio(audio, text)
diarization = diarize(audio, engine="pyannote")

# 合并结果
subtitles = merge_transcription_and_speakers(alignment, diarization)
# 输出: [{speaker: "SPEAKER_00", start: 0.0, end: 2.5, text: "你好"}]
```

## 模型下载清单

### 必需模型

#### 1. Qwen3-ASR 0.6B (MLX 8-bit)
- **用途**: 语音识别主模型
- **大小**: 1.0 GB
- **下载方式**: 
  ```bash
  # 下载到项目 models/ 目录
  huggingface-cli download aufklarer/Qwen3-ASR-0.6B-MLX-8bit --local-dir models/qwen3-asr-0.6b-mlx-8bit
  ```
- **存放位置**: `models/qwen3-asr-0.6b-mlx-8bit/`
- **下载链接**: https://huggingface.co/aufklarer/Qwen3-ASR-0.6B-MLX-8bit

#### 2. Silero VAD v5
- **用途**: 语音活动检测（切句）
- **大小**: ~10 MB
- **下载方式**: 
  ```bash
  # 下载到项目 models/ 目录
  mkdir -p models/silero-vad
  wget https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.jit -O models/silero-vad/silero_vad.jit
  wget https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx -O models/silero-vad/silero_vad.onnx
  ```
- **存放位置**: `models/silero-vad/`
- **下载链接**: https://github.com/snakers4/silero-vad

### 可选模型

#### 3. Pyannote Speaker Diarization (MLX)
- **用途**: 说话人分离（标准场景）
- **大小**: ~31 MB
- **下载方式**: 
  ```bash
  # 下载 Soniqo 优化的 MLX 版本到项目目录
  huggingface-cli download aufklarer/Pyannote-Segmentation-MLX --local-dir models/pyannote-segmentation-mlx
  huggingface-cli download aufklarer/WeSpeaker-ResNet34-LM-MLX --local-dir models/wespeaker-mlx
  ```
- **存放位置**: `models/pyannote-segmentation-mlx/`、`models/wespeaker-mlx/`
- **下载链接**: 
  - https://huggingface.co/aufklarer/Pyannote-Segmentation-MLX
  - https://huggingface.co/aufklarer/WeSpeaker-ResNet34-LM-MLX
- **依赖模型**:
  - Segmentation (5.7 MB) → `models/pyannote-segmentation-mlx/`
  - WeSpeaker (25 MB) → `models/wespeaker-mlx/`

#### 4. Sortformer (CoreML)
- **用途**: 说话人分离（重叠语音场景）
- **大小**: 240 MB
- **下载方式**: 
  ```bash
  huggingface-cli download aufklarer/Sortformer-Diarization-CoreML --local-dir models/sortformer-coreml
  ```
- **存放位置**: `models/sortformer-coreml/`
- **下载链接**: https://huggingface.co/aufklarer/Sortformer-Diarization-CoreML

#### 5. Qwen3-ForcedAligner (MLX 4-bit)
- **用途**: 强制对齐（高精度字幕）
- **大小**: ~979 MB
- **下载方式**: 
  ```bash
  # 下载 Qwen3-ForcedAligner 到项目目录
  huggingface-cli download aufklarer/Qwen3-ForcedAligner-0.6B-4bit --local-dir models/qwen3-aligner-4bit
  ```
- **存放位置**: `models/qwen3-aligner-4bit/`
- **下载链接**: https://huggingface.co/aufklarer/Qwen3-ForcedAligner-0.6B-4bit
- **备选版本**:
  - 8-bit (1.3 GB): `aufklarer/Qwen3-ForcedAligner-0.6B-8bit`
  - CoreML INT4 (662 MB): `aufklarer/Qwen3-ForcedAligner-0.6B-CoreML-INT4`

### 快速下载脚本

```bash
#!/bin/bash
# download_models.sh - 批量下载所有模型到项目 models/ 目录

echo "创建 models 目录..."
mkdir -p models

echo "安装 Hugging Face CLI..."
pip install huggingface-hub[cli]

echo "下载 Qwen3-ASR 0.6B MLX 8-bit..."
huggingface-cli download aufklarer/Qwen3-ASR-0.6B-MLX-8bit --local-dir models/qwen3-asr-0.6b-mlx-8bit

echo "下载 Silero VAD..."
mkdir -p models/silero-vad
wget https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.jit -O models/silero-vad/silero_vad.jit

echo "下载 Pyannote MLX 模型..."
read -p "是否下载 Pyannote 说话人分离模型? [y/N]: " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    huggingface-cli download aufklarer/Pyannote-Segmentation-MLX --local-dir models/pyannote-segmentation-mlx
    huggingface-cli download aufklarer/WeSpeaker-ResNet34-LM-MLX --local-dir models/wespeaker-mlx
fi

echo "下载 Qwen3-ForcedAligner (可选)..."
read -p "是否下载 ForcedAligner 模型? [y/N]: " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    huggingface-cli download aufklarer/Qwen3-ForcedAligner-0.6B-4bit --local-dir models/qwen3-aligner-4bit
fi

echo "完成！所有模型已下载到 models/ 目录"
```

### 离线部署

如需在无网络环境部署，可在有网络的机器上预下载模型，然后打包传输：

```bash
# 导出模型（从项目目录）
tar -czf models.tar.gz models/

# 在目标机器解压到项目目录
tar -xzf models.tar.gz
```

## Python 环境管理

使用 **uv** 作为 Python 包管理器，替代 pip/conda：

### 安装 uv
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 项目初始化
```bash
# 创建项目（自动创建 pyproject.toml）
uv init subtitle-maker
cd subtitle-maker

# 指定 Python 版本
uv python install 3.11
uv venv --python 3.11
source .venv/bin/activate  # macOS/Linux
```

### 依赖安装
```bash
# 核心依赖
uv add mlx-lm==0.19.3
uv add qwen-asr  # Qwen3-ASR MLX 封装
uv add silero-vad
uv add soniqo  # 可选：对齐和说话人分离

# 开发依赖
uv add --dev pytest pytest-cov black ruff
```

### pyproject.toml 示例
```toml
[project]
name = "subtitle-maker"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "mlx-lm==0.19.3",
    "qwen-asr>=0.6.0",
    "silero-vad>=5.1",
    "soniqo>=0.2.0",  # 可选
]

[project.optional-dependencies]
diarization = ["soniqo>=0.2.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 运行和部署
```bash
# 开发模式运行
uv run python -m subtitle_maker.cli --input audio.mp3

# 锁定依赖（确保可复现）
uv lock

# 生产环境安装（从 uv.lock）
uv sync --frozen
```

**uv 优势**：
- 安装速度比 pip 快 10-100 倍
- 自动解决依赖冲突
- 统一管理 Python 版本和虚拟环境
- 生成 uv.lock 确保跨平台可复现构建

## 验收标准

- [ ] 使用 uv 管理项目依赖，提供 pyproject.toml 和 uv.lock
- [ ] Python 版本固定为 3.11
- [ ] 部署方案文档明确指定 Qwen3-ASR 0.6B MLX 8-bit
- [ ] 实测峰值内存 ≤ 1.5 GB（不含说话人分离）
- [ ] 启用 Pyannote 后峰值内存 ≤ 1.6 GB
- [ ] 实测 RTF < 0.02（50倍实时）
- [ ] 支持 52 种语言
- [ ] 可选流式模式（--stream）和部分结果（--partial）
- [ ] 字幕切句准确率 > 90%（基于人工标注测试集）
- [ ] 单句长度可配置（默认 5-15 秒）
- [ ] 说话人分离为可选功能，用户可选择 Pyannote 或 Sortformer
- [ ] 双人对话场景说话人标注准确率 > 85%
