// main.js - نسخه نهایی (سایدبار آیکون‌محور + ثبت‌کننده ضدخطا)

let _saveSettingsTimer = null;
function scheduleSaveSettings() {
    if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
        if (typeof saveGlobalSettingsToServer === 'function') saveGlobalSettingsToServer();
    }, 400);
}

function safeOn(el, event, handler, name, options) {
    if (!el) { console.warn(`⚠️ [عیب‌یابی] عنصر «${name}» یافت نشد.`); return; }
    if (typeof handler !== 'function') { console.warn(`⚠️ [عیب‌یابی] تابع «${name}» تعریف نشده است.`); return; }
    el.addEventListener(event, handler, options);
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    isConfigLoading = true; window.__configLoadingSince = Date.now();
    try {
        await loadSettings();
        if (typeof loadSavedFontsFromServer === 'function') await loadSavedFontsFromServer();
        const savedProjectId = localStorage.getItem('currentProjectId');
        if (savedProjectId && typeof loadProjectFromServer === 'function') await loadProjectFromServer(savedProjectId);
        if (typeof setupFontListeners === 'function') setupFontListeners();
    } catch (err) {
        console.error("خطای همگام‌سازی بوت اولیه:", err);
    } finally {
        isConfigLoading = false; window.__configLoadingSince = 0;
        console.log("سیستم ذخیره‌سازی خودکار همگام است.");
    }
});

// 🔴 چرخ‌دنده اکنون به تب تنظیمات می‌رود (پنل شناور حذف شد)
safeOn(settingsToggleBtn, 'click', (e) => {
    e.stopPropagation();
    const settingsTab = document.querySelector('.sidebar-tabs .tab-btn[data-tab="settings"]');
    if (settingsTab) settingsTab.click();
}, 'settings-toggle-btn');

initStrokeSettings();

// ── لیسنرهای اصلی ──
safeOn(saveApiUrlBtn, 'click', saveApiUrl, 'save-api-key-btn');
safeOn(projectNameInput, 'input', () => localStorage.setItem('projectName', projectNameInput.value), 'project-name-input');
safeOn(batchSizeInput, 'change', updateBatchSize, 'batch-size-input');
safeOn(genreSelect, 'change', () => localStorage.setItem('mangaGenre', genreSelect.value), 'genre-select');

const themeSelect = document.getElementById('theme-select');
safeOn(themeSelect, 'change', () => {
    setTheme(themeSelect.value);
    if (typeof saveGlobalSettingsToServer === 'function') saveGlobalSettingsToServer();
}, 'theme-select');

safeOn(imageContainerWrapper, 'dragover', (e) => e.preventDefault(), 'wrapper-dragover');
safeOn(imageContainerWrapper, 'drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
        const files = (typeof collectDroppedFiles === 'function')
            ? await collectDroppedFiles(e.dataTransfer)
            : Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) {
            await handleUploadFlow(files);
        } else if (typeof showError === 'function') {
            showError('فایلی از دراپ خوانده نشد. از دکمه «پوشه فصل» یا «ZIP فصل» استفاده کنید.');
        }
    } catch (err) {
        console.error(err);
        if (typeof showError === 'function') {
            if (err && err.code === 'FOLDER_EMPTY') {
                showError('مرورگر پوشه را در دراپ پشتیبانی نکرد. از دکمه «پوشه فصل» استفاده کنید.');
            } else {
                showError('خطا در دراپ: ' + (err.message || err));
            }
        }
    }
}, 'wrapper-drop');

toolBtns.forEach(btn => safeOn(btn, 'click', selectTool, 'tool-btn'));
safeOn(imageContainerWrapper, 'mousedown', startAction, 'wrapper-mousedown');
safeOn(document, 'mousemove', duringAction, 'doc-mousemove');
safeOn(document, 'mouseup', endAction, 'doc-mouseup');
safeOn(imageContainer, 'dblclick', endPolygon, 'container-dblclick');
safeOn(imageContainerWrapper, 'contextmenu', e => e.preventDefault(), 'wrapper-contextmenu');

safeOn(clearAllMarkingsBtn, 'click', clearAllMarkings, 'clear-all-markings');
safeOn(clearAllOutputsBtn, 'click', clearAllOutputs, 'clear-all-outputs');
safeOn(clearAllTextBtn, 'click', clearAllExtractedText, 'clear-all-text');
safeOn(zoomInBtn, 'click', () => applyZoom(0.2), 'zoom-in');
safeOn(zoomOutBtn, 'click', () => applyZoom(-0.2), 'zoom-out');
safeOn(imageContainerWrapper, 'wheel', handleZoomScroll, 'wrapper-wheel', { passive: false });
safeOn(sendBatchBtn, 'click', processNextMarkingBatch, 'send-batch');
safeOn(confirmNextBtn, 'click', confirmBatchAndProceed, 'confirm-next');
safeOn(retryEmptyBtn, 'click', () => retryMarkings(currentBatchMarkings.filter(m => !m.originalText && !m.translatedText)), 'retry-empty');
safeOn(retryDeletedBtn, 'click', () => retryMarkings(markings.filter(m => m.needsRetry)), 'retry-deleted');

