# 实现进度记录

# 实现进度记录

## 2024-06-12 会话2 - Forced Alignment 完成 ✅

### 核心突破：精确时间戳对齐

1. **修复 MLX Qwen3-ForcedAligner Bug**
   - 问题：量化版本(4bit/8bit)存在 shape mismatch 错误
   - 解决：使用非量化版本 `models/qwen3-aligner`
   - 修复位置：`.venv/lib/.../qwen3_forced_aligner.py` (临时补丁)

2. **智能文本对齐算法** 🎯
   - 核心问题：ASR输出带标点，Aligner输出不带标点
   - 解决方案：
     * 用ASR文本（带标点）切分句子
     * 标准化两边文本（移除标点）进行字符位置映射
     * 根据位置找到Aligner items的索引范围
     * 提取时间戳，保留ASR原文（带标点）
   - 结果：支持任意长度音频，精确对齐无漂移

3. **中英文统一处理**
   - 英文：词级时间戳（`During`, `sex`...）
   - 中文：字符级时间戳（`二`, `零`...）
   - 统一逻辑：标准化文本 + 字符位置映射

4. **横竖屏自动适配**
   - 通过 ffprobe 检测视频分辨率
   - 横屏：42显示单位 ≈ 21汉字 / 42英文字母
   - 竖屏：18显示单位 ≈ 9汉字 / 18英文字母

5. **智能切句算法**
   - 中文：句末标点 → 逗号 → 保留完整词组
   - 英文（无标点ASR）：直接按单词切分
   - 显示宽度计算：中文字符=2单位，英文=1单位

### 模型管理
- ✅ 保留：qwen3-aligner (1.7GB) - 精确对齐
- ✅ 保留：qwen3-asr-0.6b-mlx-8bit (967MB) - ASR转录
- ❌ 删除：qwen3-aligner-4bit, 8bit, silero-vad (共2.1GB)

### 测试验证
- ✅ 英文音频：词级时间戳精确
- ✅ 中文音频(104秒)：34句字幕覆盖全程，无漂移
- ✅ 时间戳无重叠、连续覆盖

### Web服务
- 运行中：http://localhost:8000
- 支持上传视频自动生成 SRT 字幕

---

## 2024-06-12 会话1 - 项目初始化 ✅

### 1. 项目初始化 ✅
- uv 项目搭建
- Git 版本控制
- 目录结构创建

### 2. 架构实现 ✅
- 从 PyTorch 迁移到 MLX Audio
- 核心模块：pipeline, preprocessing, segmentation, export
- 前端：CLI + Web UI (FastAPI)

### 3. 模型下载 ✅
- Qwen3-ASR 0.6B MLX 8-bit (960MB)
- 位置：models/qwen3-asr-0.6b-mlx-8bit/

### 4. 测试准备 ✅
- test_basic.py 端到端测试脚本

## Git 提交历史
1. Initial commit: MLX-based system
2. Setup: uv sync & model download
3. Fix: Model path & mlx-audio
4. Add: test_basic.py
5. Doc: PROGRESS.md
6. Fix: Remove duplicate models/models/
7. Clean: Remove duplicate docs
8. Complete: All frontend files restored
9. Fix: Restore missing web.py and templates
10. Add: Download ForcedAligner model
11. Add: Download Silero VAD models
