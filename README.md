# Zimu Qwen3

Mac 16GB 语音转字幕系统，基于 Qwen3-ASR MLX。

## 特性

- 🚀 高效：RTF <0.02（50倍实时速度）
- 💾 低内存：峰值 <1.5GB
- 🎯 准确：基于 Qwen3-ASR 0.6B MLX 8-bit
- 🔧 简单：CLI 和 Web UI 双模式

## 快速开始

### 安装

```bash
# 使用 uv 安装
uv sync

# 激活环境
source .venv/bin/activate
```

### 下载模型

```bash
# 下载 Qwen3-ASR MLX 8-bit
huggingface-cli download aufklarer/Qwen3-ASR-0.6B-MLX-8bit --local-dir models/qwen3-asr-0.6b-mlx-8bit
```

### 使用

**CLI 模式**：
```bash
zimu audio.mp3
```

**Web UI 模式**：
```bash
zimu-web
# 打开 http://localhost:8200
```

## 架构

```
src/zimu_qwen3/
├── core/           # 核心模块
│   ├── pipeline.py       # MLX 转录
│   ├── preprocessing.py  # 音频处理
│   ├── segmentation.py   # VAD 切句
│   └── export.py         # SRT 导出
├── cli.py          # CLI 入口
└── web.py          # Web UI
```

## 性能指标

- 内存：≤1.5GB
- 速度：RTF <0.02
- 准确率：字幕切句 >90%
- 句子时长：5-15秒（可配置）

## 开发

```bash
# 安装开发依赖
uv sync --extra dev

# 运行测试
pytest
```
