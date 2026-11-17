// project_images_engine.js - موتور ناهمگام بارگذاری فیزیکی و رندر Canvas تصاویر

/** Natural compare: page2 < page10, 001 < 002, ignores path case. */
function naturalFileCompare(a, b) {
    const ax = String(a || '');
    const bx = String(b || '');
    const re = /(\d+)|(\D+)/g;
    const pa = ax.match(re) || [];
    const pb = bx.match(re) || [];
    const n = Math.min(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const da = parseInt(pa[i], 10);
        const db = parseInt(pb[i], 10);
        if (!isNaN(da) && !isNaN(db)) {
            if (da !== db) return da - db;
            continue;
        }
        const sa = pa[i].toLowerCase();
        const sb = pb[i].toLowerCase();
        if (sa !== sb) return sa < sb ? -1 : 1;
    }
    return pa.length - pb.length;
}

function isImageFileName(name) {
    return /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name || '');
}

function isZipFileName(name) {
    return /\.zip$/i.test(name || '');
}

/**
 * From a FileList (files / folder / zip), build sorted list + suggested project name.
 * Folder upload → name = top-level folder. ZIP → name without .zip.
 */
function fileRelPath(f) {
    return (f && (f._relativePath || f.webkitRelativePath || f.name)) || '';
}

/**
 * From files (picker / folder / zip / drag-drop), sorted list + project name.
 * Folder → top-level folder name. ZIP → filename without .zip.
 */
function prepareUploadBatch(fileList) {
    const files = Array.from(fileList || []);
    let projectName = null;
    const accepted = [];

    for (const f of files) {
        const rel = fileRelPath(f);
        if (isZipFileName(f.name)) {
            accepted.push(f);
            if (!projectName) {
                projectName = f.name.replace(/\.zip$/i, '').trim();
            }
            continue;
        }
        if (isImageFileName(f.name) || (f.type && f.type.startsWith('image/'))) {
            accepted.push(f);
            if (!projectName && rel) {
                const parts = rel.split(/[/\\]/).filter(Boolean);
                if (parts.length > 1) projectName = parts[0];
            }
        }
    }

    accepted.sort((a, b) => naturalFileCompare(fileRelPath(a), fileRelPath(b)));

    if (!projectName && accepted.length === 1 && isZipFileName(accepted[0].name)) {
        projectName = accepted[0].name.replace(/\.zip$/i, '').trim();
    }
    return { files: accepted, projectName: projectName ? String(projectName).trim() : null };
}

/**
 * Attach a relative path used for natural sort + chapter name inference.
 */
function attachRelPath(file, rel) {
    try {
        Object.defineProperty(file, '_relativePath', { value: rel, configurable: true });
    } catch (_) {
        try { file._relativePath = rel; } catch (__) {}
    }
    return file;
}

function readFileEntry(fileEntry, parentPath) {
    return new Promise((resolve, reject) => {
        fileEntry.file(
            (file) => {
                const rel = parentPath ? (parentPath + '/' + file.name) : file.name;
                resolve(attachRelPath(file, rel));
            },
            reject
        );
    });
}

/**
 * Stable directory reader: exhaust readEntries synchronously first,
 * then process entries. Avoids the classic async/race empty-result bug.
 */
function readAllDirectoryEntries(dirEntry) {
    return new Promise((resolve, reject) => {
        const reader = dirEntry.createReader();
        const entries = [];
        const pump = () => {
            reader.readEntries(
                (batch) => {
                    if (!batch.length) {
                        resolve(entries);
                        return;
                    }
                    for (let i = 0; i < batch.length; i++) entries.push(batch[i]);
                    pump();
                },
                reject
            );
        };
        pump();
    });
}

async function readDirectoryEntry(dirEntry, parentPath) {
    const path = parentPath ? (parentPath + '/' + dirEntry.name) : dirEntry.name;
    const entries = await readAllDirectoryEntries(dirEntry);
    const files = [];
    for (const entry of entries) {
        if (entry.isFile) {
            files.push(await readFileEntry(entry, path));
        } else if (entry.isDirectory) {
            const nested = await readDirectoryEntry(entry, path);
            files.push(...nested);
        }
    }
    return files;
}

