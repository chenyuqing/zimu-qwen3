# Zimu Qwen3

Mac 16GB 语音转字幕系统，基于 Qwen3-ASR + Forced Alignment。

## 特性

- 🚀 高效：RTF <0.02（50倍实时速度）
- 💾 低内存：峰值 <1.5GB
- 🎯 准确：Qwen3-ASR 0.6B + Forced Alignment 精确对齐
- 🔧 简单：CLI 和 Web UI 双模式
- 📝 智能校正：上传脚本自动字符级对齐校正

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
# 下载 Qwen3-ASR 和 Aligner
python scripts/download_aligner.py
```

### 使用

**Web UI 模式**：
```bash
zimu-web
# 打开 http://localhost:8001
```

**CLI 模式**：
```bash
zimu audio.mp3
```

## 功能

### 字幕生成
1. 上传音频/视频文件
2. 点击 "Generate Subtitles" 
3. 自动生成带精确时间戳的字幕

### 字幕校正
1. 生成字幕后，点击 "Upload Script to Correct"
2. 上传准确的文本脚本（.txt 或 .srt）
3. 系统自动进行字符级对齐，保留时间戳，替换文本

### 翻译
支持字幕翻译功能（需配置翻译 API）

## 架构

```
src/zimu_qwen3/
├── core/           # 核心模块
│   ├── pipeline.py       # Qwen3-ASR 转录
│   ├── preprocessing.py  # 音频处理
│   ├── segmentation.py   # Forced Alignment 切句
│   └── export.py         # SRT 导出
├── app/            # Web API
│   ├── routes/projects.py  # 转录/校正端点
│   └── main.py
├── cli.py          # CLI 入口
└── web.py          # Web UI
```

## 性能指标

- 内存：≤1.5GB
- 速度：RTF <0.02
- 准确率：Forced Alignment 精确到字符级
- 句子时长：5-15秒（可配置）

## 开发

```bash
# 安装开发依赖
uv sync --extra dev

# 运行测试
pytest
```
