/**
 * 初始化独立 VoxCPM 配音面板。
 * 这条链路主打音色/情绪表达，默认按自然时长朗读并输出黑底字幕视频。
 */
export function setupVoxcpmDubbingPanel(deps) {
    const byId = (id) => document.getElementById(id);
    const panelEl = byId('panel-auto-dub-voxcpm');
    if (!panelEl) return;

    const {
        videoPlayer,
        videoPlaceholder,
        formatEtaAsSegmentProgress,
        buildAutoDubElapsedLabel,
        getProjectDubbingContext,
        getTranslateApiKey,
        getTranslateBaseUrl,
        getTranslateModel,
    } = deps;

    const projectMediaEl = byId('voxcpm-project-media');
    const projectTaskEl = byId('voxcpm-project-task');
    const projectReadinessEl = byId('voxcpm-project-readiness');
    const projectNoteEl = byId('voxcpm-project-note');
    const projectSourceCountEl = byId('voxcpm-project-source-count');
    const projectTranslatedCountEl = byId('voxcpm-project-translated-count');
    const backendNoteEl = byId('voxcpm-backend-note');
    const sharedKeyNoteEl = byId('voxcpm-shared-key-note');
    const sourceLangSelect = byId('voxcpm-source');
    const targetLangSelect = byId('voxcpm-target');
    const cfgValueInput = byId('voxcpm-cfg-value');
    const inferenceStepsInput = byId('voxcpm-inference-steps');
    const subtitleScriptVariantSelect = byId('voxcpm-subtitle-script-variant');
    const subtitleVideoPresetSelect = byId('voxcpm-subtitle-video-preset');
    const translateSystemPromptInput = byId('voxcpm-translate-system-prompt');
    const podcastScriptFileInput = byId('voxcpm-podcast-script-file');
    const parsePodcastBtn = byId('voxcpm-parse-podcast-btn');
    const clearPodcastBtn = byId('voxcpm-clear-podcast-btn');
    const podcastTitleEl = byId('voxcpm-podcast-title');
    const podcastSpeakerCountEl = byId('voxcpm-podcast-speaker-count');
    const podcastLineCountEl = byId('voxcpm-podcast-line-count');
    const podcastModeEl = byId('voxcpm-podcast-mode');
    const podcastHintEl = byId('voxcpm-podcast-hint');
    const podcastPreviewEl = byId('voxcpm-podcast-preview');
    const podcastPreviewListEl = byId('voxcpm-podcast-preview-list');
    const podcastPreviewToggleBtn = byId('voxcpm-podcast-preview-toggle');
    const speakerRefListEl = byId('voxcpm-speaker-ref-list');
    const speakerRefHintEl = byId('voxcpm-speaker-ref-hint');
    const startBtn = byId('start-voxcpm-dub-btn');
    const refreshBatchesBtn = byId('voxcpm-refresh-batches-btn');
    const loadBatchBtn = byId('voxcpm-load-batch-btn');
    const resumeBatchBtn = byId('voxcpm-resume-batch-btn');
    const batchSelect = byId('voxcpm-load-batch-select');
    const batchHintEl = byId('voxcpm-batch-hint');
    const statusContainer = byId('voxcpm-status-container');
    const progressFill = byId('voxcpm-progress-fill');
    const taskLabel = byId('voxcpm-task-id');
    const lineProgressEl = byId('voxcpm-line-progress');
    const etaEl = byId('voxcpm-eta');
    const statusText = byId('voxcpm-status-text');
    const resultsContainer = byId('voxcpm-results');
    const videoVariantsListEl = byId('voxcpm-video-variants-list');
    const videoVariantsHintEl = byId('voxcpm-video-variants-hint');
    const downloadLinks = resultsContainer?.querySelector('.download-links') || null;

    const FIXED_SPEAKER_REF_TEXT_ZH = '你好，这是我的声音音色，很高兴为你提供配音服务。';
    const FIXED_SPEAKER_REF_TEXT_YUE = '你好，呢個系我嘅聲音音色，很高興為你提供配音服務。';
    let pollTimer = null;
    let backendPollTimer = null;
    let autoDubStartedAtMs = 0;
    let voxcpmBackendReady = false;
    let loadedBatchTaskId = '';
    let loadedBatchPayload = null;
    let speakerRefFiles = new Map();
    let parsedPodcastRows = [];
    let parsedPodcastSpeakerIds = [];
    let parsedPodcastMeta = null;
    let podcastPreviewExpanded = false;

    function isPlayableUrl(url) {
        const normalized = String(url || '').trim();
        return normalized.startsWith('/') || normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('blob:');
    }

    function withCacheBust(url) {
        const normalized = String(url || '').trim();
        if (!normalized) return '';
        try {
            const parsed = new URL(normalized, window.location.origin);
            parsed.searchParams.set('_ts', String(Date.now()));
            return parsed.pathname + parsed.search;
        } catch (_error) {
            return normalized;
        }
    }

    function pickVoxcpmVideoUrl(data) {
        const preferredArtifactKey = String(data?.preferred_video_artifact_key || '').trim();
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        if (preferredArtifactKey) {
            const preferredVariant = artifacts.find((item) => item?.key === preferredArtifactKey && item?.url);
            if (preferredVariant?.url) {
                return preferredVariant.url;
            }
        }
        const preferred = artifacts.find((item) => item?.key === 'video' && item?.url);
        if (preferred?.url) {
            return preferred.url;
        }
        const resultVideo = String(data?.result_video || data?.dubbed_video_full || '').trim();
        return isPlayableUrl(resultVideo) ? resultVideo : null;
    }

    function loadVoxcpmResultMediaToPlayer(data) {
        const mediaUrl = pickVoxcpmVideoUrl(data);
        if (!videoPlayer || !mediaUrl) return;
        const shouldResume = !videoPlayer.paused;
        videoPlayer.src = withCacheBust(mediaUrl);
        videoPlayer.style.display = 'block';
        videoPlayer.controls = true;
        videoPlayer.load();
        if (shouldResume) {
            videoPlayer.play().catch(() => {});
        }
        if (videoPlaceholder) {
            videoPlaceholder.style.display = 'none';
        }
    }

    function readProjectContext() {
        if (typeof getProjectDubbingContext === 'function') {
            return getProjectDubbingContext() || {};
        }
        return {};
    }

    function hasParsedPodcastRows() {
        return Array.isArray(parsedPodcastRows) && parsedPodcastRows.length > 0;
    }

    function getEffectiveRowsFromPanelState(projectContext = readProjectContext()) {
        if (hasParsedPodcastRows()) {
            return parsedPodcastRows;
        }
        const sourceItems = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const translatedItems = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        return translatedItems.length > 0 ? translatedItems : sourceItems;
    }

    /**
     * 渲染播客脚本解析预览，默认只展示前几条，避免预览区域过高。
     */
    function renderPodcastScriptPreview() {
        if (!podcastPreviewEl || !podcastPreviewListEl || !podcastPreviewToggleBtn) {
            return;
        }
        if (!hasParsedPodcastRows()) {
            podcastPreviewEl.style.display = 'none';
            podcastPreviewListEl.innerHTML = '';
            podcastPreviewToggleBtn.style.display = 'none';
            podcastPreviewToggleBtn.textContent = 'Show all';
            return;
        }

        const previewLimit = 4;
        const previewRows = podcastPreviewExpanded ? parsedPodcastRows : parsedPodcastRows.slice(0, previewLimit);
        podcastPreviewEl.style.display = 'block';
        podcastPreviewListEl.innerHTML = '';

        previewRows.forEach((row, index) => {
            const item = document.createElement('div');
            item.className = 'voxcpm-podcast-preview-item';

            const meta = document.createElement('div');
            meta.className = 'voxcpm-podcast-preview-meta';

            const speakerEl = document.createElement('span');
            speakerEl.className = 'voxcpm-podcast-preview-speaker';
            speakerEl.textContent = String(row?.speaker_id || `Speaker ${index + 1}`).trim();
            meta.appendChild(speakerEl);

            const emotion = String(row?.emotion || '').trim();
            if (emotion) {
                const emotionEl = document.createElement('span');
                emotionEl.className = 'voxcpm-podcast-preview-emotion';
                emotionEl.textContent = `情绪=${emotion}`;
                meta.appendChild(emotionEl);
            }

            const textEl = document.createElement('div');
            textEl.className = 'voxcpm-podcast-preview-text';
            textEl.textContent = String(row?.text || '').trim();

            item.appendChild(meta);
            item.appendChild(textEl);
            podcastPreviewListEl.appendChild(item);
        });

        const showToggle = parsedPodcastRows.length > previewLimit;
        podcastPreviewToggleBtn.style.display = showToggle ? 'inline-flex' : 'none';
        podcastPreviewToggleBtn.textContent = podcastPreviewExpanded ? 'Collapse' : 'Show all';
    }

    function renderPodcastScriptSummary() {
        if (podcastTitleEl) {
            podcastTitleEl.textContent = parsedPodcastMeta?.title || '未解析';
        }
        if (podcastSpeakerCountEl) {
            podcastSpeakerCountEl.textContent = `${parsedPodcastSpeakerIds.length} 个`;
        }
        if (podcastLineCountEl) {
            podcastLineCountEl.textContent = `${parsedPodcastRows.length} 行`;
        }
        if (podcastModeEl) {
            podcastModeEl.textContent = parsedPodcastMeta?.detected_mode || '未解析';
        }
        if (podcastHintEl) {
            if (hasParsedPodcastRows()) {
                const sourceLabel = String(parsedPodcastMeta?.source_label || '').trim();
                podcastHintEl.textContent = sourceLabel
                    ? `已解析播客脚本，当前优先使用脚本结果。来源：${sourceLabel}`
                    : '已解析播客脚本，当前优先使用脚本结果。';
            } else {
                podcastHintEl.textContent = '支持上传 `.md / .txt` 播客脚本。解析成功后，6 号面板会优先使用脚本结果，而不是当前项目字幕。';
            }
        }
        renderPodcastScriptPreview();
    }

    function getSupportedVideoPresets() {
        return [
            { value: '1920x1080', label: '1920x1080 (16:9)' },
            { value: '1080x1920', label: '1080x1920 (9:16)' },
            { value: '1440x1080', label: '1440x1080 (4:3)' },
            { value: '1080x1440', label: '1080x1440 (3:4)' },
        ];
    }

    function renderVideoVariants(data) {
        if (!videoVariantsListEl || !videoVariantsHintEl) return;
        const payload = data || loadedBatchPayload || {};
        const generated = new Set((Array.isArray(payload?.generated_subtitle_video_presets) ? payload.generated_subtitle_video_presets : []).map((item) => String(item || '').trim()));
        const status = String(payload?.status || '').trim().toLowerCase();
        const canRender = status === 'completed';
        videoVariantsListEl.innerHTML = '';

        if (!canRender) {
            videoVariantsHintEl.textContent = '只有已完成批次才可以补生成其他规格。';
            return;
        }
        videoVariantsHintEl.textContent = '已生成的规格会置灰；点击未生成规格时，只重做 ASS 和黑底字幕视频，不重新配音。';

        getSupportedVideoPresets().forEach((preset) => {
            const button = document.createElement('button');
            const generatedAlready = generated.has(preset.value);
            button.type = 'button';
            button.className = generatedAlready ? 'secondary-btn voxcpm-video-variant-btn is-generated' : 'ghost-btn voxcpm-video-variant-btn';
            button.textContent = generatedAlready ? `${preset.label} · 已生成` : `生成 ${preset.label}`;
            button.disabled = generatedAlready;
            if (!generatedAlready) {
                button.addEventListener('click', () => {
                    renderVideoVariant(preset.value, button);
                });
            }
            videoVariantsListEl.appendChild(button);
        });
    }

    async function renderVideoVariant(preset, buttonEl) {
        const batchId = String(loadedBatchTaskId || batchSelect?.value || '').trim();
        if (!batchId) {
            if (videoVariantsHintEl) videoVariantsHintEl.textContent = '请先加载一个已完成的 VoxCPM 批次。';
            return;
        }
        try {
            if (buttonEl) {
                buttonEl.disabled = true;
                buttonEl.textContent = '生成中...';
            }
            if (videoVariantsHintEl) {
                videoVariantsHintEl.textContent = `正在补生成 ${preset} 字幕视频...`;
            }
            const formData = new FormData();
            formData.append('batch_id', batchId);
            formData.append('subtitle_video_preset', preset);
            const response = await fetch('/voxcpm/auto/render-video-variant', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || 'Failed to render subtitle video variant');
            }
            loadedBatchPayload = data;
            renderArtifacts(data);
            renderVideoVariants(data);
            if (videoVariantsHintEl) {
                videoVariantsHintEl.textContent = `${preset} 字幕视频已生成。`;
            }
        } catch (error) {
            if (videoVariantsHintEl) {
                videoVariantsHintEl.textContent = `补生成失败：${error.message}`;
            }
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.textContent = `生成 ${preset}`;
            }
        }
    }

    function clearParsedPodcastState() {
        parsedPodcastRows = [];
        parsedPodcastSpeakerIds = [];
        parsedPodcastMeta = null;
        podcastPreviewExpanded = false;
        if (podcastScriptFileInput) {
            podcastScriptFileInput.value = '';
        }
        renderPodcastScriptSummary();
        renderProjectSummary();
    }

    function renderProjectSummary() {
        const projectContext = readProjectContext();
        const sourceItems = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const translatedItems = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        const mediaName = projectContext?.mediaOriginalFilename || projectContext?.mediaFilename || '';
        const willUseTranslated = translatedItems.length > 0;
        const usingPodcastScript = hasParsedPodcastRows();
        if (projectMediaEl) {
            projectMediaEl.textContent = mediaName || '未上传媒体';
        }
        if (projectTaskEl) {
            projectTaskEl.textContent = projectContext?.taskId || '未生成';
        }
        if (projectSourceCountEl) {
            projectSourceCountEl.textContent = `${usingPodcastScript ? parsedPodcastRows.length : sourceItems.length} 行`;
        }
        if (projectTranslatedCountEl) {
            projectTranslatedCountEl.textContent = `${usingPodcastScript ? 0 : translatedItems.length} 行`;
        }
        if (projectReadinessEl) {
            projectReadinessEl.textContent = (usingPodcastScript || sourceItems.length > 0 || translatedItems.length > 0)
                ? '可复用'
                : '缺少字幕';
        }
        if (projectNoteEl) {
            if (usingPodcastScript) {
                projectNoteEl.textContent = '当前 6 号面板已解析播客脚本，启动时会优先使用脚本结果；Speaker Refs 也会按脚本里的角色列表刷新。';
            } else if (sourceItems.length === 0 && translatedItems.length === 0) {
                projectNoteEl.textContent = '当前项目还没有可用字幕。VoxCPM 需要当前项目里已有字幕。';
            } else if (willUseTranslated) {
                projectNoteEl.textContent = '当前项目已有译文，6 号面板会优先直接使用译文配音；只有没有译文时，才会回退原字幕并先翻译。';
            } else {
                projectNoteEl.textContent = '当前项目暂无译文，6 号面板会使用原字幕先翻译再配音，并固定输出黑底居中字幕视频。';
            }
        }
        if (sharedKeyNoteEl) {
            const key = getTranslateApiKey ? getTranslateApiKey() : '';
            const baseUrl = getTranslateBaseUrl ? getTranslateBaseUrl() : '';
            const model = getTranslateModel ? getTranslateModel() : '';
            if (key) {
                sharedKeyNoteEl.textContent = `当前使用翻译 API 配置：${baseUrl || '默认 Base URL'} / ${model || '默认 Model'}。`;
            } else {
                sharedKeyNoteEl.textContent = '如果当前项目需要翻译 source 字幕，将复用左侧 Translation API 配置或后端环境变量。';
            }
        }
        renderPodcastScriptSummary();
        renderSpeakerReferenceInputs();
    }

    function normalizeSpeakerIdsForPanelRows(rows) {
        const normalized = [];
        let previousSpeakerId = '';
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const explicitSpeakerId = String(row?.speaker_id || '').trim();
            const speakerId = explicitSpeakerId || previousSpeakerId || 'Speaker 1';
            normalized.push(speakerId);
            previousSpeakerId = speakerId;
        });
        return normalized;
    }

    function getEffectiveSubtitleRows(projectContext) {
        return getEffectiveRowsFromPanelState(projectContext);
    }

    function getDetectedSpeakerIds(projectContext = readProjectContext()) {
        const rows = getEffectiveSubtitleRows(projectContext);
        const ordered = [];
        const seen = new Set();
        normalizeSpeakerIdsForPanelRows(rows).forEach((speakerId) => {
            if (!seen.has(speakerId)) {
                seen.add(speakerId);
                ordered.push(speakerId);
            }
        });
        return ordered;
    }

    function isCantoneseLanguage(value) {
        const lowered = String(value || '').trim().toLowerCase();
        if (!lowered) return false;
        return ['cantonese', 'cantonese-mainland', 'mainland cantonese', 'yue', '粤语', '廣東話', '广东话'].some((marker) => lowered.includes(marker));
    }

    function getSpeakerRefTextForTargetLang() {
        return isCantoneseLanguage(targetLangSelect?.value || '') ? FIXED_SPEAKER_REF_TEXT_YUE : FIXED_SPEAKER_REF_TEXT_ZH;
    }

    /**
     * 只有粤语目标语才显示简繁切换；其他语言直接隐藏。
     */
    function syncSubtitleScriptVariantVisibility() {
        if (!subtitleScriptVariantSelect) return;
        const wrapper = subtitleScriptVariantSelect.closest('.input-group');
        const visible = isCantoneseLanguage(targetLangSelect?.value || '');
        if (wrapper) {
            wrapper.style.display = visible ? '' : 'none';
        }
        if (visible && !subtitleScriptVariantSelect.value) {
            subtitleScriptVariantSelect.value = 'traditional';
        }
    }

    function renderSpeakerRefHint() {
        if (!speakerRefHintEl) return;
        const speakerIds = getDetectedSpeakerIds();
        if (speakerIds.length === 0) {
            speakerRefHintEl.textContent = '当前项目字幕里还没有 speaker 信息；请上传带 Speaker 前缀或 speaker_id 的字幕。';
            return;
        }
        const missing = speakerIds.filter((speakerId) => !speakerRefFiles.get(speakerId));
        if (missing.length === 0) {
            speakerRefHintEl.textContent = `已就绪：${speakerIds.length} 个 speaker 都已上传参考音。`;
            return;
        }
        speakerRefHintEl.textContent = `当前检测到 ${speakerIds.length} 个 speaker。未上传的 ${missing.length} 个 speaker 会由后端先判男女，再从预置参考音中随机补齐；纯字幕模式下无法判男女时会直接随机补位。`;
    }

    function renderSpeakerReferenceInputs() {
        if (!speakerRefListEl || !speakerRefHintEl) return;
        const projectContext = readProjectContext();
        const speakerIds = getDetectedSpeakerIds(projectContext);
        const speakerRefText = getSpeakerRefTextForTargetLang();
        const nextMap = new Map();
        speakerRefListEl.innerHTML = '';

        if (speakerIds.length === 0) {
            renderSpeakerRefHint();
            return;
        }

        speakerIds.forEach((speakerId) => {
            const existingFile = speakerRefFiles.get(speakerId) || null;
            if (existingFile) {
                nextMap.set(speakerId, existingFile);
            }

            const row = document.createElement('div');
            row.className = 'voxcpm-speaker-ref-row';

            const meta = document.createElement('div');
            meta.className = 'voxcpm-speaker-ref-meta';
            const title = document.createElement('div');
            title.className = 'voxcpm-speaker-ref-title';
            title.textContent = speakerId;
            const copy = document.createElement('div');
            copy.className = 'voxcpm-speaker-ref-copy';
            copy.textContent = `参考文本固定为：${speakerRefText}`;
            meta.appendChild(title);
            meta.appendChild(copy);

            const inputWrap = document.createElement('div');
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg';
            input.className = 'voxcpm-speaker-ref-input';
            input.dataset.speakerId = speakerId;
            const status = document.createElement('span');
            status.className = 'voxcpm-speaker-ref-status';
            status.textContent = existingFile ? `已选择：${existingFile.name}` : '未上传参考音';
            input.addEventListener('change', () => {
                const file = input.files && input.files[0] ? input.files[0] : null;
                if (file) {
                    speakerRefFiles.set(speakerId, file);
                    status.textContent = `已选择：${file.name}`;
                } else {
                    speakerRefFiles.delete(speakerId);
                    status.textContent = '未上传参考音';
                }
                renderSpeakerRefHint();
            });
            inputWrap.appendChild(input);
            inputWrap.appendChild(status);

            row.appendChild(meta);
            row.appendChild(inputWrap);
            speakerRefListEl.appendChild(row);
        });

        speakerRefFiles = nextMap;
        renderSpeakerRefHint();
    }

    function validateSpeakerReferenceUploads() {
        const speakerIds = getDetectedSpeakerIds();
        return speakerIds.filter((speakerId) => !!speakerRefFiles.get(speakerId));
    }

    /**
     * 同步 6 号面板启动相关按钮状态，避免后端未 ready 时误点。
     */
    function syncStartButtonState() {
        if (startBtn) {
            startBtn.disabled = !voxcpmBackendReady;
        }
        if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') {
            resumeBatchBtn.disabled = !voxcpmBackendReady;
        }
    }

    async function refreshBackendStatus({ scheduleRetry = true } = {}) {
        const apiUrl = 'http://127.0.0.1:7860';
        try {
            const response = await fetch(`/voxcpm/auto/backend-status?voxcpm_api_url=${encodeURIComponent(apiUrl)}`);
            const data = await response.json();
            voxcpmBackendReady = !!data?.ready;
            if (backendNoteEl) {
                backendNoteEl.textContent = voxcpmBackendReady
                    ? `VoxCPM 后端已就绪：${data?.device || 'unknown device'}`
                    : `VoxCPM 后端未就绪：${data?.detail || 'unknown error'}`;
            }
            syncStartButtonState();
            if (voxcpmBackendReady && backendPollTimer) {
                clearInterval(backendPollTimer);
                backendPollTimer = null;
            } else if (!voxcpmBackendReady && scheduleRetry && !backendPollTimer) {
                backendPollTimer = setInterval(() => {
                    refreshBackendStatus({ scheduleRetry: false }).catch(() => {});
                }, 5000);
            }
            return data;
        } catch (error) {
            voxcpmBackendReady = false;
            if (backendNoteEl) {
                backendNoteEl.textContent = `VoxCPM 后端状态检查失败：${error.message}`;
            }
            syncStartButtonState();
            if (scheduleRetry && !backendPollTimer) {
                backendPollTimer = setInterval(() => {
                    refreshBackendStatus({ scheduleRetry: false }).catch(() => {});
                }, 5000);
            }
            return { ready: false, detail: error.message };
        }
    }

    function buildCurrentProjectRequest() {
        const projectContext = readProjectContext();
        const mediaFilename = String(projectContext?.mediaFilename || '').trim();
        const projectSourceSubtitles = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const projectTranslatedSubtitles = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        const sourceSubtitles = hasParsedPodcastRows() ? parsedPodcastRows : projectSourceSubtitles;
        const translatedSubtitles = hasParsedPodcastRows() ? [] : projectTranslatedSubtitles;
        if (sourceSubtitles.length === 0 && translatedSubtitles.length === 0) {
            throw new Error('VoxCPM 需要当前项目里已有字幕。');
        }
        const formData = new FormData();
        formData.append('filename', mediaFilename);
        formData.append('original_filename', projectContext?.mediaOriginalFilename || mediaFilename);
        formData.append('task_id', projectContext?.taskId || '');
        formData.append('source_subtitles_json', JSON.stringify(sourceSubtitles));
        formData.append('translated_subtitles_json', JSON.stringify(translatedSubtitles));
        formData.append('subtitle_mode', translatedSubtitles.length > 0 ? 'translated' : 'source');
        formData.append('source_lang', sourceLangSelect?.value || 'Chinese');
        formData.append('target_lang', targetLangSelect?.value || 'Chinese');
        formData.append('api_key', getTranslateApiKey ? getTranslateApiKey() : '');
        formData.append('translate_base_url', getTranslateBaseUrl ? getTranslateBaseUrl() : '');
        formData.append('translate_model', getTranslateModel ? getTranslateModel() : '');
        formData.append('translate_system_prompt', String(translateSystemPromptInput?.value || '').trim());
        formData.append('voxcpm_api_url', 'http://127.0.0.1:7860');
        formData.append('cfg_value', String(cfgValueInput?.value || '2.0'));
        formData.append('inference_timesteps', String(inferenceStepsInput?.value || '10'));
        formData.append('subtitle_video_preset', subtitleVideoPresetSelect?.value || '1920x1080');
        if (isCantoneseLanguage(targetLangSelect?.value || '')) {
            formData.append('subtitle_script_variant', subtitleScriptVariantSelect?.value || 'traditional');
        }
        const speakerIds = validateSpeakerReferenceUploads();
        formData.append('speaker_ref_speaker_ids_json', JSON.stringify(speakerIds));
        speakerIds.forEach((speakerId) => {
            const file = speakerRefFiles.get(speakerId);
            if (file) {
                formData.append('speaker_ref_files', file, file.name);
            }
        });
        return formData;
    }

    async function parsePodcastScript() {
        const file = podcastScriptFileInput?.files && podcastScriptFileInput.files[0] ? podcastScriptFileInput.files[0] : null;
        if (!file) {
            if (podcastHintEl) podcastHintEl.textContent = '请先选择一个播客脚本文件。';
            return;
        }
        try {
            const formData = new FormData();
            formData.append('script_file', file, file.name);
            if (parsePodcastBtn) parsePodcastBtn.disabled = true;
            const response = await fetch('/voxcpm/auto/parse-podcast-script', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || 'Failed to parse podcast script');
            }
            parsedPodcastRows = Array.isArray(data?.rows) ? data.rows : [];
            parsedPodcastSpeakerIds = Array.isArray(data?.speaker_ids) ? data.speaker_ids : [];
            podcastPreviewExpanded = false;
            parsedPodcastMeta = {
                title: data?.title || file.name,
                source_label: data?.source_label || '',
                detected_mode: data?.detected_mode || 'single',
                skipped_blocks_count: Number(data?.skipped_blocks_count || 0),
                filename: data?.filename || file.name,
            };
            renderProjectSummary();
        } catch (error) {
            if (podcastHintEl) {
                podcastHintEl.textContent = `播客脚本解析失败：${error.message}`;
            }
        } finally {
            if (parsePodcastBtn) parsePodcastBtn.disabled = false;
        }
    }

    function renderTaskState(data) {
        const normalizedStatus = String(data?.status || '').trim().toLowerCase();
        const elapsedLabel = typeof buildAutoDubElapsedLabel === 'function'
            ? buildAutoDubElapsedLabel(data, autoDubStartedAtMs)
            : '';
        if (subtitleVideoPresetSelect && data?.subtitle_video_preset) {
            subtitleVideoPresetSelect.value = String(data.subtitle_video_preset);
        }
        if (taskLabel) {
            taskLabel.textContent = `Task ${data?.task_id || data?.id || '—'}`;
        }
        if (lineProgressEl) {
            const processed = Number(data?.processed_segments || 0);
            const total = Number(data?.total_segments || 0);
            lineProgressEl.textContent = total > 0 ? `Lines ${processed}/${total}` : 'Lines —';
        }
        if (etaEl) {
            if (normalizedStatus === 'completed') {
                etaEl.textContent = elapsedLabel || '用时 —';
            } else if (normalizedStatus === 'failed') {
                etaEl.textContent = elapsedLabel || 'ETA —';
            } else {
                etaEl.textContent = elapsedLabel || (typeof formatEtaAsSegmentProgress === 'function'
                    ? formatEtaAsSegmentProgress(data?.processed_segments ?? 0, data?.total_segments ?? 0)
                    : 'ETA —');
            }
        }
        if (progressFill) {
            const progress = Math.max(0, Math.min(100, Number(data?.progress || 0)));
            progressFill.style.width = `${progress}%`;
        }
        if (statusText) {
            const error = String(data?.error || '').trim();
            if (error) {
                statusText.textContent = error;
                statusText.className = 'status-text error';
            } else if (normalizedStatus === 'completed') {
                statusText.textContent = elapsedLabel ? `Process Complete · ${elapsedLabel}` : 'Process Complete';
                statusText.className = 'status-text success';
            } else {
                statusText.textContent = data?.stage || data?.status || 'Waiting';
                statusText.className = 'status-text';
            }
        }
        syncSubtitleScriptVariantVisibility();
    }

    /**
     * 根据当前 batch 的恢复能力刷新 resume 入口。
     */
    function renderResumeAction(data) {
        if (!resumeBatchBtn) return;
        const resumable = !!data?.resumable;
        const resumeStage = String(data?.resume_stage || '').trim();
        loadedBatchTaskId = String(data?.id || data?.task_id || data?.batch_id || batchSelect?.value || '').trim();
        if (resumeStage === 'completed') {
            resumeBatchBtn.style.display = 'inline-flex';
            resumeBatchBtn.textContent = '该批次已完成';
            resumeBatchBtn.disabled = true;
            return;
        }
        if (!resumable || !loadedBatchTaskId) {
            resumeBatchBtn.style.display = 'none';
            resumeBatchBtn.disabled = true;
            return;
        }
        resumeBatchBtn.style.display = 'inline-flex';
        const completed = Number(data?.processed_segments ?? data?.completed_segments ?? 0);
        const total = Number(data?.total_segments ?? 0);
        if (resumeStage === 'prepared') {
            resumeBatchBtn.textContent = '跳过翻译继续配音';
        } else if (resumeStage === 'dubbing_partial') {
            resumeBatchBtn.textContent = total > 0 ? `从第 ${Math.min(total, completed + 1)} 条继续配音` : '从断点继续配音';
        } else {
            resumeBatchBtn.textContent = '从断点继续配音';
        }
        resumeBatchBtn.disabled = !voxcpmBackendReady;
    }

    function renderArtifacts(data) {
        if (!resultsContainer || !downloadLinks) return;
        loadedBatchPayload = data || loadedBatchPayload;
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        if (artifacts.length === 0) {
            resultsContainer.style.display = 'none';
            return;
        }
        loadVoxcpmResultMediaToPlayer(data);
        downloadLinks.innerHTML = '';
        artifacts.forEach((artifact, index) => {
            if (!artifact?.url) return;
            const link = document.createElement('a');
            link.href = artifact.url;
            link.className = index === 0 ? 'primary-btn' : 'secondary-btn';
            link.textContent = artifact.label || artifact.key || artifact.url;
            link.style.display = 'block';
            link.style.textAlign = 'center';
            downloadLinks.appendChild(link);
        });
        renderVideoVariants(data);
        resultsContainer.style.display = 'block';
    }

    function stopPolling() {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    async function pollStatus(taskId) {
        stopPolling();
        const tick = async () => {
            try {
                const response = await fetch(`/voxcpm/auto/status/${encodeURIComponent(taskId)}`);
                const data = await response.json();
                renderTaskState(data);
                renderResumeAction(data);
                if (data?.status === 'completed' || data?.status === 'failed') {
                    renderArtifacts(data);
                    if (startBtn) startBtn.disabled = false;
                    if (loadBatchBtn) loadBatchBtn.disabled = false;
                    if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
                    if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') resumeBatchBtn.disabled = false;
                    return;
                }
            } catch (error) {
                if (statusText) {
                    statusText.textContent = `Status check failed: ${error.message}`;
                    statusText.className = 'status-text error';
                }
                if (startBtn) startBtn.disabled = false;
                if (loadBatchBtn) loadBatchBtn.disabled = false;
                if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
                if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') resumeBatchBtn.disabled = false;
                return;
            }
            pollTimer = setTimeout(tick, 2000);
        };
        pollTimer = setTimeout(tick, 1000);
    }

    async function refreshBatchList() {
        try {
            if (batchHintEl) batchHintEl.textContent = '正在加载 VoxCPM 结果文件夹列表...';
            const response = await fetch('/voxcpm/auto/batches');
            const data = await response.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            if (batchSelect) {
                batchSelect.innerHTML = items.length > 0
                    ? items.map((item) => `<option value="${String(item.batch_id || '').replace(/"/g, '&quot;')}">${item.batch_id} · ${item.project_filename || 'unnamed'} · ${item.status || 'unknown'}</option>`).join('')
                    : '<option value="">暂无可加载结果</option>';
            }
            if (batchHintEl) {
                batchHintEl.textContent = items.length > 0 ? `已找到 ${items.length} 个 VoxCPM 结果文件夹` : '当前没有可加载的 VoxCPM 结果文件夹';
            }
        } catch (error) {
            if (batchHintEl) batchHintEl.textContent = `加载 VoxCPM 结果列表失败：${error.message}`;
        }
    }

    async function loadBatch() {
        const batchId = String(batchSelect?.value || '').trim();
        if (!batchId) {
            if (batchHintEl) batchHintEl.textContent = '请先选择一个 VoxCPM 结果文件夹';
            return;
        }
        try {
            const formData = new FormData();
            formData.append('batch_id', batchId);
            const response = await fetch('/voxcpm/auto/load-batch', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || 'Failed to load VoxCPM batch');
            }
            loadedBatchPayload = data;
            if (statusContainer) statusContainer.style.display = 'block';
            renderTaskState(data);
            renderArtifacts(data);
            renderResumeAction(data);
            if (batchHintEl) batchHintEl.textContent = `已加载 ${batchId}`;
        } catch (error) {
            if (batchHintEl) batchHintEl.textContent = `加载 VoxCPM 结果失败：${error.message}`;
        }
    }

    /**
     * 对当前已加载批次发起 resume，只续跑缺失 segment。
     */
    async function resumeLoadedBatch() {
        const taskId = String(loadedBatchTaskId || batchSelect?.value || '').trim();
        if (!taskId) {
            if (batchHintEl) batchHintEl.textContent = '请先加载一个 VoxCPM 批次';
            return;
        }
        try {
            if (resumeBatchBtn) resumeBatchBtn.disabled = true;
            if (startBtn) startBtn.disabled = true;
            if (loadBatchBtn) loadBatchBtn.disabled = true;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = true;
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (statusContainer) statusContainer.style.display = 'block';
            if (statusText) {
                statusText.textContent = 'Resuming...';
                statusText.className = 'status-text';
            }
            autoDubStartedAtMs = Date.now();
            const response = await fetch(`/voxcpm/auto/resume/${encodeURIComponent(taskId)}`, {
                method: 'POST',
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || 'Failed to resume VoxCPM task');
            }
            renderTaskState(data);
            renderResumeAction(data);
            if (batchHintEl) batchHintEl.textContent = `已恢复 ${taskId}`;
            pollStatus(data.task_id || data.id || taskId);
        } catch (error) {
            if (statusText) {
                statusText.textContent = `Failed: ${error.message}`;
                statusText.className = 'status-text error';
            }
            if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') resumeBatchBtn.disabled = false;
            if (startBtn) startBtn.disabled = false;
            if (loadBatchBtn) loadBatchBtn.disabled = false;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
        }
    }

    async function startTask() {
        try {
            const backendStatus = await refreshBackendStatus({ scheduleRetry: false });
            if (!backendStatus?.ready) {
                throw new Error(backendStatus?.detail || 'VoxCPM backend is still loading');
            }
            const formData = buildCurrentProjectRequest();
            if (startBtn) startBtn.disabled = true;
            if (loadBatchBtn) loadBatchBtn.disabled = true;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = true;
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (statusContainer) statusContainer.style.display = 'block';
            if (statusText) {
                statusText.textContent = 'Initializing...';
                statusText.className = 'status-text';
            }
            if (progressFill) {
                progressFill.style.width = '8%';
            }
            autoDubStartedAtMs = Date.now();
            const response = await fetch('/voxcpm/auto/start-from-project', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || 'Failed to start VoxCPM task');
            }
            renderTaskState(data);
            renderResumeAction(data);
            pollStatus(data.task_id);
        } catch (error) {
            if (statusText) {
                statusText.textContent = `Failed: ${error.message}`;
                statusText.className = 'status-text error';
            }
            if (startBtn) startBtn.disabled = false;
            if (loadBatchBtn) loadBatchBtn.disabled = false;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
        }
    }

    startBtn?.addEventListener('click', startTask);
    parsePodcastBtn?.addEventListener('click', parsePodcastScript);
    clearPodcastBtn?.addEventListener('click', clearParsedPodcastState);
    podcastPreviewToggleBtn?.addEventListener('click', () => {
        podcastPreviewExpanded = !podcastPreviewExpanded;
        renderPodcastScriptPreview();
    });
    refreshBatchesBtn?.addEventListener('click', refreshBatchList);
    loadBatchBtn?.addEventListener('click', loadBatch);
    resumeBatchBtn?.addEventListener('click', resumeLoadedBatch);
    targetLangSelect?.addEventListener('change', () => {
        syncSubtitleScriptVariantVisibility();
        renderProjectSummary();
    });
    window.addEventListener('subtitle-maker:project-context-changed', renderProjectSummary);
    window.addEventListener('subtitle-maker:translate-config-changed', renderProjectSummary);

    renderProjectSummary();
    syncSubtitleScriptVariantVisibility();
    syncStartButtonState();
    refreshBackendStatus();
    refreshBatchList();
}