/** Collect files from a drop event (folders + zips + images). */
async function collectDroppedFiles(dataTransfer) {
    if (!dataTransfer) return [];
    const out = [];
    let usedEntryApi = false;

    if (dataTransfer.items && dataTransfer.items.length) {
        const jobs = [];
        for (let i = 0; i < dataTransfer.items.length; i++) {
            const item = dataTransfer.items[i];
            if (item.kind !== 'file') continue;
            const entry = (typeof item.webkitGetAsEntry === 'function') ? item.webkitGetAsEntry() : null;
            if (entry) {
                usedEntryApi = true;
                if (entry.isDirectory) {
                    jobs.push(readDirectoryEntry(entry, ''));
                } else if (entry.isFile) {
                    jobs.push(readFileEntry(entry, '').then((f) => [f]));
                }
            } else if (typeof item.getAsFile === 'function') {
                const f = item.getAsFile();
                if (f) out.push(f);
            }
        }
        if (jobs.length) {
            const groups = await Promise.all(jobs);
            for (const g of groups) out.push(...g);
        }
    }

    // Fallback when Entry API unavailable or returned nothing
    if (!out.length && dataTransfer.files && dataTransfer.files.length) {
        return Array.from(dataTransfer.files);
    }

    if (!out.length && usedEntryApi) {
        // Folder drop attempted but yielded 0 files (browser limitation)
        const err = new Error('FOLDER_EMPTY');
        err.code = 'FOLDER_EMPTY';
        throw err;
    }
    return out;
}

function isChapterBatch(batch) {
    if (!batch || !batch.files || !batch.files.length) return false;
    if (batch.files.some(f => isZipFileName(f.name))) return true;
    // Folder-style: relative paths with a parent segment
    if (batch.projectName) {
        const withPath = batch.files.filter(f => {
            const rel = fileRelPath(f);
            return rel && rel !== f.name && rel.indexOf('/') >= 0;
        });
        if (withPath.length >= 1) return true;
    }
    return false;
}

function showUploadStatus(msg) {
    if (typeof showError === 'function') {
        // reuse error box as status (non-fatal messages ok)
        showError(msg);
    } else {
        console.log(msg);
    }
}

