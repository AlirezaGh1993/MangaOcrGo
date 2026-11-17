// project_io.js - نسخه v5 (نام‌گذاری هنگام ساخت پروژه + اتصال سوییچر)
var currentProjectId = null;
var saveTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
    if (typeof initSidebarTabs === 'function') initSidebarTabs();
    if (typeof initProjectSystem === 'function') initProjectSystem();
    if (typeof initImageDropZone === 'function') initImageDropZone();
});

function initProjectSystem() {
    const btnNewProject = document.getElementById('btn-create-new-project');
    if (btnNewProject) {
        btnNewProject.addEventListener('click', () => { createNewEmptyProject(); });
    }
    if (typeof initProjectSwitcher === 'function') initProjectSwitcher();   // 🔴 جدید
    if (typeof updateProjectsList === 'function') updateProjectsList();
}

// 🔴 جدید: امکان نام‌گذاری پروژه هنگام ساخت — کادر خالی = نام پیش‌فرض
async function createNewEmptyProject() {
    const desiredName = (prompt("نام پروژه را وارد کنید (برای استفاده از نام پیش‌فرض، خالی بگذارید):") || '').trim();
    try {
        const response = await fetch('/api/project/new', { method: 'POST' });
        const result = await response.json();
        if (response.ok) {
            images = [];
            activeImageIndex = -1;
            lastProcessedMarkingIndex = -1;
            document.getElementById('image-list').innerHTML = '';
            imageContainer.innerHTML = '';
            clearAllMarkingsConfirmless();
            currentProjectId = result.project_id;
            localStorage.setItem('currentProjectId', currentProjectId);
            if (desiredName) {
                projectNameInput.value = desiredName;
                await renameProjectOnServer(currentProjectId, desiredName);
            } else {
                projectNameInput.value = result.config.projectName;
            }
            updateProjectsList();
            renderSidebarImageList();
            const imageTabBtn = document.querySelector('.sidebar-tabs .tab-btn[data-tab="images"]');
            if (imageTabBtn) imageTabBtn.click();
            alert(`پروژه جدید ساخته شد.\nنام: ${projectNameInput.value}\nشناسه: ${currentProjectId}`);
        } else {
            alert("خطا در ساخت پروژه خالی: " + result.error);
        }
    } catch (e) {
        console.error(e);
        alert("برقراری ارتباط با سرور ناموفق بود.");
    }
}

