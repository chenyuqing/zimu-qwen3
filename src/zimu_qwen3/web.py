from zimu_qwen3.app.main import app


def start():
    """启动 Web 服务。"""
    import uvicorn
    uvicorn.run("zimu_qwen3.app.main:app", host="0.0.0.0", port=8200, reload=True)


__all__ = ["app", "start"]