async function handleUploadFlow(fileList) {
    const batch = prepareUploadBatch(fileList);
    if (!batch.files.length) {
        showError('هیچ تصویر یا فایل ZIP معتبری یافت نشد. برای پوشه از دکمه «پوشه فصل» استفاده کنید.');
        return;
    }

    // Infer chapter name aggressively
    let chapterName = batch.projectName;
    if (!chapterName) {
        const z = batch.files.find(f => isZipFileName(f.name));
        if (z) chapterName = z.name.replace(/\.zip$/i, '').trim();
    }
    if (!chapterName) {
        for (const f of batch.files) {
            const rel = fileRelPath(f);
            const parts = rel.split(/[/\\]/).filter(Boolean);
            if (parts.length > 1) { chapterName = parts[0]; break; }
        }
    }

    const formData = new FormData();
    for (const f of batch.files) {
        formData.append('files', f, fileRelPath(f) || f.name);
    }
    if (chapterName) {
        formData.append('project_name', chapterName);
    }

    // Step 2: ZIP or folder chapter → ALWAYS new project (no ambiguous confirm)
    if (isChapterBatch(batch) || (chapterName && batch.files.some(f => isZipFileName(f.name)))) {
        await createProjectFromUpload(formData, chapterName);
        return;
    }

    // Loose images only
    if (currentProjectId) {
        try {
            const response = await fetch(`/api/project/${currentProjectId}/images/add`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if (response.ok) {
                for (const img of result.images || []) {
                    await new Promise(resolve => addImageToCanvasCallback(img.url, img.name, resolve));
                }
                if (typeof saveStateToServer === 'function') await saveStateToServer();
                if (typeof renderSidebarImageList === 'function') renderSidebarImageList();
            } else {
                showError(result.error || 'خطا در افزودن تصاویر');
            }
        } catch (e) {
            console.error(e);
            showError('خطا در الحاق تصاویر: ' + (e.message || e));
        }
        return;
    }

    await createProjectFromUpload(formData, chapterName);
}

async function createProjectFromUpload(formData, suggestedName) {
    try {
        // Ensure project_name is on the form even if caller forgot
        if (suggestedName && !formData.has('project_name')) {
            formData.append('project_name', suggestedName);
        }

        const response = await fetch('/api/project/new', { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) {
            showError(result.error || 'خطا در ساخت پروژه');
            return;
        }

        images = [];
        activeImageIndex = -1;
        lastProcessedMarkingIndex = -1;
        const listEl = document.getElementById('image-list');
        if (listEl) listEl.innerHTML = '';
        if (imageContainer) imageContainer.innerHTML = '';
        if (typeof clearAllMarkingsConfirmless === 'function') clearAllMarkingsConfirmless();

        currentProjectId = result.project_id;
        localStorage.setItem('currentProjectId', currentProjectId);

        // Step 3: lock name on UI from server response (or suggested chapter name)
        const lockedName = (result.config && result.config.projectName)
            || suggestedName
            || '';
        if (projectNameInput) {
            projectNameInput.value = lockedName;
            localStorage.setItem('projectName', lockedName);
        }

        for (const img of result.images || []) {
            await new Promise(resolve => addImageToCanvasCallback(img.url, img.name, resolve));
        }

        // Persist with the locked name (prevent overwrite by empty field)
        if (typeof saveStateToServer === 'function') {
            if (projectNameInput && lockedName) projectNameInput.value = lockedName;
            await saveStateToServer(true);
        }
        // Explicit rename on server to be safe
        if (lockedName && currentProjectId && typeof renameProjectOnServer === 'function') {
            try { await renameProjectOnServer(currentProjectId, lockedName); } catch (_) {}
        }

        if (typeof updateBatchSize === 'function') updateBatchSize(true);
        if (typeof updateProjectsList === 'function') updateProjectsList();
        if (typeof renderSidebarImageList === 'function') renderSidebarImageList();
        if (images.length > 0 && typeof switchImage === 'function') switchImage(0);

        if (lockedName) {
            console.log('پروژه فصل ساخته شد:', lockedName, currentProjectId);
        }
    } catch (e) {
        console.error('خطا در ساخت پروژه:', e);
        showError('خطا در ساخت پروژه: ' + (e.message || e));
    }
}

async function handleFiles(event) {
    if (event && event.target && event.target.files) {
        await handleUploadFlow(event.target.files);
    }
}


function addImageToCanvasCallback(src, fileName, callback) {
    const img = new Image();
    img.onload = () => {
        const imageId = images.length;
        const canvas = document.createElement('canvas');
        const wrapper = document.createElement('div');
        wrapper.className = 'image-wrapper';
        wrapper.dataset.imageId = imageId;
        canvas.width = img.width; canvas.height = img.height;
        wrapper.style.width = `${img.width}px`; wrapper.style.height = `${img.height}px`;
        wrapper.appendChild(img); wrapper.appendChild(canvas);
        wrapper.style.display = (activeImageIndex !== -1) ? 'none' : 'block';
        
        imageContainer.appendChild(wrapper);
        images.push({ id: imageId, element: img, canvas, context: canvas.getContext('2d'), wrapper, name: fileName });
        
        if (activeImageIndex === -1) setActiveImage(imageId);
        if (callback) callback();
    };
    img.src = src;
}

function addImageToCanvas(src, fileName) {
    addImageToCanvasCallback(src, fileName, null);
}

function setActiveImage(imageId) {
    if (images.length === 0) return;
    
    if (activeImageIndex > -1 && images[activeImageIndex]) {
        images[activeImageIndex].wrapper.style.display = 'none';
        markings.filter(m => m.imageId === activeImageIndex && m.overlayElement).forEach(m => m.overlayElement.style.display = 'none');
    }

    activeImageIndex = imageId;

    if (images[activeImageIndex]) {
        images[activeImageIndex].wrapper.style.display = 'block';
        resetZoomAndPan();
        redrawAllMarkings();
        markings.filter(m => m.imageId === imageId && m.overlayElement).forEach(m => m.overlayElement.style.display = 'flex');
        
        if (typeof renderSidebarImageList === 'function') {
            renderSidebarImageList();
            
            const activeCard = document.querySelector(`.image-list-item[data-index="${imageId}"]`);
            if (activeCard) {
                activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }
}

async function deleteAllImages() {
    if (!currentProjectId) return;
    try {
        const response = await fetch(`/api/project/${currentProjectId}/images/all`, { method: 'DELETE' });
        if (response.ok) {
            images = [];
            clearAllMarkingsConfirmless();
            document.getElementById('image-list').innerHTML = '';
            imageContainer.innerHTML = '';
            activeImageIndex = -1;
            lastProcessedMarkingIndex = -1;
            
            if (typeof updateProjectsList === 'function') updateProjectsList();
            if (typeof renderSidebarImageList === 'function') renderSidebarImageList();
            alert("تمام تصاویر پروژه با موفقیت حذف شدند.");
        } else {
            alert("خطا در حذف تصاویر از سرور.");
        }
    } catch (e) {
        console.error("خطا در ارتباط با سرور:", e);
    }
}