# 构建进度跟踪

## 项目概览

**目标**: Mac 16GB 环境下部署 Qwen3-ASR 0.6B MLX 8-bit，实现高效语音转字幕系统

**技术栈**: MLX, Qwen3-ASR, Silero VAD, Pyannote.audio

---

## 已完成 ✅

### 项目架构 (2024-06-12)
- [x] 创建项目目录结构（基于 uv）
- [x] 配置 pyproject.toml（MLX, FastAPI, uvicorn）
- [x] 搭建 src/zimu_qwen3/core 核心模块架构
- [x] 配置 Git 版本管理（.gitignore, 首次提交）
- [x] 创建 README.md

### 核心模块框架 (2024-06-12)
- [x] `core/preprocessing.py` - 音频预处理（完整）
  - AudioChunk 数据类型
  - load_audio, normalize_audio, split_audio
- [x] `core/pipeline.py` - MLX 转录管道（骨架）
  - 改用 mlx-lm 替代 transformers
  - TranscriptionPipeline 接口
- [x] `core/segmentation.py` - VAD + 标点切句（完整）
  - SubtitleSegmenter
  - Silero VAD 集成
- [x] `core/export.py` - SRT 导出（完整）
  - format_timestamp_srt, export_srt
- [x] `core/diarization.py` - 说话人分离（骨架）

### 前端 (2024-06-12)
- [x] `cli.py` - CLI 工具入口
- [x] `web.py` - FastAPI Web UI
- [x] `templates/index.html` - 上传页面
- [x] `templates/result.html` - 结果页面
- [x] Git 初始提交完成

### 依赖安装 (2024-06-12)
- [x] uv sync 安装所有依赖

### 模型下载 (2024-06-12)
- [x] Qwen3-ASR 0.6B MLX 8-bit 下载完成（960MB）
  - 位置：models/models/qwen3-asr-0.6b-mlx-8bit/
  - 包含：model.safetensors, config.json, tokenizer 等

---

## 进行中 🚧

### MLX 模型集成 (当前优先级)
- [ ] **pipeline.py - 完善 MLX 推理逻辑**
  - [ ] 确认 mlx-lm API（load, generate）
  - [ ] 实现音频特征提取
  - [ ] 实现 MLX 模型推理
  - [ ] 添加词级时间戳提取（可选）
  - [ ] 测试转录准确性
  
### 模型下载
- [ ] **下载 Qwen3-ASR MLX 8-bit**
  - [ ] 执行 huggingface-cli download
  - [ ] 验证模型文件完整性
  - [ ] 测试模型加载

---

## 待开始 📋

### 说话人分离（可选模块）
- [ ] **diarization.py - Pyannote 集成**
  - [ ] 实现 `SpeakerDiarizer.load_model()`
  - [ ] 实现 `SpeakerDiarizer.diarize()`
  - [ ] 合并转录 + 说话人标签
  - [ ] 内存占用测试（目标 +50MB）
  - [ ] 双人对话准确率测试（目标 >85%）

### 字幕导出
- [ ] **subtitle/export.py - 格式转换**
  - [ ] 实现 `export_srt()`
  - [ ] 实现 `export_vtt()`
  - [ ] 实现 `export_ass()`（可选）
  - [ ] 时间码格式化
  - [ ] 字符转义处理

### CLI 工具
- [ ] **src/cli.py - 命令行接口**
  - [ ] `zimu transcribe <audio>` - 基础转录
  - [ ] `--stream` - 流式模式
  - [ ] `--diarize` - 启用说话人分离
  - [ ] `--format srt|vtt` - 输出格式
  - [ ] `--min-duration` / `--max-duration` - 单句时长
  - [ ] `--language` - 指定语言
  - [ ] 进度条 + 统计信息

### 测试 & 基准
- [ ] **tests/test_pipeline.py**
  - [ ] 单元测试：模型加载
  - [ ] 单元测试：转录准确性
  - [ ] 集成测试：端到端流程
- [ ] **tests/test_segmentation.py**
  - [ ] VAD 切句测试
  - [ ] 时长限制测试
- [ ] **tests/benchmark_memory.py**
  - [ ] 峰值内存测量
  - [ ] 不同音频长度测试
- [ ] **tests/benchmark_speed.py**
  - [ ] RTF 测量
  - [ ] 不同硬件对比

### 文档
- [ ] **README.md**
  - [ ] 安装说明
  - [ ] 快速开始
  - [ ] CLI 用法示例
  - [ ] 性能指标
- [ ] **PERFORMANCE.md**
  - [ ] 内存占用实测数据
  - [ ] RTF 实测数据
  - [ ] 多语言 WER 对比

---

## 技术债务 & 优化

- [ ] 添加日志配置（logging.yaml）
- [ ] 添加异常处理（音频文件损坏、内存不足）
- [ ] 添加进度回调接口
- [ ] 缓存机制（避免重复加载模型）
- [ ] GPU 利用率监控
- [ ] 支持批量处理多文件

---

## 验收检查清单

根据 REQUIREMENT.md 的验收标准：

- [ ] 部署 Qwen3-ASR 0.6B MLX 8-bit
- [ ] 实测峰值内存 ≤ 1.5 GB（不含说话人分离）
- [ ] 启用 Pyannote 后峰值内存 ≤ 1.6 GB
- [ ] 实测 RTF < 0.02（50倍实时）
- [ ] 支持 52 种语言
- [ ] 字幕切句准确率 > 90%
- [ ] 单句长度可配置（默认 5-15 秒）
- [ ] 说话人分离准确率 > 85%（双人对话）
- [ ] 支持 SRT/VTT 格式导出
- [ ] CLI 工具可用（转录、切句、导出一键完成）

---

## 下一步行动

**优先级 1（核心功能）**:
1. 完成 `pipeline.py` MLX 模型集成
2. 完成 `preprocessing.py` 音频加载
3. 完成 `segmentation.py` VAD 切句

**优先级 2（可用性）**:
4. 实现基础 CLI 工具
5. 添加 SRT 导出

**优先级 3（可选增强）**:
6. 说话人分离
7. 性能基准测试

---

## 模型下载状态 (2024-06-12)

### 已下载 ✅
- [x] Qwen3-ASR 0.6B MLX 8-bit (967MB) - 必需
- [x] Silero VAD v5 (616KB) - 必需
- [x] Qwen3-ForcedAligner 4-bit (938MB) - 可选

### 未下载
- [ ] Pyannote MLX (31MB) - 说话人分离
- [ ] Sortformer CoreML (240MB) - 重叠语音

**总占用：1.9GB**
