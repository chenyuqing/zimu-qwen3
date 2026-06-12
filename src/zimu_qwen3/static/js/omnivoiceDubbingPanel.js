/**
 * 初始化独立 OmniVoice Auto Dub 面板。
 * 这条链路不复用 4.Auto Dubbing 的 backend 状态，只读取当前项目上下文和翻译配置。
 */
export function setupOmnivoiceDubbingPanel(deps) {
    const byId = (id) => document.getElementById(id);
    const panelEl = byId('panel-auto-dub-omnivoice');
    if (!panelEl) return;

    const {
        buildAutoDubElapsedLabel,
        describeAutoStage,
        formatLineProgress,
        formatEtaAsSegmentProgress,
        audioTrackController,
        getProjectDubbingContext,
        getTranslateApiKey,
        getTranslateBaseUrl,
        getTranslateModel,
        refreshSubtitleOverlay,
        setOmnivoiceSubtitlePreview,
        clearOmnivoiceSubtitlePreview,
    } = deps;

    const projectMediaEl = byId('omnivoice-project-media');
    const projectTaskEl = byId('omnivoice-project-task');
    const projectReadinessEl = byId('omnivoice-project-readiness');
    const projectNoteEl = byId('omnivoice-project-note');
    const projectSourceCountEl = byId('omnivoice-project-source-count');
    const projectTranslatedCountEl = byId('omnivoice-project-translated-count');
    const subtitleModeSelect = byId('omnivoice-subtitle-mode');
    const sourceLangSelect = byId('omnivoice-source');
    const targetLangSelect = byId('omnivoice-target');
    const translateSystemPromptInput = byId('omnivoice-translate-system-prompt');
    const enableSourceSeparationCheckbox = byId('omnivoice-enable-source-separation');
    const sharedKeyNoteEl = byId('omnivoice-shared-key-note');
    const backendNoteEl = byId('omnivoice-backend-note');
    const speakerRefListEl = byId('omnivoice-speaker-ref-list');
    const speakerRefHintEl = byId('omnivoice-speaker-ref-hint');
    const prepareBtn = byId('prepare-omnivoice-subtitles-btn');
    const startBtn = byId('start-omnivoice-dub-btn');
    const batchSelect = byId('omnivoice-load-batch-select');
    const refreshBatchesBtn = byId('omnivoice-refresh-batches-btn');
    const loadBatchBtn = byId('omnivoice-load-batch-btn');
    const resumeBatchBtn = byId('omnivoice-resume-batch-btn');
    const batchHintEl = byId('omnivoice-batch-hint');
    const statusContainer = byId('omnivoice-status-container');
    const progressFill = byId('omnivoice-progress-fill');
    const statusText = byId('omnivoice-status-text');
    const taskLabel = byId('omnivoice-task-id');
    const lineProgressEl = byId('omnivoice-line-progress');
    const etaEl = byId('omnivoice-eta');
    const resultsContainer = byId('omnivoice-results');
    const downloadLinks = resultsContainer?.querySelector('.download-links') || null;

    const SUBTITLE_MODE_KEY = 'sm_omnivoiceSubtitleMode';
    const PREPARED_BATCH_STATE_KEY = 'sm_omnivoicePreparedBatchState';
    const FIXED_SPEAKER_REF_TEXT_ZH = '你好，这是我的声音音色，很高兴为你提供配音服务。';
    const FIXED_SPEAKER_REF_TEXT_YUE = '你好，呢個系我嘅聲音音色，很高興為你提供配音服務。';
    let pollTimer = null;
    let backendPollTimer = null;
    let autoDubStartedAtMs = null;
    let omnivoiceBackendReady = false;
    let speakerRefFiles = new Map();
    let omnivoiceResultLoadSeq = 0;
    let preparedBatchId = '';
    let loadedBatchTaskId = '';

    /**
     * 按当前项目生成 prepared batch 的本地缓存快照，用于页面重启后的“跳过翻译直配音”恢复。
     */
    function buildPreparedBatchState(projectContext, batchId) {
        const mediaFilename = String(projectContext?.mediaFilename || '').trim();
        return {
            batchId: String(batchId || '').trim(),
            mediaFilename,
            updatedAt: Date.now(),
        };
    }

    /**
     * 判断本地缓存的 prepared batch 是否仍和当前项目兼容。
     */
    function isPreparedBatchStateCompatible(projectContext, state) {
        const mediaFilename = String(projectContext?.mediaFilename || '').trim();
        const stateMediaFilename = String(state?.mediaFilename || '').trim();
        if (!mediaFilename || !stateMediaFilename) return false;
        return mediaFilename === stateMediaFilename;
    }

    /**
     * 持久化 prepared batch，重启页面后可直接跳过翻译进入配音。
     */
    function persistPreparedBatchState(batchId, projectContext = readProjectContext()) {
        const normalizedBatchId = String(batchId || '').trim();
        preparedBatchId = normalizedBatchId;
        if (!normalizedBatchId) {
            localStorage.removeItem(PREPARED_BATCH_STATE_KEY);
            return;
        }
        const state = buildPreparedBatchState(projectContext, normalizedBatchId);
        localStorage.setItem(PREPARED_BATCH_STATE_KEY, JSON.stringify(state));
    }

    /**
     * 从本地恢复 prepared batch；仅在媒体文件一致时恢复，避免串项目。
     */
    function restorePreparedBatchState() {
        const raw = localStorage.getItem(PREPARED_BATCH_STATE_KEY);
        if (!raw) {
            preparedBatchId = '';
            return;
        }
        try {
            const state = JSON.parse(raw);
            if (!isPreparedBatchStateCompatible(readProjectContext(), state)) {
                persistPreparedBatchState('');
                return;
            }
            preparedBatchId = String(state?.batchId || '').trim();
        } catch (_) {
            persistPreparedBatchState('');
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
     * 统计字幕里的 speaker 数量，便于当前项目状态更直观。
     */
    function countSpeakers(rows) {
        const speakerSet = new Set();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const speakerId = String(row?.speaker_id || '').trim();
            if (speakerId) {
                speakerSet.add(speakerId);
            }
        });
        return speakerSet.size;
    }

    /**
     * 判断当前语言值是否属于粤语同义写法。
     */
    function isCantoneseLanguage(value) {
        const lowered = String(value || '').trim().toLowerCase();
        if (!lowered) return false;
        return ['cantonese', 'cantonese-mainland', 'mainland cantonese', 'yue', '粤语', '廣東話', '广东话'].some((marker) => lowered.includes(marker));
    }

    /**
     * 判断当前语言值是否属于“广东式口语”这一档。
     */
    function isMainlandCantoneseLanguage(value) {
        const lowered = String(value || '').trim().toLowerCase();
        if (!lowered) return false;
        return ['cantonese-mainland', 'mainland cantonese', 'mainland-cantonese', '广东式粤语', '廣東式粵語', '繁体粤语', '繁體粵語', '简体粤语', '簡體粵語'].some((marker) => lowered.includes(marker));
    }

    /**
     * 返回当前粤语目标语对应的翻译风格标签。
     */
    function getCantoneseStyleLabel(value) {
        return isMainlandCantoneseLanguage(value) ? '广东式口语 + 繁体粤语' : '港式口语 + 繁体粤语';
    }

    /**
     * 根据目标语种返回当前 speaker 参考文本。
     */
    function getSpeakerRefTextForTargetLang() {
        return isCantoneseLanguage(targetLangSelect?.value || '') ? FIXED_SPEAKER_REF_TEXT_YUE : FIXED_SPEAKER_REF_TEXT_ZH;
    }

    /**
     * 切换目标语时，刷新 speaker 参考文本与提示。
     */
    function syncSpeakerRefCopy() {
        renderSpeakerReferenceInputs();
        renderSpeakerRefHint();
    }

    /**
     * 根据当前 subtitle_mode 选出本轮真正用于 speaker 映射的字幕集合。
     */
    function getEffectiveSubtitleRows(projectContext) {
        const sourceItems = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const translatedItems = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        const preferredMode = subtitleModeSelect?.value || '';
        if (preferredMode === 'translated' && translatedItems.length > 0) {
            return translatedItems;
        }
        if (preferredMode === 'source' && sourceItems.length > 0) {
            return sourceItems;
        }
        return translatedItems.length > 0 ? translatedItems : sourceItems;
    }

    /**
     * 提取稳定 speaker 列表。
     * 5 号面板前端只信任字幕里已经显式存在的 `speaker_id`，绝不在 UI 层凭空补 `Speaker 1`。
     */
    function getDetectedSpeakerIds(projectContext = readProjectContext()) {
        const rows = getEffectiveSubtitleRows(projectContext);
        const ordered = [];
        const seen = new Set();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const speakerId = String(row?.speaker_id || '').trim();
            if (!speakerId || seen.has(speakerId)) {
                return;
            }
            seen.add(speakerId);
            ordered.push(speakerId);
        });
        if (ordered.length === 0 && Array.isArray(rows) && rows.length > 0) {
            return ['Speaker 1'];
        }
        return ordered;
    }

    /**
     * 渲染 strict speaker 参考音上传列表。
     */
    function renderSpeakerReferenceInputs() {
        if (!speakerRefListEl || !speakerRefHintEl) return;
        const projectContext = readProjectContext();
        const speakerIds = getDetectedSpeakerIds(projectContext);
        const speakerRefText = getSpeakerRefTextForTargetLang();
        const nextMap = new Map();
        speakerRefListEl.innerHTML = '';

        const hasSubtitleRows = Array.isArray(getEffectiveSubtitleRows(projectContext)) && getEffectiveSubtitleRows(projectContext).length > 0;
        if (speakerIds.length === 0) {
            speakerRefHintEl.textContent = '当前项目字幕里还没有字幕，暂时无法建立 speaker 参考音映射。';
            return;
        }
        if (speakerIds.length === 1 && speakerIds[0] === 'Speaker 1' && hasSubtitleRows) {
            speakerRefHintEl.textContent = '当前项目未检测到显式 speaker，先按单个 Speaker 1 处理；请上传这位 speaker 的参考音。';
        }

        speakerIds.forEach((speakerId) => {
            const existingFile = speakerRefFiles.get(speakerId) || null;
            if (existingFile) {
                nextMap.set(speakerId, existingFile);
            }

            const row = document.createElement('div');
            row.className = 'omnivoice-speaker-ref-row';

            const meta = document.createElement('div');
            meta.className = 'omnivoice-speaker-ref-meta';
            const title = document.createElement('div');
            title.className = 'omnivoice-speaker-ref-title';
            title.textContent = speakerId;
            const copy = document.createElement('div');
            copy.className = 'omnivoice-speaker-ref-copy';
            copy.textContent = `参考文本固定为：${speakerRefText}`;
            meta.appendChild(title);
            meta.appendChild(copy);

            const inputWrap = document.createElement('div');
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg';
            input.className = 'omnivoice-speaker-ref-input';
            input.dataset.speakerId = speakerId;
            const status = document.createElement('span');
            status.className = 'omnivoice-speaker-ref-status';
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

    /**
     * 刷新 speaker 参考音上传提示，明确告诉用户还缺谁。
     */
    function renderSpeakerRefHint() {
        if (!speakerRefHintEl) return;
        const speakerIds = getDetectedSpeakerIds();
        const cantoneseTarget = isCantoneseLanguage(targetLangSelect?.value || '');
        const cantoneseStyle = getCantoneseStyleLabel(targetLangSelect?.value || '');
        const cantoneseSuffix = cantoneseTarget
            ? ` 当前目标语为粤语（${cantoneseStyle}）；若未上传完整参考音，后端需存在 ref-voices/Cantonese 预置目录才能自动补齐缺失 speaker。`
            : '';
        const hasSubtitleRows = Array.isArray(getEffectiveSubtitleRows()) && getEffectiveSubtitleRows().length > 0;
        if (speakerIds.length === 0) {
            speakerRefHintEl.textContent = `当前项目字幕里还没有字幕，暂时无法建立 speaker 参考音映射。${cantoneseSuffix}`.trim();
            return;
        }
        if (speakerIds.length === 1 && speakerIds[0] === 'Speaker 1' && hasSubtitleRows) {
            const hasUpload = !!speakerRefFiles.get('Speaker 1');
            speakerRefHintEl.textContent = hasUpload
                ? `当前项目未检测到显式 speaker，现按单个 Speaker 1 处理，参考音已上传。${cantoneseSuffix}`.trim()
                : `当前项目未检测到显式 speaker，现按单个 Speaker 1 处理；请上传这位 speaker 的参考音。${cantoneseSuffix}`.trim();
            return;
        }
        const missing = speakerIds.filter((speakerId) => !speakerRefFiles.get(speakerId));
        if (missing.length === 0) {
            speakerRefHintEl.textContent = `已就绪：${speakerIds.length} 个 speaker 都已上传参考音。${cantoneseTarget ? ' 建议这些参考音本身就是粤语语音。' : ''}`.trim();
            return;
        }
        speakerRefHintEl.textContent = `还缺 ${missing.length} 个 speaker 参考音：${missing.join('、')}。${cantoneseSuffix}`.trim();
    }

    /**
     * 部分上传模式：允许只上传部分 speaker 参考音。
     * 返回“已上传文件”的 speaker_id 列表，和后端 files 数量保持一致。
     */
    function validateSpeakerReferenceUploads() {
        const speakerIds = getDetectedSpeakerIds();
        if (speakerIds.length === 0) {
            throw new Error('当前项目字幕里没有稳定 speaker 信息，OmniVoice strict 模式无法建立参考音映射。');
        }
        const uploadedSpeakerIds = speakerIds.filter((speakerId) => !!speakerRefFiles.get(speakerId));
        return uploadedSpeakerIds;
    }

    /**
     * 同步 Start 按钮状态，避免后端未 ready 时误点。
     */
    function syncStartButtonState() {
        if (!startBtn) return;
        startBtn.disabled = !omnivoiceBackendReady;
        if (prepareBtn) {
            prepareBtn.disabled = !omnivoiceBackendReady;
        }
        if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') {
            resumeBatchBtn.disabled = !omnivoiceBackendReady;
        }
    }

    /**
     * 根据 batch 当前恢复能力刷新“从断点继续”入口。
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
        resumeBatchBtn.disabled = !omnivoiceBackendReady;
        const completed = Number(data?.processed_segments ?? data?.completed_segments ?? 0);
        const total = Number(data?.total_segments ?? 0);
        if (resumeStage === 'prepared') {
            resumeBatchBtn.textContent = '跳过翻译继续配音';
        } else if (resumeStage === 'dubbing_partial') {
            resumeBatchBtn.textContent = total > 0
                ? `从第 ${Math.min(total, completed + 1)} 条继续配音`
                : '从断点继续配音';
        } else {
            resumeBatchBtn.textContent = '从断点继续配音';
        }
    }

    /**
     * 当用户在 Restore 下拉里切换批次时，预先刷新 resume 按钮和提示。
     */
    function syncResumeActionFromSelection() {
        if (!batchSelect) return;
        const selectedOption = batchSelect.options?.[batchSelect.selectedIndex] || null;
        if (!selectedOption || !batchSelect.value) {
            renderResumeAction(null);
            return;
        }
        const resumable = selectedOption.dataset.resumable === 'true';
        const processedSegments = Number(selectedOption.dataset.processedSegments || 0);
        const totalSegments = Number(selectedOption.dataset.totalSegments || 0);
        const resumeStage = String(selectedOption.dataset.resumeStage || '').trim();
        const payload = {
            batch_id: batchSelect.value,
            task_id: selectedOption.dataset.taskId || batchSelect.value,
            resumable,
            resume_stage: resumeStage,
            processed_segments: processedSegments,
            total_segments: totalSegments,
        };
        renderResumeAction(payload);
        if (!batchHintEl) return;
        if (resumable) {
            batchHintEl.textContent = totalSegments > 0
                ? `已选择 ${selectedOption.dataset.projectFilename || batchSelect.value}，可从断点继续（${processedSegments}/${totalSegments}）`
                : `已选择 ${selectedOption.dataset.projectFilename || batchSelect.value}，可继续恢复`;
            return;
        }
        if (resumeStage === 'completed') {
            batchHintEl.textContent = `已选择 ${selectedOption.dataset.projectFilename || batchSelect.value}，该批次已完成，可直接加载结果查看产物`;
            return;
        }
        batchHintEl.textContent = `已选择 ${selectedOption.dataset.projectFilename || batchSelect.value}，可先加载结果查看产物`;
    }

    /**
     * 轮询独立 OmniVoice 后端模型就绪状态。
     */
    async function refreshBackendStatus({ scheduleRetry = true } = {}) {
        try {
            const res = await fetch('/omnivoice/auto/backend-status');
            const data = res.ok ? await res.json() : { ok: false, detail: `HTTP ${res.status}` };
            omnivoiceBackendReady = !!data?.ready;
            if (backendNoteEl) {
                if (omnivoiceBackendReady) {
                    backendNoteEl.textContent = 'OmniVoice 后端已就绪，可以开始配音。';
                } else {
                    backendNoteEl.textContent = `OmniVoice 后端加载中：${data?.detail || data?.status || 'loading'}`;
                }
            }
            syncStartButtonState();
            if (omnivoiceBackendReady && backendPollTimer) {
                clearInterval(backendPollTimer);
                backendPollTimer = null;
            } else if (!omnivoiceBackendReady && scheduleRetry && !backendPollTimer) {
                backendPollTimer = setInterval(() => {
                    refreshBackendStatus({ scheduleRetry: false }).catch(() => {});
                }, 5000);
            }
            return data;
        } catch (error) {
            omnivoiceBackendReady = false;
            if (backendNoteEl) {
                backendNoteEl.textContent = `OmniVoice 后端状态检查失败：${error.message}`;
            }
            syncStartButtonState();
            if (scheduleRetry && !backendPollTimer) {
                backendPollTimer = setInterval(() => {
                    refreshBackendStatus({ scheduleRetry: false }).catch(() => {});
                }, 5000);
            }
            return { ok: false, ready: false, detail: error.message };
        }
    }

    /**
     * 当前项目可用字幕决定可选策略，和 4 号面板保持同样的“直白”表达。
     */
    function buildProjectSubtitleOptions(projectContext) {
        const sourceItems = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const translatedItems = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        const options = [];
        if (translatedItems.length > 0) {
            options.push({
                value: 'translated',
                label: `使用当前译文直接配音（${translatedItems.length} 行）`,
            });
        }
        if (sourceItems.length > 0) {
            options.push({
                value: 'source',
                label: `使用当前原字幕先翻译后配音（${sourceItems.length} 行）`,
            });
        }
        return options;
    }

    /**
     * 同步当前项目摘要与可用性文案。
     */
    function renderProjectContextSummary() {
        const projectContext = readProjectContext();
        const cantoneseSource = isCantoneseLanguage(sourceLangSelect?.value || '');
        const cantoneseTarget = isCantoneseLanguage(targetLangSelect?.value || '');
        const mainlandCantoneseTarget = isMainlandCantoneseLanguage(targetLangSelect?.value || '');
        const cantoneseStyle = getCantoneseStyleLabel(targetLangSelect?.value || '');
        if (preparedBatchId) {
            const preparedState = buildPreparedBatchState(projectContext, preparedBatchId);
            if (!isPreparedBatchStateCompatible(projectContext, preparedState)) {
                persistPreparedBatchState('');
            }
        }
        const mediaName = projectContext?.mediaOriginalFilename || projectContext?.mediaFilename || '';
        const sourceSubtitles = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const translatedSubtitles = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        const sourceCount = sourceSubtitles.length;
        const translatedCount = translatedSubtitles.length;
        const speakerCount = Math.max(countSpeakers(sourceSubtitles), countSpeakers(translatedSubtitles));

        if (projectMediaEl) {
            projectMediaEl.textContent = mediaName || '未上传媒体';
        }
        if (projectTaskEl) {
            projectTaskEl.textContent = projectContext?.taskId || '未生成';
        }
        if (projectSourceCountEl) {
            projectSourceCountEl.textContent = `${sourceCount} 行`;
        }
        if (projectTranslatedCountEl) {
            projectTranslatedCountEl.textContent = `${translatedCount} 行`;
        }
        if (projectReadinessEl) {
            projectReadinessEl.textContent = mediaName && (sourceCount > 0 || translatedCount > 0)
                ? `可复用 · ${speakerCount} speaker`
                : '缺少媒体或字幕';
        }
        if (projectNoteEl) {
            if (!mediaName) {
                projectNoteEl.textContent = '请先在 1.Upload Video + Optional SRT 中上传视频。OmniVoice 会直接复用当前项目上下文，不再单独上传。';
            } else if (sourceCount === 0 && translatedCount === 0) {
                projectNoteEl.textContent = '当前项目还没有可用字幕。OmniVoice 只能复用当前项目字幕上下文，请先在当前项目生成或导入字幕。';
            } else if (cantoneseTarget) {
                projectNoteEl.textContent = `当前目标语为粤语（${cantoneseStyle}）。5 号面板会把该输出稳定映射到 OmniVoice 的 yue 语言码；建议上传粤语参考音。若只上传部分 speaker，自动补位依赖后端 ref-voices/Cantonese 预置目录。`;
            } else {
                projectNoteEl.textContent = 'OmniVoice 会优先复用 translated 字幕，否则翻译 source 字幕；speaker 会从字幕自动识别，参考音需要你逐个上传并严格映射。';
            }
        }
        if (sharedKeyNoteEl) {
            const key = getTranslateApiKey ? getTranslateApiKey() : '';
            const baseUrl = getTranslateBaseUrl ? getTranslateBaseUrl() : '';
            const model = getTranslateModel ? getTranslateModel() : '';
            if (key) {
                sharedKeyNoteEl.textContent = `当前使用翻译 API 配置：${baseUrl || '默认 Base URL'} / ${model || '默认 Model'}。OmniVoice 只共享翻译配置，不共享 4 号面板的 backend 状态。${cantoneseTarget ? ` 目标语是粤语时，source 字幕翻译会优先生成${cantoneseStyle}。` : ''}`;
            } else {
                sharedKeyNoteEl.textContent = `如果当前项目需要翻译 source 字幕，将复用左侧 Translation API 配置或后端环境变量。${cantoneseTarget ? ` 目标语是粤语时，会优先生成${cantoneseStyle}。` : ''}`;
            }
        }
        if (projectReadinessEl && cantoneseSource && cantoneseTarget && mediaName && (sourceCount > 0 || translatedCount > 0)) {
            projectReadinessEl.textContent = `${projectReadinessEl.textContent} · ${mainlandCantoneseTarget ? '广东式粤语链路' : '港式粤语链路'}`;
        }
        if (subtitleModeSelect) {
            const previous = subtitleModeSelect.value;
            const options = buildProjectSubtitleOptions(projectContext);
            subtitleModeSelect.innerHTML = '';
            options.forEach((option) => {
                const node = document.createElement('option');
                node.value = option.value;
                node.textContent = option.label;
                subtitleModeSelect.appendChild(node);
            });
            const values = options.map((item) => item.value);
            if (values.includes(previous)) {
                subtitleModeSelect.value = previous;
            } else if (values.includes('translated')) {
                subtitleModeSelect.value = 'translated';
            } else if (values.includes('source')) {
                subtitleModeSelect.value = 'source';
            } else {
                subtitleModeSelect.value = '';
            }
        }
        renderSpeakerReferenceInputs();
    }

    /**
     * 读取 subtitle_mode 的本地浏览器记忆。
     */
    function restoreSubtitleMode() {
        if (!subtitleModeSelect) return;
        const saved = localStorage.getItem(SUBTITLE_MODE_KEY);
        if (saved && ['translated', 'source'].includes(saved)) {
            subtitleModeSelect.value = saved;
        }
        subtitleModeSelect.addEventListener('change', () => {
            localStorage.setItem(SUBTITLE_MODE_KEY, subtitleModeSelect.value);
        });
    }

    /**
     * 构造当前项目启动请求。
     */
    function buildCurrentProjectRequest() {
        const projectContext = readProjectContext();
        const mediaFilename = String(projectContext?.mediaFilename || '').trim();
        const sourceSubtitles = Array.isArray(projectContext?.sourceSubtitles) ? projectContext.sourceSubtitles : [];
        const translatedSubtitles = Array.isArray(projectContext?.translatedSubtitles) ? projectContext.translatedSubtitles : [];
        if (!mediaFilename) {
            throw new Error('OmniVoice 需要先上传视频，再从当前项目启动。');
        }
        if (sourceSubtitles.length === 0 && translatedSubtitles.length === 0) {
            throw new Error('OmniVoice 需要当前项目里已有字幕。');
        }

        const formData = new FormData();
        formData.append('filename', mediaFilename);
        formData.append('original_filename', projectContext?.mediaOriginalFilename || mediaFilename);
        formData.append('task_id', projectContext?.taskId || '');
        formData.append('source_subtitles_json', JSON.stringify(sourceSubtitles));
        formData.append('translated_subtitles_json', JSON.stringify(translatedSubtitles));
        formData.append('subtitle_mode', subtitleModeSelect?.value || 'source');
        formData.append('source_lang', sourceLangSelect?.value || 'auto');
        formData.append('target_lang', targetLangSelect?.value || 'Chinese');
        formData.append('enable_source_separation', enableSourceSeparationCheckbox?.checked ? 'true' : 'false');
        formData.append('api_key', getTranslateApiKey ? getTranslateApiKey() : '');
        formData.append('translate_base_url', getTranslateBaseUrl ? getTranslateBaseUrl() : '');
        formData.append('translate_model', getTranslateModel ? getTranslateModel() : '');
        // 兼容 4 号面板的旧习惯：优先用 5 号自己的 prompt，空时回退读 legacy 全局 prompt。
        // 只影响 source->translate，不会改变配音音色或 speaker 路由。
        const translateSystemPrompt = (() => {
            const panelPrompt = String(translateSystemPromptInput?.value || '').trim();
            if (panelPrompt) {
                return panelPrompt;
            }
            const legacyPromptInput = document.getElementById('system-prompt');
            return String(legacyPromptInput?.value || '').trim();
        })();
        if (translateSystemPrompt) {
            formData.append('translate_system_prompt', translateSystemPrompt);
        }
        if (preparedBatchId) {
            formData.append('prepared_batch_id', preparedBatchId);
        }
        const speakerIds = validateSpeakerReferenceUploads();
        formData.append('speaker_ref_speaker_ids_json', JSON.stringify(speakerIds));
        speakerIds.forEach((speakerId) => {
            const file = speakerRefFiles.get(speakerId);
            if (file) {
                formData.append('speaker_ref_files', file, file.name);
            }
        });

        return {
            endpoint: '/omnivoice/auto/start-from-project',
            formData,
        };
    }

    /**
     * 判断结果文件地址是否能直接被浏览器播放或抓取。
     */
    function isPlayableUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return false;
        return /^(https?:\/\/|file:\/\/|blob:|\/omnivoice\/auto\/artifact\/|\/dubbing\/artifact\/|\/artifact\/)/i.test(value);
    }

    /**
     * 给地址追加 cache bust，避免浏览器复用旧的结果字幕缓存。
     */
    function withCacheBust(url) {
        const base = audioTrackController?.withCacheBust?.(url) || String(url || '').trim();
        return base;
    }

    /**
     * 标记一次新的 OmniVoice 结果加载。
     * 任何更早开始的异步请求都会被视为过期，防止旧结果串回当前页面。
     */
    function beginOmnivoiceResultLoad() {
        omnivoiceResultLoadSeq += 1;
        return omnivoiceResultLoadSeq;
    }

    /**
     * 判断某个异步请求是否仍然属于当前这次结果加载。
     */
    function isLatestOmnivoiceResultLoad(loadSeq) {
        if (loadSeq === null || loadSeq === undefined) {
            return true;
        }
        return Number(loadSeq || 0) === omnivoiceResultLoadSeq;
    }

    /**
     * 从 OmniVoice 结果中优先挑出可播放的 SRT 产物地址。
     */
    function pickOmnivoiceSrtUrl(data) {
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        const preferred = artifacts.find((item) => item?.key === 'srt' && item?.url)
            || artifacts.find((item) => item?.key === 'translated_srt' && item?.url)
            || artifacts.find((item) => item?.key === 'source_srt' && item?.url);
        if (preferred?.url) {
            return preferred.url;
        }
        const resultSrt = String(data?.result_srt || '').trim();
        return isPlayableUrl(resultSrt) ? resultSrt : null;
    }

    /**
     * 从 OmniVoice 结果中优先挑出可播放的成片视频。
     * 5 号面板加载结果时，优先直接播烧录 ASS 的成片视频，其次再回退未烧录版本。
     */
    function pickOmnivoiceVideoUrl(data) {
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        const preferred = artifacts.find((item) => item?.key === 'video_burned' && item?.url)
            || artifacts.find((item) => item?.key === 'video' && item?.url)
            || artifacts.find((item) => item?.key === 'result_video' && item?.url);
        if (preferred?.url) {
            return preferred.url;
        }
        const resultVideo = String(data?.dubbed_video_burned || data?.result_video || data?.dubbed_video_full || '').trim();
        return isPlayableUrl(resultVideo) ? resultVideo : null;
    }

    /**
     * 将 SRT 文本解析成字幕条目，供顶部播放器 overlay 预览。
     */
    function parseSrtTimeToSeconds(timeText) {
        const match = String(timeText || '').trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
        if (!match) return null;
        const h = Number(match[1]);
        const m = Number(match[2]);
        const s = Number(match[3]);
        const ms = Number(match[4]);
        return h * 3600 + m * 60 + s + ms / 1000;
    }

    /**
     * 解析 SRT 为统一字幕项结构，保持和 4 号面板一致。
     */
    function parseSrtToSubtitleItems(srtText) {
        const normalized = String(srtText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        if (!normalized) return [];
        const blocks = normalized.split(/\n{2,}/);
        const items = [];
        for (const block of blocks) {
            const lines = block.split('\n').map((line) => line.trimEnd()).filter(Boolean);
            if (lines.length < 2) continue;
            const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
            if (timeLineIndex < 0) continue;
            const [startText, endText] = lines[timeLineIndex].split('-->').map((part) => part.trim());
            const start = parseSrtTimeToSeconds(startText);
            const end = parseSrtTimeToSeconds(endText);
            if (start === null || end === null) continue;
            const text = lines.slice(timeLineIndex + 1).join('\n').trim();
            if (!text) continue;
            items.push({ start, end, text });
        }
        return items;
    }

    /**
     * 拉取并加载 OmniVoice 结果字幕，只作为 5 号面板本地预览，不写回 2 号面板状态。
     */
    async function loadOmnivoiceSubtitlePreview(data, loadSeq) {
        if (!isLatestOmnivoiceResultLoad(loadSeq)) {
            return [];
        }
        const srtUrl = pickOmnivoiceSrtUrl(data);
        if (!srtUrl) {
            if (isLatestOmnivoiceResultLoad(loadSeq)) {
                clearOmnivoiceSubtitlePreview?.();
            }
            return [];
        }
        try {
            const response = await fetch(withCacheBust(srtUrl));
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const srtText = await response.text();
            if (!isLatestOmnivoiceResultLoad(loadSeq)) {
                return [];
            }
            const parsed = parseSrtToSubtitleItems(srtText);
            if (!parsed.length) {
                throw new Error('empty or invalid srt');
            }
            if (!isLatestOmnivoiceResultLoad(loadSeq)) {
                return [];
            }
            setOmnivoiceSubtitlePreview?.(parsed);
            // 兜底：本地 app.js 若未提供独立预览注入器，则回退写入全局 translated 字幕并切到翻译显示。
            if (typeof window.applyOmnivoicePreviewSubtitles === 'function') {
                window.applyOmnivoicePreviewSubtitles(parsed);
            }
            refreshSubtitleOverlay?.();
            return parsed;
        } catch (error) {
            if (!isLatestOmnivoiceResultLoad(loadSeq)) {
                return [];
            }
            console.warn('Load OmniVoice subtitle preview failed:', error);
            clearOmnivoiceSubtitlePreview?.();
            return [];
        }
    }

    /**
     * 只刷新结果区的下载链接和字幕预览，不重复切主播放器媒体。
     * 这个 helper 专门给恢复既有结果时使用，避免结果区依赖别的状态分支。
     */
    function renderOmnivoiceResultAssets(data, loadSeq) {
        if (!isLatestOmnivoiceResultLoad(loadSeq)) return;
        if (!resultsContainer || !downloadLinks) return;
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        downloadLinks.innerHTML = '';
        artifacts.forEach((artifact, index) => {
            if (!artifact?.url) return;
            const link = document.createElement('a');
            link.href = artifact.url;
            link.className = index === 0 ? 'primary-btn' : 'secondary-btn';
            link.textContent = artifact.label || artifact.key || 'Download';
            link.style.display = 'block';
            link.style.textAlign = 'center';
            downloadLinks.appendChild(link);
        });
        resultsContainer.style.display = 'block';
        loadOmnivoiceSubtitlePreview(data, loadSeq).catch(() => {});
    }

    /**
     * 统一渲染下载链接。
     */
    function renderResults(data, loadSeq) {
        if (!isLatestOmnivoiceResultLoad(loadSeq)) return;
        if (!resultsContainer || !downloadLinks) return;
        loadResultMediaToPlayer(data);
        renderOmnivoiceResultAssets(data, loadSeq);
    }

    /**
     * 恢复历史 batch 的播放媒体。
     * 结果文件存在时优先直接播放成片视频；如果缺失，则回退到源视频。
     */
    function loadResultMediaToPlayer(data) {
        audioTrackController?.resetAudioTrackState?.();
        const resultVideoUrl = pickOmnivoiceVideoUrl(data);
        const mediaUrl = resultVideoUrl || data?.input_media_url;
        if (!videoPlayer) return;
        if (!mediaUrl) {
            if (statusText) {
                statusText.textContent = 'Loaded · Completed（成片与源视频都已不存在，请重新上传视频进行预览）';
                statusText.className = 'status-text';
            }
            return;
        }
        const shouldResume = !videoPlayer.paused;
        videoPlayer.src = withCacheBust(mediaUrl);
        videoPlayer.style.display = 'block';
        videoPlayer.load();
        if (shouldResume) {
            videoPlayer.play().catch(() => {});
        }
        videoPlayer.controls = true;
        if (videoPlaceholder) {
            videoPlaceholder.style.display = 'none';
        }
    }

    /**
     * 更新状态区，兼容轮询和恢复任务。
     */
    function renderTaskState(data, loadSeq) {
        if (!statusContainer) return;
        statusContainer.style.display = 'block';
        if (progressFill && typeof data?.progress === 'number') {
            progressFill.style.width = `${Math.max(0, Math.min(100, data.progress))}%`;
        }
        if (taskLabel && (data?.short_id || data?.id)) {
            taskLabel.textContent = `Task · ${(data.short_id || data.id.split('_')[0]).toUpperCase()}`;
        }
        if (lineProgressEl) {
            const processed = data?.processed_segments ?? 0;
            const total = data?.total_segments ?? 0;
            lineProgressEl.textContent = typeof formatLineProgress === 'function'
                ? formatLineProgress(processed, total)
                : `Segments ${processed}/${total || 0}`;
        }
        if (etaEl) {
            const elapsedLabel = typeof buildAutoDubElapsedLabel === 'function'
                ? buildAutoDubElapsedLabel(data, autoDubStartedAtMs)
                : '';
            etaEl.textContent = elapsedLabel || (typeof formatEtaAsSegmentProgress === 'function'
                ? formatEtaAsSegmentProgress(data?.processed_segments ?? 0, data?.total_segments ?? 0)
                : 'ETA —');
        }
        if (statusText) {
            if (data?.status === 'failed') {
                statusText.textContent = `Failed: ${data?.error || 'Unknown error'}`;
                statusText.className = 'status-text error';
            } else {
                const stageLabel = typeof describeAutoStage === 'function'
                    ? describeAutoStage(data?.stage || data?.status || '')
                    : (data?.stage || 'running');
                statusText.textContent = stageLabel;
                statusText.className = `status-text ${data?.status === 'completed' ? 'success' : ''}`.trim();
            }
        }
        if (data?.status === 'completed') {
            renderResults(data, loadSeq);
        }
    }

    /**
     * 轮询 OmniVoice 任务状态。
     */
    function pollStatus(taskId) {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        pollTimer = setInterval(async () => {
            try {
                const res = await fetch(`/omnivoice/auto/status/${taskId}`);
                if (!res.ok) {
                    throw new Error('Status poll failed');
                }
                const data = await res.json();
                renderTaskState(data);
                if (data?.status === 'completed' || data?.status === 'failed') {
                    clearInterval(pollTimer);
                    pollTimer = null;
                    startBtn && (startBtn.disabled = false);
                    loadBatchBtn && (loadBatchBtn.disabled = false);
                    refreshBatchesBtn && (refreshBatchesBtn.disabled = false);
                }
            } catch (error) {
                clearInterval(pollTimer);
                pollTimer = null;
                if (statusText) {
                    statusText.textContent = `Polling Error: ${error.message}`;
                    statusText.className = 'status-text error';
                }
                startBtn && (startBtn.disabled = false);
                loadBatchBtn && (loadBatchBtn.disabled = false);
                refreshBatchesBtn && (refreshBatchesBtn.disabled = false);
            }
        }, 1200);
    }

    /**
     * 拉取可恢复任务列表。
     */
    async function refreshBatches() {
        if (!batchHintEl || !batchSelect) return;
        batchHintEl.textContent = '正在加载 OmniVoice 结果文件夹列表...';
        try {
            const res = await fetch('/omnivoice/auto/batches');
            if (!res.ok) {
                throw new Error('Failed to load batches');
            }
            const data = await res.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            batchSelect.innerHTML = '<option value="">选择已生成结果文件夹</option>';
            items.forEach((item) => {
                const option = document.createElement('option');
                option.value = item.batch_id || item.task_id || '';
                const resumeMark = item.resumable ? ` · 可断点继续${item.resume_stage ? `(${item.resume_stage})` : ''}` : '';
                option.dataset.taskId = item.task_id || item.batch_id || '';
                option.dataset.projectFilename = item.project_filename || '';
                option.dataset.resumable = item.resumable ? 'true' : 'false';
                option.dataset.resumeStage = item.resume_stage || '';
                option.dataset.processedSegments = String(item.processed_segments ?? 0);
                option.dataset.totalSegments = String(item.total_segments ?? 0);
                option.textContent = `${item.batch_id || item.task_id || 'batch'} · ${item.project_filename || 'unknown'} · ${item.status || 'unknown'}${resumeMark}`;
                batchSelect.appendChild(option);
            });
            batchHintEl.textContent = items.length > 0
                ? `已找到 ${items.length} 个 OmniVoice 结果文件夹`
                : '当前没有可加载的 OmniVoice 结果文件夹';
            syncResumeActionFromSelection();
        } catch (error) {
            batchHintEl.textContent = `加载失败：${error.message}`;
            renderResumeAction(null);
        }
    }

    /**
     * 从磁盘恢复一个已有结果。
     */
    async function loadBatch() {
        if (!batchSelect || !batchSelect.value) {
            if (batchHintEl) {
                batchHintEl.textContent = '请先选择一个 OmniVoice 结果文件夹';
            }
            renderResumeAction(null);
            return;
        }
        const batchId = batchSelect.value;
        const loadSeq = beginOmnivoiceResultLoad();
        if (loadBatchBtn) loadBatchBtn.disabled = true;
        if (refreshBatchesBtn) refreshBatchesBtn.disabled = true;
        audioTrackController?.resetAudioTrackState?.();
        clearOmnivoiceSubtitlePreview?.();
        try {
            const formData = new FormData();
            formData.append('batch_id', batchId);
            const res = await fetch('/omnivoice/auto/load-batch', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || 'Failed to load OmniVoice batch');
            }
            if (!isLatestOmnivoiceResultLoad(loadSeq)) {
                return;
            }
            if (batchSelect) {
                batchSelect.value = batchId;
            }
            syncLanguageSelectorsFromTask(data);
            loadedBatchTaskId = String(data?.id || data?.task_id || data?.batch_id || batchId || '').trim();
            renderResumeAction(data);
            loadResultMediaToPlayer(data);
            renderTaskState(data, loadSeq);
            renderOmnivoiceResultAssets(data, loadSeq);
            if (batchHintEl) {
                if (data?.resumable) {
                    const completed = Number(data?.processed_segments ?? 0);
                    const total = Number(data?.total_segments ?? 0);
                    batchHintEl.textContent = total > 0
                        ? `已加载 ${data.project_filename || batchId}，可从断点继续（${completed}/${total}）`
                        : `已加载 ${data.project_filename || batchId}，可继续恢复`;
                } else {
                    batchHintEl.textContent = `已加载 ${data.project_filename || batchId}`;
                }
            }
        } catch (error) {
            if (!isLatestOmnivoiceResultLoad(loadSeq)) {
                return;
            }
            if (batchHintEl) {
                batchHintEl.textContent = `加载失败：${error.message}`;
            }
            renderResumeAction(null);
        } finally {
            if (isLatestOmnivoiceResultLoad(loadSeq)) {
                if (loadBatchBtn) loadBatchBtn.disabled = false;
                if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
            }
        }
    }

    /**
     * 开始独立 OmniVoice 任务。
     */
    async function startTask({ allowPreparedFallback = true } = {}) {
        try {
            beginOmnivoiceResultLoad();
            const backendStatus = await refreshBackendStatus({ scheduleRetry: false });
            if (!backendStatus?.ready) {
                throw new Error(backendStatus?.detail || 'OmniVoice backend is still loading');
            }
            const request = buildCurrentProjectRequest();
            if (startBtn) startBtn.disabled = true;
            if (loadBatchBtn) loadBatchBtn.disabled = true;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = true;
            if (resumeBatchBtn) resumeBatchBtn.disabled = true;
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (statusContainer) statusContainer.style.display = 'block';
            if (statusText) {
                statusText.textContent = 'Initializing...';
                statusText.className = 'status-text';
            }
            if (progressFill) {
                progressFill.style.width = '8%';
            }
            audioTrackController?.resetAudioTrackState?.();
            clearOmnivoiceSubtitlePreview?.();
            autoDubStartedAtMs = Date.now();
            const res = await fetch(request.endpoint, {
                method: 'POST',
                body: request.formData,
            });
            const data = await res.json();
            if (!res.ok) {
                const detail = String(data?.detail || '');
                const preparedInvalid = /Prepared batch not found|Prepared selected_subtitles\.srt/i.test(detail);
                if (allowPreparedFallback && preparedBatchId && preparedInvalid) {
                    persistPreparedBatchState('');
                    return startTask({ allowPreparedFallback: false });
                }
                throw new Error(data.detail || 'Failed to start OmniVoice task');
            }
            renderTaskState(data);
            renderResumeAction(null);
            pollStatus(data.task_id);
        } catch (error) {
            if (statusText) {
                statusText.textContent = `Failed: ${error.message}`;
                statusText.className = 'status-text error';
            }
            if (startBtn) startBtn.disabled = false;
            if (loadBatchBtn) loadBatchBtn.disabled = false;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
            if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') resumeBatchBtn.disabled = false;
        }
    }

    /**
     * 从已加载 batch 的断点继续 OmniVoice 任务。
     */
    async function resumeLoadedBatch() {
        if (!loadedBatchTaskId) {
            if (batchHintEl) {
                batchHintEl.textContent = '请先加载一个可恢复的 OmniVoice 结果文件夹';
            }
            return;
        }
        try {
            beginOmnivoiceResultLoad();
            const backendStatus = await refreshBackendStatus({ scheduleRetry: false });
            if (!backendStatus?.ready) {
                throw new Error(backendStatus?.detail || 'OmniVoice backend is still loading');
            }
            if (startBtn) startBtn.disabled = true;
            if (prepareBtn) prepareBtn.disabled = true;
            if (loadBatchBtn) loadBatchBtn.disabled = true;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = true;
            if (resumeBatchBtn) resumeBatchBtn.disabled = true;
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (statusContainer) statusContainer.style.display = 'block';
            if (statusText) {
                statusText.textContent = 'Resuming from checkpoint...';
                statusText.className = 'status-text';
            }
            if (progressFill) {
                progressFill.style.width = '10%';
            }
            autoDubStartedAtMs = Date.now();
            const res = await fetch(`/omnivoice/auto/resume/${encodeURIComponent(loadedBatchTaskId)}`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || 'Failed to resume OmniVoice task');
            }
            renderTaskState(data);
            renderResumeAction(null);
            pollStatus(data.task_id);
        } catch (error) {
            if (statusText) {
                statusText.textContent = `Resume failed: ${error.message}`;
                statusText.className = 'status-text error';
            }
            syncStartButtonState();
            if (loadBatchBtn) loadBatchBtn.disabled = false;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
            if (resumeBatchBtn && resumeBatchBtn.style.display !== 'none') resumeBatchBtn.disabled = false;
        }
    }

    /**
     * 仅生成 selected_subtitles.srt，供人工 review 后再手动开始配音。
     */
    async function prepareSelectedSubtitles() {
        try {
            beginOmnivoiceResultLoad();
            const backendStatus = await refreshBackendStatus({ scheduleRetry: false });
            if (!backendStatus?.ready) {
                throw new Error(backendStatus?.detail || 'OmniVoice backend is still loading');
            }
            const request = buildCurrentProjectRequest();
            request.formData.delete('prepared_batch_id');
            if (prepareBtn) prepareBtn.disabled = true;
            if (startBtn) startBtn.disabled = true;
            if (loadBatchBtn) loadBatchBtn.disabled = true;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = true;
            if (resultsContainer) resultsContainer.style.display = 'none';
            if (statusContainer) statusContainer.style.display = 'block';
            if (statusText) {
                statusText.textContent = 'Preparing selected_subtitles.srt ...';
                statusText.className = 'status-text';
            }
            if (progressFill) {
                progressFill.style.width = '20%';
            }
            autoDubStartedAtMs = Date.now();
            const res = await fetch('/omnivoice/auto/prepare-subtitles-from-project', {
                method: 'POST',
                body: request.formData,
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || 'Failed to prepare selected subtitles');
            }
            persistPreparedBatchState(String(data?.batch_id || data?.task_id || '').trim());
            const loadSeq = beginOmnivoiceResultLoad();
            renderTaskState(data, loadSeq);
            renderOmnivoiceResultAssets(data, loadSeq);
            if (statusText) {
                statusText.textContent = 'selected_subtitles.srt 已生成，可先 review 后再点击开始配音';
                statusText.className = 'status-text success';
            }
        } catch (error) {
            if (statusText) {
                statusText.textContent = `Prepare failed: ${error.message}`;
                statusText.className = 'status-text error';
            }
        } finally {
            syncStartButtonState();
            if (loadBatchBtn) loadBatchBtn.disabled = false;
            if (refreshBatchesBtn) refreshBatchesBtn.disabled = false;
        }
    }

    /**
     * 监听项目变化，保持摘要和提示始终同步。
     */
    function syncProjectUi() {
        renderProjectContextSummary();
    }

    /**
     * 从已加载任务回填语言选择器，确保 restore/resume 后保留原展示值。
     */
    function syncLanguageSelectorsFromTask(data) {
        if (sourceLangSelect && data?.source_lang) {
            sourceLangSelect.value = String(data.source_lang);
        }
        if (targetLangSelect && data?.target_lang) {
            targetLangSelect.value = String(data.target_lang);
            syncSpeakerRefCopy();
        }
    }

    if (subtitleModeSelect) {
        restoreSubtitleMode();
        subtitleModeSelect.addEventListener('change', () => {
            renderSpeakerReferenceInputs();
        });
    }
    if (sourceLangSelect) {
        sourceLangSelect.addEventListener('change', syncProjectUi);
    }
    if (targetLangSelect) {
        targetLangSelect.addEventListener('change', () => {
            syncSpeakerRefCopy();
            syncProjectUi();
        });
    }
    if (startBtn) {
        startBtn.addEventListener('click', startTask);
    }
    if (prepareBtn) {
        prepareBtn.addEventListener('click', prepareSelectedSubtitles);
    }
    if (refreshBatchesBtn) {
        refreshBatchesBtn.addEventListener('click', refreshBatches);
    }
    if (loadBatchBtn) {
        loadBatchBtn.addEventListener('click', loadBatch);
    }
    if (batchSelect) {
        batchSelect.addEventListener('change', syncResumeActionFromSelection);
    }
    if (resumeBatchBtn) {
        resumeBatchBtn.addEventListener('click', resumeLoadedBatch);
    }
    window.addEventListener('subtitle-maker:project-context-changed', syncProjectUi);
    window.addEventListener('subtitle-maker:translate-config-changed', syncProjectUi);
    restorePreparedBatchState();
    syncProjectUi();
    refreshBackendStatus().catch(() => {});
    refreshBatches();
}
