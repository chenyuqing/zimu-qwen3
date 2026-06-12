import { createTimeRangesController } from './timeRanges.js';

/**
 * 初始化 Video & Voice Slice 面板。
 */
export function setupSpeakerVoicePanel(deps) {
    const byId = (id) => document.getElementById(id);
    const panelEl = byId('panel-get-speaker-voice');
    if (!panelEl) return;

    const {
        videoPlayer,
        videoPlaceholder,
        secondsToDisplay,
        timeToSeconds,
        getProjectDubbingContext,
    } = deps;

    const projectMediaEl = byId('speaker-voice-project-media');
    const projectTaskEl = byId('speaker-voice-project-task');
    const projectReadinessEl = byId('speaker-voice-project-readiness');
    const projectNoteEl = byId('speaker-voice-project-note');
    const startBtn = byId('start-speaker-voice-btn');
    const startVideoBtn = byId('start-speaker-video-btn');
    const statusContainer = byId('speaker-voice-status-container');
    const progressFill = byId('speaker-voice-progress-fill');
    const statusText = byId('speaker-voice-status-text');
    const taskLabel = byId('speaker-voice-task-id');
    const lineProgressEl = byId('speaker-voice-line-progress');
    const resultsContainer = byId('speaker-voice-results');
    const rangeInputsEl = byId('speaker-voice-range-inputs');
    const rangePrecisionToggleBtn = byId('speaker-voice-range-precision-toggle');
    const rangeStartHEl = byId('speaker-voice-range-start-h');
    const rangeEndHEl = byId('speaker-voice-range-end-h');
    const useCurrentBtn = byId('speaker-voice-use-current-time-btn');
    let rangePrecisionExpanded = false;

    const ranges = createTimeRangesController({
        listEl: byId('speaker-voice-time-ranges-list'),
        errorEl: byId('speaker-voice-range-error'),
        startHEl: rangeStartHEl,
        startMEl: byId('speaker-voice-range-start-m'),
        startSEl: byId('speaker-voice-range-start-s'),
        endHEl: rangeEndHEl,
        endMEl: byId('speaker-voice-range-end-m'),
        endSEl: byId('speaker-voice-range-end-s'),
        addBtn: byId('speaker-voice-add-range-btn'),
        useCurrentBtn,
        clearBtn: byId('speaker-voice-clear-ranges-btn'),
        videoPlayer,
        secondsToDisplay,
        timeToSeconds,
    });

    /**
     * 同步 Required extraction windows 的时间精度显示。
     * 默认只显示 MM:SS；展开后显示 HH:MM:SS。
     */
    function syncRangePrecision(expanded = rangePrecisionExpanded) {
        rangePrecisionExpanded = !!expanded;
        if (rangeInputsEl) {
            rangeInputsEl.classList.toggle('expanded', rangePrecisionExpanded);
        }
        if (rangePrecisionToggleBtn) {
            rangePrecisionToggleBtn.textContent = rangePrecisionExpanded ? '收起' : '展开';
            rangePrecisionToggleBtn.setAttribute('aria-expanded', rangePrecisionExpanded ? 'true' : 'false');
        }
    }

    /**
     * 小时位一旦有值就自动展开，避免把有效输入隐藏掉。
     */
    function ensureRangePrecisionForHourValues() {
        const hasHourValue = [rangeStartHEl, rangeEndHEl].some((input) => {
            const value = Number.parseInt(String(input?.value || '').trim(), 10);
            return Number.isFinite(value) && value > 0;
        });
        if (hasHourValue) {
            syncRangePrecision(true);
        }
    }

    /**
     * 读取当前项目上下文。
     */
    function readProjectContext() {
        if (typeof getProjectDubbingContext === 'function') {
            return getProjectDubbingContext() || {};
        }
        return {};
    }

    /**
     * 渲染当前项目摘要。
     */
    function renderProjectContextSummary() {
        const projectContext = readProjectContext();
        const mediaName = projectContext?.mediaOriginalFilename || projectContext?.mediaFilename || '';
        if (projectMediaEl) {
            projectMediaEl.textContent = mediaName || '未上传媒体';
        }
        if (projectTaskEl) {
            projectTaskEl.textContent = projectContext?.taskId || '未生成';
        }
        if (projectReadinessEl) {
            projectReadinessEl.textContent = mediaName ? '可复用' : '缺少媒体';
        }
        if (projectNoteEl) {
            projectNoteEl.textContent = mediaName
                ? '将复用当前项目媒体，按指定 ranges 提取人声音频或视频片段。'
                : '当前项目还没有可复用的媒体文件，请先在 1.Upload Videos & SRT 中上传媒体。';
        }
    }

    /**
     * 构造当前项目请求。
     */
    function buildCurrentProjectRequest(mode = 'voice') {
        const projectContext = readProjectContext();
        const mediaFilename = String(projectContext?.mediaFilename || '').trim();
        if (!mediaFilename) {
            throw new Error('Current project has no reusable media. Upload media first in 1.Upload Videos & SRT.');
        }
        const payload = ranges.getRanges().map((item) => ({
            start_sec: Number(item.start),
            end_sec: Number(item.end),
        }));
        if (payload.length === 0) {
            throw new Error('Video & Voice Slice requires at least one range.');
        }
        const formData = new FormData();
        formData.append('filename', mediaFilename);
        formData.append('original_filename', projectContext?.mediaOriginalFilename || mediaFilename);
        formData.append('task_id', projectContext?.taskId || '');
        formData.append('time_ranges', JSON.stringify(payload));
        const normalizedMode = mode === 'video' ? 'video' : 'voice';
        const endpoint = normalizedMode === 'video'
            ? '/speaker-voice/start-video-from-project'
            : '/speaker-voice/start-from-project';
        return { endpoint, formData, mode: normalizedMode };
    }

    /**
     * 渲染结果下载按钮。
     */
    function renderResults(data) {
        if (!resultsContainer) return;
        resultsContainer.style.display = 'block';
        const links = resultsContainer.querySelector('.download-links');
        if (!links) return;
        links.innerHTML = '';
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        artifacts.forEach((artifact, index) => {
            if (!artifact?.url) return;
            const btn = document.createElement('a');
            btn.href = artifact.url;
            btn.className = index === 0 ? 'primary-btn' : 'secondary-btn';
            btn.textContent = artifact.label || artifact.key || 'Download';
            btn.style.display = 'block';
            btn.style.textAlign = 'center';
            links.appendChild(btn);
        });
    }

    /**
     * 轮询任务状态并更新 UI。
     */
    function pollStatus(taskId) {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/speaker-voice/status/${taskId}`);
                if (!res.ok) {
                    clearInterval(interval);
                    throw new Error('Status poll failed');
                }
                const data = await res.json();
                if (progressFill && typeof data.progress === 'number') {
                    progressFill.style.width = `${data.progress}%`;
                }
                if (taskLabel && (data.short_id || data.id)) {
                    taskLabel.textContent = `Task · ${(data.short_id || data.id.split('-')[0]).toUpperCase()}`;
                }
                if (lineProgressEl) {
                    const processed = data.processed_segments ?? 0;
                    const total = data.total_segments ?? processed;
                    lineProgressEl.textContent = `Ranges ${processed}/${total || 0}`;
                }
                if (statusText) {
                    statusText.textContent = data.status === 'failed' ? `Failed: ${data.error}` : (data.stage || 'running');
                    statusText.className = `status-text ${data.status === 'failed' ? 'error' : data.status === 'completed' ? 'success' : ''}`.trim();
                }
                if (data.status === 'completed') {
                    clearInterval(interval);
                    startBtn.disabled = false;
                    if (startVideoBtn) startVideoBtn.disabled = false;
                    renderResults(data);
                } else if (data.status === 'failed') {
                    clearInterval(interval);
                    startBtn.disabled = false;
                    if (startVideoBtn) startVideoBtn.disabled = false;
                }
            } catch (error) {
                clearInterval(interval);
                if (statusText) {
                    statusText.textContent = `Polling Error: ${error.message}`;
                    statusText.className = 'status-text error';
                }
                startBtn.disabled = false;
                if (startVideoBtn) startVideoBtn.disabled = false;
            }
        }, 1200);
    }

    if (rangePrecisionToggleBtn) {
        rangePrecisionToggleBtn.addEventListener('click', () => {
            syncRangePrecision(!rangePrecisionExpanded);
        });
    }
    [rangeStartHEl, rangeEndHEl].forEach((input) => {
        if (!input) return;
        input.addEventListener('input', () => {
            ensureRangePrecisionForHourValues();
        });
    });
    if (useCurrentBtn) {
        useCurrentBtn.addEventListener('click', () => {
            ensureRangePrecisionForHourValues();
        });
    }
    syncRangePrecision(false);

    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            try {
                startBtn.disabled = true;
                resultsContainer.style.display = 'none';
                statusContainer.style.display = 'block';
                if (statusText) {
                    statusText.textContent = 'Initializing...';
                    statusText.className = 'status-text';
                }
                if (progressFill) {
                    progressFill.style.width = '8%';
                }
                const request = buildCurrentProjectRequest('voice');
                const res = await fetch(request.endpoint, {
                    method: 'POST',
                    body: request.formData,
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.detail || 'Failed to start speaker voice task');
                }
                pollStatus(data.task_id);
            } catch (error) {
                startBtn.disabled = false;
                if (startVideoBtn) startVideoBtn.disabled = false;
                if (statusContainer) {
                    statusContainer.style.display = 'block';
                }
                if (statusText) {
                    statusText.textContent = `Error: ${error.message}`;
                    statusText.className = 'status-text error';
                }
            }
        });
    }
    if (startVideoBtn) {
        startVideoBtn.addEventListener('click', async () => {
            try {
                startVideoBtn.disabled = true;
                if (startBtn) startBtn.disabled = true;
                resultsContainer.style.display = 'none';
                statusContainer.style.display = 'block';
                if (statusText) {
                    statusText.textContent = 'Initializing...';
                    statusText.className = 'status-text';
                }
                if (progressFill) {
                    progressFill.style.width = '8%';
                }
                const request = buildCurrentProjectRequest('video');
                const res = await fetch(request.endpoint, {
                    method: 'POST',
                    body: request.formData,
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.detail || 'Failed to start speaker video task');
                }
                pollStatus(data.task_id);
            } catch (error) {
                if (startBtn) startBtn.disabled = false;
                startVideoBtn.disabled = false;
                if (statusContainer) {
                    statusContainer.style.display = 'block';
                }
                if (statusText) {
                    statusText.textContent = `Error: ${error.message}`;
                    statusText.className = 'status-text error';
                }
            }
        });
    }
    window.addEventListener('subtitle-maker:project-context-changed', () => {
        renderProjectContextSummary();
    });

    renderProjectContextSummary();
}
