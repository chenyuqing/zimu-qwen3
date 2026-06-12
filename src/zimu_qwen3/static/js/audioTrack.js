/**
 * 创建可复用的结果音轨控制器，供 4/5 面板共用。
 * 这里只管播放器接线，不参与配音生成或任务状态。
 */
export function createAudioTrackController(options) {
    const {
        videoPlayer,
        audioTrackSwitcher,
        audioTrackModeSelect,
    } = options || {};

    const dubbedAudioPlayer = new Audio();
    dubbedAudioPlayer.preload = 'metadata';

    let dubbedAudioUrl = null;
    let listenersBound = false;

    /**
     * 给音频 URL 增加 cache bust，避免浏览器复用旧结果。
     */
    function withCacheBust(url) {
        const raw = String(url || '').trim();
        if (!raw) return raw;
        const sep = raw.includes('?') ? '&' : '?';
        return `${raw}${sep}v=${Date.now()}`;
    }

    /**
     * 判断字符串是不是浏览器可以直接播放的 URL。
     * 本地文件绝对路径不能直接塞给 audio.src，因此要排除。
     */
    function isPlayableUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return false;
        return /^(https?:\/\/|file:\/\/|blob:|\/omnivoice\/auto\/artifact\/|\/dubbing\/artifact\/|\/artifact\/)/i.test(value);
    }

    /**
     * 从后端结果里整理出 artifact 的 URL 映射。
     * 5 号面板的 `result_audio` 现在会回传本地路径，所以需要依赖 artifacts。
     */
    function buildArtifactUrlMap(data) {
        const map = new Map();
        (Array.isArray(data?.artifacts) ? data.artifacts : []).forEach((artifact) => {
            const key = String(artifact?.key || '').trim();
            const url = String(artifact?.url || '').trim();
            if (key && url) {
                map.set(key, url);
            }
        });
        return map;
    }

    /**
     * 从后端结果里挑出可播放的配音音轨。
     * 优先使用已是 URL 的 result_audio；如果是本地路径，就按面板默认模式回落到 artifacts。
     */
    function pickDubbedAudioUrl(data, { defaultMode = 'original' } = {}) {
        const resultAudio = String(data?.result_audio || '').trim();
        if (isPlayableUrl(resultAudio)) {
            return resultAudio;
        }

        const artifactMap = buildArtifactUrlMap(data);
        const preferredKeys = defaultMode === 'dubbed'
            ? ['video_audio', 'preferred_audio', 'mix', 'vocals']
            : ['preferred_audio', 'mix', 'video_audio', 'vocals'];

        for (const key of preferredKeys) {
            const url = String(artifactMap.get(key) || '').trim();
            if (url) {
                return url;
            }
        }

        return null;
    }

    /**
     * 判断当前是否真的处在 dubbed 模式。
     */
    function isDubbedModeActive() {
        return String(audioTrackModeSelect?.value || '').trim() === 'dubbed' && !!dubbedAudioUrl;
    }

    /**
     * 同步 dub 音轨和主视频的时间点、倍速与播放状态。
     */
    function syncDubbedAudioToVideo({ shouldPlay = false } = {}) {
        if (!videoPlayer || !dubbedAudioUrl) return;
        dubbedAudioPlayer.playbackRate = videoPlayer.playbackRate || 1;
        try {
            dubbedAudioPlayer.currentTime = videoPlayer.currentTime || 0;
        } catch (error) {
            console.debug('sync dubbed audio time failed', error);
        }
        if (shouldPlay) {
            dubbedAudioPlayer.play().catch(() => {});
        }
    }

    /**
     * 应用播放器音轨模式：original=原视频，dubbed=结果配音。
     */
    function applyAudioTrackMode(mode) {
        if (!videoPlayer) return;
        const targetMode = mode === 'dubbed' ? 'dubbed' : 'original';
        if (targetMode === 'dubbed' && !dubbedAudioUrl) {
            return;
        }

        if (targetMode === 'original') {
            videoPlayer.muted = false;
            dubbedAudioPlayer.pause();
            return;
        }

        videoPlayer.muted = true;
        syncDubbedAudioToVideo({ shouldPlay: !videoPlayer.paused });
    }

    /**
     * 重置音轨状态，避免旧任务结果残留到新任务或新媒体上。
     */
    function resetAudioTrackState() {
        dubbedAudioUrl = null;
        dubbedAudioPlayer.pause();
        dubbedAudioPlayer.removeAttribute('src');
        dubbedAudioPlayer.load();
        if (audioTrackModeSelect) {
            audioTrackModeSelect.value = 'original';
        }
        if (audioTrackSwitcher) {
            audioTrackSwitcher.style.display = 'none';
        }
        if (videoPlayer) {
            videoPlayer.muted = false;
        }
    }

    /**
     * 挂载一条结果音轨，并按默认模式切换播放器。
     * 4 号默认 original，5 号默认 dubbed。
     */
    function mountResultAudio(data, { defaultMode = 'original' } = {}) {
        const nextUrl = pickDubbedAudioUrl(data, { defaultMode });
        if (!nextUrl) {
            resetAudioTrackState();
            return null;
        }

        dubbedAudioUrl = withCacheBust(nextUrl);
        dubbedAudioPlayer.src = dubbedAudioUrl;
        dubbedAudioPlayer.load();
        if (audioTrackSwitcher) {
            audioTrackSwitcher.style.display = 'inline-flex';
        }

        const targetMode = defaultMode === 'dubbed' ? 'dubbed' : 'original';
        if (audioTrackModeSelect) {
            audioTrackModeSelect.value = targetMode;
        }
        applyAudioTrackMode(targetMode);
        return dubbedAudioUrl;
    }

    /**
     * 绑定主播放器事件，让 dub 音轨能跟随播放、暂停、拖动和倍速。
     */
    function bindPlayerEvents() {
        if (listenersBound || !videoPlayer) return;
        listenersBound = true;

        videoPlayer.addEventListener('play', () => {
            if (isDubbedModeActive()) {
                dubbedAudioPlayer.play().catch(() => {});
            }
        });
        videoPlayer.addEventListener('pause', () => {
            dubbedAudioPlayer.pause();
        });
        videoPlayer.addEventListener('seeking', () => {
            if (isDubbedModeActive()) {
                try {
                    dubbedAudioPlayer.currentTime = videoPlayer.currentTime || 0;
                } catch (error) {
                    console.debug('seek sync failed', error);
                }
            }
        });
        videoPlayer.addEventListener('ratechange', () => {
            dubbedAudioPlayer.playbackRate = videoPlayer.playbackRate || 1;
        });
        videoPlayer.addEventListener('ended', () => {
            dubbedAudioPlayer.pause();
            try {
                dubbedAudioPlayer.currentTime = 0;
            } catch (error) {
                console.debug('reset dubbed audio failed', error);
            }
        });

        if (audioTrackModeSelect) {
            audioTrackModeSelect.addEventListener('change', () => {
                applyAudioTrackMode(audioTrackModeSelect.value);
            });
        }
    }

    bindPlayerEvents();

    return {
        mountResultAudio,
        resetAudioTrackState,
        applyAudioTrackMode,
        pickDubbedAudioUrl,
        withCacheBust,
    };
}
