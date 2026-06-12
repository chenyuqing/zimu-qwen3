#!/usr/bin/env python3
"""测试脚本：验证核心功能。"""

import sys
from pathlib import Path

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent / "src"))

from zimu_qwen3.core.pipeline import create_pipeline
from zimu_qwen3.core.preprocessing import load_audio
from zimu_qwen3.core.segmentation import segment_subtitles
from zimu_qwen3.core.export import export_srt

def test_model_load():
    """测试模型加载。"""
    print("=" * 50)
    print("测试 1: 模型加载")
    print("=" * 50)

    try:
        pipeline = create_pipeline()
        pipeline.load()
        print(f"✅ 模型加载成功")
        print(f"   后端: {pipeline.device_info['backend']}")
        print(f"   路径: {pipeline.device_info['model_path']}")
        return pipeline
    except Exception as e:
        print(f"❌ 模型加载失败: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_audio_load(audio_path: str):
    """测试音频加载。"""
    print("\n" + "=" * 50)
    print("测试 2: 音频加载")
    print("=" * 50)

    try:
        audio, sr = load_audio(audio_path, target_sr=16000)
        duration = len(audio) / sr
        print(f"✅ 音频加载成功")
        print(f"   采样率: {sr} Hz")
        print(f"   时长: {duration:.2f} 秒")
        print(f"   形状: {audio.shape}")
        return audio, sr
    except Exception as e:
        print(f"❌ 音频加载失败: {e}")
        import traceback
        traceback.print_exc()
        return None, None

def test_transcription(pipeline, audio_path: str):
    """测试转录。"""
    print("\n" + "=" * 50)
    print("测试 3: 语音转录")
    print("=" * 50)

    try:
        result = pipeline.transcribe_file(audio_path)
        print(f"✅ 转录成功")
        print(f"   文本: {result.text[:100]}...")
        print(f"   时长: {result.duration_seconds:.2f} 秒")
        print(f"   处理时间: {result.processing_time_seconds:.2f} 秒")
        print(f"   RTF: {result.rtf:.4f}")
        return result
    except Exception as e:
        print(f"❌ 转录失败: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_segmentation(audio, sr, text):
    """测试切句。"""
    print("\n" + "=" * 50)
    print("测试 4: 字幕切句")
    print("=" * 50)

    try:
        subtitles = segment_subtitles(audio, sr, text, use_vad=False)
        print(f"✅ 切句成功")
        print(f"   句子数: {len(subtitles)}")
        if subtitles:
            print(f"   首句: [{subtitles[0].start:.2f}s - {subtitles[0].end:.2f}s] {subtitles[0].text[:50]}...")
        return subtitles
    except Exception as e:
        print(f"❌ 切句失败: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_export(subtitles, output_path: str):
    """测试导出。"""
    print("\n" + "=" * 50)
    print("测试 5: SRT 导出")
    print("=" * 50)

    try:
        export_srt(subtitles, output_path)
        print(f"✅ 导出成功")
        print(f"   文件: {output_path}")
        with open(output_path) as f:
            preview = f.read(200)
        print(f"   预览:\n{preview}...")
        return True
    except Exception as e:
        print(f"❌ 导出失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """主测试流程。"""
    if len(sys.argv) < 2:
        print("用法: python test_basic.py <音频文件>")
        print("示例: python test_basic.py test.mp3")
        sys.exit(1)

    audio_path = sys.argv[1]
    if not Path(audio_path).exists():
        print(f"❌ 文件不存在: {audio_path}")
        sys.exit(1)

    print(f"\n🚀 开始测试: {audio_path}\n")

    # 测试 1: 模型加载
    pipeline = test_model_load()
    if not pipeline:
        print("\n❌ 测试终止：模型加载失败")
        sys.exit(1)

    # 测试 2: 音频加载
    audio, sr = test_audio_load(audio_path)
    if audio is None:
        print("\n❌ 测试终止：音频加载失败")
        sys.exit(1)

    # 测试 3: 转录
    result = test_transcription(pipeline, audio_path)
    if not result:
        print("\n❌ 测试终止：转录失败")
        sys.exit(1)

    # 测试 4: 切句
    subtitles = test_segmentation(audio, sr, result.text)
    if not subtitles:
        print("\n❌ 测试终止：切句失败")
        sys.exit(1)

    # 测试 5: 导出
    output_path = "test_output.srt"
    success = test_export(subtitles, output_path)

    # 总结
    print("\n" + "=" * 50)
    print("测试总结")
    print("=" * 50)
    if success:
        print("✅ 所有测试通过！")
        print(f"\n💡 下一步：")
        print(f"   - CLI: uv run zimu {audio_path}")
        print(f"   - Web: uv run zimu-web")
    else:
        print("❌ 部分测试失败")
        sys.exit(1)

if __name__ == "__main__":
    main()
