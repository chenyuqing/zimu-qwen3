# 实现进度记录

## 2024-06-12 会话3 - 字幕校正功能 ✅

### 新增功能

1. **字幕自动校正** 🎯
   - 算法：`difflib.SequenceMatcher` 字符级对齐
   - 输入：ASR 字幕（时间准确，文字可能误识别）+ 准确脚本文本
   - 输出：校正后字幕（时间保留，文字替换）
   - 流程：
     * 构建 ASR 字符时间戳映射（字符级）
     * SequenceMatcher 生成对齐操作（equal/replace/insert/delete）
     * 将脚本文本映射到 ASR 时间戳
     * 按标点切句重新生成字幕
   - 边界处理：最后一句结束时间用 ASR 原始结束时间

2. **文件管理优化**
   - New Project 自动清理上传文件，保留最新 3 个
   - SRT 下载使用原始文件名（不再是 UUID 乱码）
   - 前端生成 SRT 内容，避免服务器文件名问题

3. **Bug 修复**
   - 最后一句字幕识别丢失：`segmentation.py` 边界条件处理
   - 最后一句结束时间过早：校正时用 ASR 原始结束时间
   - SRT 文件名乱码：前端直接生成下载，指定文件名

### 技术实现

**后端端点**：
- `/correct` - 字幕校正（字符级对齐）
- `/project/reset` - 清理上传文件

**前端**：
- "Upload Script to Correct" 按钮
- `generateSRT()` 函数生成 SRT 内容
- `saveState()` 保存校正结果到 localStorage

**算法优化**：
- `_map_word_items_to_sentences_smart()` 添加边界检查
- 最后一句 `end_item_idx` 为 None 时使用最后一个 item

### Git 管理

- Git 仓库清理：从 3.6GB 降至 604KB
- 删除 LFS 缓存和旧历史
- Release v0.1 发布

---

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
1. Initial commit: subtitle maker with Qwen3-ASR + Forced Alignment
2. feat: 字幕校正功能与最后一句识别修复
3. docs: 更新 README 和 TODO 文档
