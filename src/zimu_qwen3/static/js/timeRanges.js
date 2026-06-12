/**
 * 创建可复用的时间区间控制器，供 Auto Dubbing 与 Get Speaker Voice 共用。
 */
export function createTimeRangesController(options) {
    const {
        listEl,
        errorEl,
        startHEl,
        startMEl,
        startSEl,
        endHEl,
        endMEl,
        endSEl,
        addBtn,
        useCurrentBtn,
        clearBtn,
        videoPlayer,
        secondsToDisplay,
        timeToSeconds,
    } = options || {};

    let ranges = [];

    /**
     * 校验时间区间，避免非法或重叠输入。
     */
    function validateRange(startSec, endSec, durationSec) {
        if (startSec < 0) {
            return { valid: false, error: '起始时间不能小于 0' };
        }
        if (durationSec > 0 && endSec > durationSec) {
            return { valid: false, error: `结束时间不能超过视频时长 ${secondsToDisplay(durationSec)}` };
        }
        if (endSec <= startSec) {
            return { valid: false, error: '结束时间必须大于起始时间' };
        }
        for (const range of ranges) {
            if (!(endSec <= range.start || startSec >= range.end)) {
                return { valid: false, error: '该区间与已有区间重叠' };
            }
        }
        return { valid: true, error: '' };
    }

    /**
     * 渲染当前区间列表。
     */
    function render() {
        if (!listEl) return;
        listEl.innerHTML = '';
        ranges.forEach((range, index) => {
            const tag = document.createElement('div');
            tag.className = 'time-range-tag';
            tag.innerHTML = `
                <span class="range-times">${secondsToDisplay(range.start)} - ${secondsToDisplay(range.end)}</span>
                <button class="delete-range" data-index="${index}" title="删除">&times;</button>
            `;
            listEl.appendChild(tag);
        });
        listEl.querySelectorAll('.delete-range').forEach((btn) => {
            btn.addEventListener('click', (event) => {
                const idx = parseInt(event.target.dataset.index, 10);
                ranges.splice(idx, 1);
                render();
            });
        });
    }

    /**
     * 清空时间输入框。
     */
    function clearInputs() {
        if (startHEl) startHEl.value = '';
        if (startMEl) startMEl.value = '';
        if (startSEl) startSEl.value = '';
        if (endHEl) endHEl.value = '';
        if (endMEl) endMEl.value = '';
        if (endSEl) endSEl.value = '';
    }

    /**
     * 使用当前播放器位置填充起始时间。
     */
    function setStartFromCurrent() {
        if (!videoPlayer || Number.isNaN(videoPlayer.currentTime)) return;
        const current = videoPlayer.currentTime;
        const hh = Math.floor(current / 3600);
        const mm = Math.floor((current % 3600) / 60);
        const ss = Math.floor(current % 60);
        if (startHEl) startHEl.value = hh.toString().padStart(2, '0');
        if (startMEl) startMEl.value = mm.toString().padStart(2, '0');
        if (startSEl) startSEl.value = ss.toString().padStart(2, '0');
    }

    /**
     * 添加新区间，并按开始时间排序。
     */
    function addRange() {
        const startH = startHEl?.value || '';
        const startM = startMEl?.value || '';
        const startS = startSEl?.value || '';
        const endH = endHEl?.value || '';
        const endM = endMEl?.value || '';
        const endS = endSEl?.value || '';
        if (!startH && !startM && !startS) {
            if (errorEl) {
                errorEl.textContent = '请填写起始时间';
                errorEl.style.display = 'block';
            }
            return false;
        }
        if (!endH && !endM && !endS) {
            if (errorEl) {
                errorEl.textContent = '请填写结束时间';
                errorEl.style.display = 'block';
            }
            return false;
        }
        const startSec = timeToSeconds(startH, startM, startS);
        const endSec = timeToSeconds(endH, endM, endS);
        const durationSec = (videoPlayer && !Number.isNaN(videoPlayer.duration)) ? videoPlayer.duration : 0;
        const validation = validateRange(startSec, endSec, durationSec);
        if (!validation.valid) {
            if (errorEl) {
                errorEl.textContent = validation.error;
                errorEl.style.display = 'block';
            }
            return false;
        }
        ranges.push({ start: startSec, end: endSec });
        ranges.sort((a, b) => a.start - b.start);
        if (errorEl) errorEl.style.display = 'none';
        render();
        return true;
    }

    /**
     * 清空全部区间。
     */
    function clearAll() {
        ranges = [];
        render();
        if (errorEl) errorEl.style.display = 'none';
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (addRange()) {
                clearInputs();
            }
        });
    }
    if (useCurrentBtn) {
        useCurrentBtn.addEventListener('click', () => {
            setStartFromCurrent();
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearAll();
        });
    }

    return {
        getRanges() {
            return [...ranges];
        },
        setRanges(nextRanges) {
            ranges = Array.isArray(nextRanges) ? [...nextRanges] : [];
            render();
        },
        clearAll,
        render,
    };
}
