#!/usr/bin/env python3
"""下载 Qwen3 Forced Aligner 模型。"""

from huggingface_hub import snapshot_download

MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B"
LOCAL_DIR = "models/qwen3-aligner"

print(f"Downloading {MODEL_ID}...")
snapshot_download(
    repo_id=MODEL_ID,
    local_dir=LOCAL_DIR,
    local_dir_use_symlinks=False,
)
print(f"Model saved to {LOCAL_DIR}")