async function renameProjectOnServer(projectId, newName) {
    try {
        const response = await fetch(`/api/project/${projectId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        if (response.ok) {
            updateProjectsList();
            if (projectId === currentProjectId) projectNameInput.value = newName;
        }
    } catch (e) {}
}

async function deleteProjectFromServer(projectId) {
    if (!projectId) return;
    try {
        const response = await fetch(`/api/project/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        if (!response.ok) {
            let msg = response.statusText;
            try { const err = await response.json(); msg = err.error || msg; } catch (_) {}
            alert(`خطا در حذف پروژه: ${msg}`);
            return;
        }
        // همیشه اگر پروژهٔ فعلی حذف شد، محیط کار را کامل خالی کن
        if (projectId === currentProjectId || !currentProjectId) {
            clearWorkspace();
            currentProjectId = null;
            localStorage.removeItem('currentProjectId');
            if (projectNameInput) projectNameInput.value = '';
        }
        if (typeof updateProjectsList === 'function') await updateProjectsList();
    } catch (e) {
        console.error(e);
        alert("خطای ارتباط با سرور هنگام حذف پروژه.");
    }
}

async function loadProjectFromServer(projectId) {
    try {
        const response = await fetch(`/api/project/${projectId}`);
        if (!response.ok) throw new Error("پروژه یافت نشد.");
        const config = await response.json();
        clearWorkspace();
        currentProjectId = projectId;
        localStorage.setItem('currentProjectId', projectId);
        projectNameInput.value = config.projectName || projectId;
        lastProcessedMarkingIndex = config.lastProcessedMarkingIndex !== undefined ? config.lastProcessedMarkingIndex : -1;
        if (config.imagesMeta && typeof addImageToCanvasCallback === 'function') {
            for (const meta of config.imagesMeta) {
                const imgUrl = `/api/projects/${projectId}/images/${meta.name}`;
                await new Promise(resolve => { addImageToCanvasCallback(imgUrl, meta.name, resolve); });
            }
        }
        if (config.genre) genreSelect.value = config.genre;
        if (config.ocrLanguage) { const el = document.getElementById('ocr-language-select'); if (el) el.value = config.ocrLanguage; }
        if (config.ocrDirection) { const el = document.getElementById('ocr-direction-select'); if (el) el.value = config.ocrDirection; }
        if (config.markings) {
            markings = config.markings.map(m => {
                let mappedImageId = images.findIndex(img => img.name === m.imageName);
                if (mappedImageId === -1 && m.imageId !== undefined && m.imageId >= 0 && m.imageId < images.length) {
                    mappedImageId = m.imageId;
                }
                if (mappedImageId === -1) mappedImageId = 0;
                const imageName = (images[mappedImageId] && images[mappedImageId].name) || m.imageName || null;
                return { ...m, imageId: mappedImageId, imageName, overlayElement: null };
            });
            nextMarkingId = config.nextMarkingId || (markings.reduce((mx, m) => Math.max(mx, m.id || 0), 0) + 1);
            updateMarkingNumbers();
            // بازیابی کارت‌های سایدبار و اورلی متن (قبلاً فقط شکل حباب رندر می‌شد)
            if (typeof updateOutputList === 'function') updateOutputList();
            redrawAllMarkings();
            markings.forEach(m => {
                if ((m.originalText || m.translatedText) && typeof createOrUpdateTextOverlay === 'function') {
                    createOrUpdateTextOverlay(m);
                }
            });
        }
        updateProjectsList();
        renderSidebarImageList();
        if (typeof updateButtonStates === 'function') updateButtonStates();
    } catch (e) {
        console.error(e);
        localStorage.removeItem('currentProjectId');
        currentProjectId = null;
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        lmStudioUrl = config.lmStudioUrl || 'http://localhost:1234/v1';
        apiUrlInput.value = lmStudioUrl;
        if (config.batchSize) { batchSizeInput.value = config.batchSize; batchSize = config.batchSize; }
        if (config.autoAdvanceTime) autoAdvanceTimeInput.value = config.autoAdvanceTime;
        const strokeScaleInput = document.getElementById('default-stroke-scale');
        if (config.defaultStrokeScale !== undefined && strokeScaleInput) { strokeScaleInput.value = config.defaultStrokeScale; defaultStrokeScale = config.defaultStrokeScale; }
        const strokeStepInput = document.getElementById('stroke-step');
        if (config.strokeStep !== undefined && strokeStepInput) { strokeStepInput.value = config.strokeStep; strokeStep = config.strokeStep; }
        if (config.ocrTemperature !== undefined) {
            ocrTemperature = parseFloat(config.ocrTemperature);
            const tempInput = document.getElementById('temperature-input');
            const tempSpan = document.getElementById('temperature-value');
            if (tempInput) tempInput.value = ocrTemperature;
            if (tempSpan) tempSpan.textContent = ocrTemperature.toFixed(2);
        }
        const exportPathInput = document.getElementById('export-path-input');
        if (config.exportPath && exportPathInput) exportPathInput.value = config.exportPath;
        const exportWidthInput = document.getElementById('export-width-input');
        if (config.exportWidth !== undefined && exportWidthInput) exportWidthInput.value = config.exportWidth;
        const exportQualityInput = document.getElementById('export-quality-input');
        if (config.exportQuality !== undefined && exportQualityInput) exportQualityInput.value = config.exportQuality;
        const exportFormatSelect = document.getElementById('export-format-select');
        if (config.exportFormat && exportFormatSelect) exportFormatSelect.value = config.exportFormat;
        if (config.magicWandTolerance !== undefined) {
            magicWandTolerance = config.magicWandTolerance;
            const el = document.getElementById('magic-tolerance'); const sp = document.getElementById('tolerance-value');
            if (el) el.value = magicWandTolerance; if (sp) sp.textContent = magicWandTolerance;
        }
        if (config.magicWandBlur !== undefined) {
            magicWandBlur = config.magicWandBlur;
            const el = document.getElementById('magic-blur'); const sp = document.getElementById('blur-value');
            if (el) el.value = magicWandBlur; if (sp) sp.textContent = magicWandBlur.toFixed(1);
        }
        if (config.magicWandEdgeSensitivity !== undefined) {
            magicWandEdgeSensitivity = config.magicWandEdgeSensitivity;
            const el = document.getElementById('magic-edge'); const sp = document.getElementById('edge-value');
            if (el) el.value = magicWandEdgeSensitivity; if (sp) sp.textContent = magicWandEdgeSensitivity;
        }
        if (config.magicWandHoldMs !== undefined) {
            magicWandHoldMs = Math.max(100, Math.min(1000, parseInt(config.magicWandHoldMs, 10) || 500));
            const el = document.getElementById('magic-hold-ms');
            const sp = document.getElementById('magic-hold-ms-value');
            if (el) el.value = magicWandHoldMs;
            if (sp) sp.textContent = magicWandHoldMs;
        }
        if (config.globalTextSizeAdjust !== undefined) {
            globalTextSizeAdjust = Math.max(-4, Math.min(4, parseInt(config.globalTextSizeAdjust, 10) || 0));
            const el = document.getElementById('global-text-size');
            const sp = document.getElementById('global-text-size-value');
            if (el) el.value = globalTextSizeAdjust;
            if (sp) sp.textContent = globalTextSizeAdjust;
        }
        if (config.fontCustomNames) fontCustomNames = config.fontCustomNames;
        updateBatchSize(true);
        if (config.theme && config.theme !== theme) setTheme(config.theme);
    } catch (e) {
        lmStudioUrl = 'http://localhost:1234/v1';
        apiUrlInput.value = lmStudioUrl;
    }
}

async function saveGlobalSettingsToServer() {
    if (isConfigLoading) return;
    const exportPathInput = document.getElementById('export-path-input');
    const exportWidthInput = document.getElementById('export-width-input');
    const exportQualityInput = document.getElementById('export-quality-input');
    const exportFormatSelect = document.getElementById('export-format-select');
    const strokeScaleInput = document.getElementById('default-stroke-scale');
    const strokeStepInput = document.getElementById('stroke-step');
    const themeSelect = document.getElementById('theme-select');
    const tempInput = document.getElementById('temperature-input');
    const state = {
        lmStudioUrl: apiUrlInput.value.trim(),
        batchSize: parseInt(batchSizeInput.value, 10) || 10,
        autoAdvanceTime: parseInt(autoAdvanceTimeInput.value, 10) || 10,
        defaultStrokeScale: strokeScaleInput ? parseFloat(strokeScaleInput.value) : 1.0,
        strokeStep: strokeStepInput ? parseFloat(strokeStepInput.value) : 0.5,
        ocrTemperature: tempInput ? parseFloat(tempInput.value) : ocrTemperature,
        magicWandTolerance: magicWandTolerance,
        magicWandBlur: magicWandBlur,
        magicWandEdgeSensitivity: magicWandEdgeSensitivity,
        magicWandHoldMs: magicWandHoldMs,
        globalTextSizeAdjust: globalTextSizeAdjust,
        exportPath: exportPathInput ? exportPathInput.value.trim() : '',
        exportWidth: exportWidthInput ? parseInt(exportWidthInput.value, 10) : 0,
        exportQuality: exportQualityInput ? parseInt(exportQualityInput.value, 10) : 90,
        exportFormat: exportFormatSelect ? exportFormatSelect.value : 'original',
        theme: themeSelect ? themeSelect.value : theme,
        fontCustomNames: fontCustomNames
    };
    try {
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    } catch (e) { console.error("Error saving global settings:", e); }
}

function buildProjectStatePayload() {
    const cleanMarkings = markings.map(m => {
        const { overlayElement, deleteHandle, ...serializableMark } = m;
        const targetImageName = (images[m.imageId] && images[m.imageId].name)
            || m.imageName
            || null;
        if (targetImageName) serializableMark.imageName = targetImageName;
        return serializableMark;
    });
    const ocrLangInput = document.getElementById('ocr-language-select');
    const ocrDirInput = document.getElementById('ocr-direction-select');
    return {
        project_id: currentProjectId,
        projectName: (projectNameInput && projectNameInput.value.trim()) || currentProjectId,
        genre: genreSelect ? genreSelect.value : 'general',
        ocrLanguage: ocrLangInput ? ocrLangInput.value : 'auto',
        ocrDirection: ocrDirInput ? ocrDirInput.value : 'auto',
        markings: cleanMarkings,
        nextMarkingId: nextMarkingId,
        lastProcessedMarkingIndex: lastProcessedMarkingIndex,
        imagesMeta: images.map(img => ({ name: img.name }))
    };
}

async function saveStateToServer(immediate) {
    // WebView: isConfigLoading sometimes sticks — free after 3s
    if (isConfigLoading && typeof window.__configLoadingSince === 'number' && Date.now() - window.__configLoadingSince > 3000) {
        isConfigLoading = false;
        window.__configLoadingSince = 0;
    }
    if (isConfigLoading || !currentProjectId) return;
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    const doSave = async () => {
        if (!currentProjectId) return;
        const state = buildProjectStatePayload();
        try {
            const res = await fetch(`/api/project/${currentProjectId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            });
            if (!res.ok) {
                console.error('saveStateToServer failed', res.status, await res.text().catch(() => ''));
            }
        } catch (e) {
            console.error('saveStateToServer error', e);
        }
    };
    if (immediate) {
        await doSave();
    } else {
        saveTimeout = setTimeout(doSave, 400);
    }
}

// ذخیره اضطراری هنگام بستن/رفرش صفحه
window.addEventListener('beforeunload', () => {
    if (!currentProjectId || isConfigLoading) return;
    try {
        const state = buildProjectStatePayload();
        // keepalive تا درخواست بعد از بستن تب هم برسد
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
            navigator.sendBeacon(`/api/project/${currentProjectId}`, blob);
        } else {
            fetch(`/api/project/${currentProjectId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state),
                keepalive: true
            });
        }
    } catch (e) { /* ignore */ }
});

