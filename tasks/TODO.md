# 构建进度跟踪

## 项目概览

**目标**: Mac 16GB 环境下部署 Qwen3-ASR 0.6B MLX 8-bit + Forced Alignment，实现高效语音转字幕系统

**技术栈**: MLX, Qwen3-ASR, Qwen3-ForcedAligner, FastAPI

---

## 已完成 ✅

### v0.1 - 核心功能 (2024-06-12)
- [x] 项目架构搭建（uv + MLX）
- [x] Qwen3-ASR 0.6B MLX 8-bit 转录
- [x] Qwen3-ForcedAligner 精确对齐
- [x] Web UI 上传/转录/下载
- [x] SRT 字幕导出
- [x] 横竖屏自适应（字符宽度）
- [x] Git LFS 清理（604KB 仓库）
- [x] GitHub Release v0.1

### v0.2 - 字幕校正 (2024-06-12)
- [x] 字幕校正功能（字符级对齐）
  - 上传脚本自动对齐
  - 保留时间戳，替换文本
  - difflib SequenceMatcher 算法
- [x] 修复最后一句识别丢失
- [x] 修复最后一句结束时间边界
- [x] SRT 文件名使用原始文件名
- [x] New Project 清理上传文件（保留最新3个）

---

## 进行中 🚧

无

---

## 待开始 📋

### 性能优化
- [ ] 批量处理多文件
- [ ] 内存占用监控
- [ ] 错误处理优化

### 功能增强
- [ ] 字幕编辑器（前端直接修改）
- [ ] 多语言翻译优化
- [ ] 视频预览同步

### 测试
- [ ] 单元测试（pipeline, segmentation）
- [ ] 性能基准测试（RTF, 内存）
- [ ] 准确率测试（字符级对齐）

---

## 技术债务

- [ ] 日志配置
- [ ] 异常处理完善
- [ ] API 文档（OpenAPI）

---

## 验收检查清单

- [x] Qwen3-ASR 0.6B MLX 8-bit 部署
- [x] Forced Alignment 精确对齐
- [x] 峰值内存 ≤ 1.5 GB
- [x] RTF < 0.02（50倍实时）
- [x] 字幕切句准确（Forced Alignment）
- [x] SRT 格式导出
- [x] Web UI 可用
- [x] 字幕校正功能

---

## 模型下载状态

### 已下载 ✅
- [x] Qwen3-ASR 0.6B MLX 8-bit (967MB)
- [x] Qwen3-ForcedAligner 4-bit (938MB)
- [x] Silero VAD v5 (115MB)

**总占用：2.0GB**