safeOn(exportTxtBtn, 'click', exportToTxt, 'export-txt');
safeOn(exportHtmlBtn, 'click', exportToHtml, 'export-html');
safeOn(exportZipBtn, 'click', exportToZip, 'export-zip');
safeOn(closeErrorBtn, 'click', () => errorContainer.classList.add('hidden'), 'close-error');

safeOn(saveProjectBtn, 'click', saveProject, 'save-project');
safeOn(loadJsonBtn, 'click', () => loadJsonInput.click(), 'load-json');
safeOn(loadJsonInput, 'change', loadJsonProject, 'load-json-input');

safeOn(openImportModalBtn, 'click', () => { importModal.classList.remove('hidden'); importTextarea.value = ''; importTextarea.focus(); }, 'open-import');
safeOn(closeImportBtn, 'click', () => importModal.classList.add('hidden'), 'close-import');
safeOn(processImportBtn, 'click', parseAndApplyTranslation, 'process-import');

const percentInput = document.getElementById('export-resize-percent');
safeOn(percentInput, 'change', () => {
    let val = parseInt(percentInput.value, 10);
    if (isNaN(val) || val < 1) val = 100;
    if (val > 200) val = 200;
    percentInput.value = val;
    localStorage.setItem('exportResizePercent', val);
}, 'export-resize-percent');

safeOn(toggleOriginalBtn, 'click', toggleOriginalText, 'toggle-original');

function toggleOriginalText() {
    showOriginal = !showOriginal;
    toggleOriginalBtn.title = showOriginal ? 'نمایش متن اصلی (Tab)' : 'نمایش ترجمه (Tab)';
    updateOutputList();
    redrawAllMarkings();
}

document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isSpacePressed = false;
        const currentToolBtn = document.querySelector(`.tool-btn.active`);
        imageContainerWrapper.style.cursor = (currentToolBtn && currentToolBtn.dataset.tool === 'edit') ? 'default' : 'crosshair';
        if (isPanning) { isPanning = false; imageContainer.classList.remove('panning'); }
    }
});

function clearAllMarkings() {
    if (!confirm("آیا از حذف تمام علامت‌گذاری‌ها مطمئن هستید؟")) return;
    pushToHistory();
    clearAllMarkingsConfirmless();
    images.forEach(img => img.context.clearRect(0, 0, img.canvas.width, img.canvas.height));
}

function updateMarkingNumbers() {
    markings.sort((a, b) => a.id - b.id);
    markings.forEach((mark, index) => { mark.displayId = index + 1; });
    updateOutputList();
}

const toleranceInput = document.getElementById('magic-tolerance');
const blurInput = document.getElementById('magic-blur');
const edgeInput = document.getElementById('magic-edge');
const toleranceSpan = document.getElementById('tolerance-value');
const blurSpan = document.getElementById('blur-value');
const edgeSpan = document.getElementById('edge-value');
safeOn(toleranceInput, 'input', (e) => { magicWandTolerance = parseInt(e.target.value, 10); if (toleranceSpan) toleranceSpan.textContent = magicWandTolerance; scheduleSaveSettings(); }, 'magic-tolerance');

const globalTextSizeInput = document.getElementById('global-text-size');
const globalTextSizeSpan = document.getElementById('global-text-size-value');
safeOn(globalTextSizeInput, 'input', (e) => {
    globalTextSizeAdjust = Math.max(-4, Math.min(4, parseInt(e.target.value, 10) || 0));
    if (globalTextSizeSpan) globalTextSizeSpan.textContent = globalTextSizeAdjust;
    if (typeof markings !== 'undefined' && markings) {
        markings.forEach(m => { if (typeof createOrUpdateTextOverlay === 'function') createOrUpdateTextOverlay(m); });
    }
    scheduleSaveSettings();
}, 'global-text-size');

const magicHoldInput = document.getElementById('magic-hold-ms');
const magicHoldSpan = document.getElementById('magic-hold-ms-value');
safeOn(magicHoldInput, 'input', (e) => {
    magicWandHoldMs = Math.max(100, Math.min(1000, parseInt(e.target.value, 10) || 500));
    if (magicHoldSpan) magicHoldSpan.textContent = magicWandHoldMs;
    scheduleSaveSettings();
}, 'magic-hold-ms');

const liveSaveIds = [
    'api-key-input', 'temperature-input', 'batch-size-input', 'auto-advance-time-input',
    'default-stroke-scale', 'stroke-step', 'export-width-input', 'export-quality-input',
    'export-resize-percent', 'export-format-select', 'export-path-input', 'theme-select'
];
liveSaveIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => scheduleSaveSettings());
    el.addEventListener('change', () => {
        if (id === 'theme-select' && typeof setTheme === 'function') setTheme(el.value);
        scheduleSaveSettings();
    });
});

safeOn(blurInput, 'input', (e) => { magicWandBlur = parseFloat(e.target.value); if (blurSpan) blurSpan.textContent = magicWandBlur.toFixed(1); scheduleSaveSettings(); }, 'magic-blur');
safeOn(edgeInput, 'input', (e) => { magicWandEdgeSensitivity = parseInt(e.target.value, 10); if (edgeSpan) edgeSpan.textContent = magicWandEdgeSensitivity; scheduleSaveSettings(); }, 'magic-edge');