async function saveProject() {
    if (images.length === 0) { alert("پروژه‌ای برای پشتیبان‌گیری یافت نشد."); return; }
    const originalText = saveProjectBtn.textContent;
    saveProjectBtn.textContent = 'در حال ذخیره...'; saveProjectBtn.disabled = true;
    try {
        const cleanMarkings = markings.map(m => {
            const { overlayElement, deleteHandle, ...serializableMark } = m;
            const targetImageName = images[m.imageId] ? images[m.imageId].name : null;
            return { ...serializableMark, imageName: targetImageName };
        });
        const projectData = {
            project_id: currentProjectId,
            projectName: projectNameInput.value,
            genre: genreSelect.value,
            markings: cleanMarkings,
            nextMarkingId: nextMarkingId,
            lastProcessedMarkingIndex: lastProcessedMarkingIndex,
            imagesMeta: images.map(img => ({ name: img.name }))
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = (projectNameInput.value.trim().replace(/\s+/g, '_') || "project") + ".json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) { showError("خطا در دانلود پشتیبان: " + e.message); }
    finally { saveProjectBtn.textContent = originalText; saveProjectBtn.disabled = false; }
}

async function loadJsonProject(event) {
    const file = event.target.files[0];
    if (!file) return;
    const originalText = loadJsonBtn.textContent;
    loadJsonBtn.textContent = 'در حال بارگذاری...'; loadJsonBtn.disabled = true;
    try {
        const jsonContent = await file.text();
        const projectData = JSON.parse(jsonContent);
        if (!projectData.imagesMeta || images.length !== projectData.imagesMeta.length) {
            throw new Error("تعداد تصاویر با پروژه مطابقت ندارد.");
        }
        clearAllMarkingsConfirmless();
        projectNameInput.value = projectData.projectName || "";
        if (projectData.genre) genreSelect.value = projectData.genre;
        nextMarkingId = projectData.nextMarkingId || 1;
        currentProjectId = projectData.project_id || currentProjectId;
        lastProcessedMarkingIndex = projectData.lastProcessedMarkingIndex !== undefined ? projectData.lastProcessedMarkingIndex : -1;
        markings = projectData.markings || [];
        markings.forEach(m => { m.overlayElement = null; });
        if (images.length > 0) {
            setActiveImage(0);
            updateOutputList();
            await saveStateToServer();
            alert("پروژه بارگذاری و با سرور همگام شد.");
            renderSidebarImageList();
        }
    } catch (e) { showError("خطا: " + e.message); }
    finally { loadJsonBtn.textContent = originalText; loadJsonBtn.disabled = false; loadJsonInput.value = ''; }
}

function clearAllMarkingsConfirmless() {
    try {
        markings.forEach(m => {
            if (m.overlayElement) {
                try { m.overlayElement.remove(); } catch (_) {}
            }
        });
    } catch (_) {}
    markings = [];
    nextMarkingId = 1;
    lastProcessedMarkingIndex = -1;
    selectedMarking = null;
    const listEl = outputList || document.getElementById('output-list');
    if (listEl) listEl.innerHTML = '';
}

/** پاک‌سازی کامل محیط کار (تصاویر + علامت‌ها + سایدبار) */
function clearWorkspace() {
    try {
        // revoke object URLs if any
        if (Array.isArray(images)) {
            images.forEach(img => {
                if (img && img.src && String(img.src).startsWith('blob:')) {
                    try { URL.revokeObjectURL(img.src); } catch (_) {}
                }
            });
        }
    } catch (_) {}
    images = [];
    activeImageIndex = -1;
    const imgList = document.getElementById('image-list');
    if (imgList) imgList.innerHTML = '';
    const container = imageContainer || document.getElementById('image-container');
    if (container) container.innerHTML = '';
    clearAllMarkingsConfirmless();
    if (typeof updateButtonStates === 'function') updateButtonStates();
    if (typeof renderSidebarImageList === 'function') renderSidebarImageList();
}

function saveApiUrl() {
    const newApiUrl = apiUrlInput.value.trim();
    if (newApiUrl) { lmStudioUrl = newApiUrl; saveGlobalSettingsToServer(); alert('آدرس سرور ذخیره شد.'); }
    else { showError('آدرس نامعتبر است.'); }
}

function updateBatchSize(skipSave = false) {
    let val = parseInt(batchSizeInput.value, 10);
    if (isNaN(val) || val < 5) val = 5;
    if (val > 50) val = 50;
    batchSize = val;
    batchSizeInput.value = val;
    batchInfoText.textContent = `هر بار ${batchSize} مورد ارسال می‌شود.`;
    updateButtonStates();
    if (!skipSave) saveGlobalSettingsToServer();
}

document.addEventListener('DOMContentLoaded', () => {
    const globalInputs = [
        batchSizeInput, autoAdvanceTimeInput,
        document.getElementById('export-resize-percent'),
        document.getElementById('magic-tolerance'),
        document.getElementById('magic-blur'),
        document.getElementById('magic-edge'),
        document.getElementById('export-path-input'),
        document.getElementById('export-width-input'),
        document.getElementById('export-quality-input'),
        document.getElementById('export-format-select'),
        document.getElementById('default-stroke-scale'),
        document.getElementById('stroke-step'),
        document.getElementById('theme-select'),
        document.getElementById('temperature-input')
    ];
    const tempInput = document.getElementById('temperature-input');
    const tempSpan = document.getElementById('temperature-value');
    if (tempInput && tempSpan) {
        tempInput.addEventListener('input', (e) => {
            ocrTemperature = parseFloat(e.target.value);
            tempSpan.textContent = ocrTemperature.toFixed(2);
        });
    }
    globalInputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveGlobalSettingsToServer);
            input.addEventListener('input', saveGlobalSettingsToServer);
        }
    });
    const projectInputs = [
        projectNameInput, genreSelect,
        document.getElementById('ocr-language-select'),
        document.getElementById('ocr-direction-select')
    ];
    projectInputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveStateToServer);
            input.addEventListener('input', () => {
                saveStateToServer();
                if (input === projectNameInput) updateProjectsList();
            });
        }
    });
});