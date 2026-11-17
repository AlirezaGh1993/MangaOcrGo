// desktop_bridge.js — WebView2 desktop helpers
(function () {
    function isDesktop() {
        return !!(window.mangaDesktop && window.mangaDesktop.available) ||
            document.documentElement.classList.contains('desktop-app') ||
            /[?&]desktop=1/.test(location.search);
    }

    function activateDesktopChrome() {
        if (!isDesktop()) return;
        document.documentElement.classList.add('desktop-app');

        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        };

        bind('desk-refresh', () => {
            if (typeof desktopRefresh === 'function') desktopRefresh();
            else location.reload();
        });
        bind('desk-fullscreen', () => {
            if (typeof desktopFullscreen === 'function') desktopFullscreen();
            else if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
            else document.exitFullscreen?.();
        });
        bind('desk-minimize', () => {
            if (typeof desktopMinimize === 'function') desktopMinimize();
        });
        bind('desk-maximize', () => {
            if (typeof desktopMaximize === 'function') desktopMaximize();
        });
        bind('desk-close', () => {
            if (typeof desktopClose === 'function') desktopClose();
            else window.close();
        });
    }

    async function applyProjectFromServerResult(result) {
        if (!result || result.ok === false) {
            if (result && result.error) showError(result.error);
            return;
        }
        images = [];
        activeImageIndex = -1;
        lastProcessedMarkingIndex = -1;
        const listEl = document.getElementById('image-list');
        if (listEl) listEl.innerHTML = '';
        if (typeof imageContainer !== 'undefined' && imageContainer) imageContainer.innerHTML = '';
        if (typeof clearAllMarkingsConfirmless === 'function') clearAllMarkingsConfirmless();

        currentProjectId = result.project_id;
        localStorage.setItem('currentProjectId', currentProjectId);
        const lockedName = (result.config && result.config.projectName) || '';
        if (typeof projectNameInput !== 'undefined' && projectNameInput) {
            projectNameInput.value = lockedName;
            localStorage.setItem('projectName', lockedName);
        }
        for (const img of result.images || []) {
            await new Promise(resolve => addImageToCanvasCallback(img.url, img.name, resolve));
        }
        if (typeof saveStateToServer === 'function') await saveStateToServer(true);
        if (lockedName && typeof renameProjectOnServer === 'function') {
            try { await renameProjectOnServer(currentProjectId, lockedName); } catch (_) {}
        }
        if (typeof updateBatchSize === 'function') updateBatchSize(true);
        if (typeof updateProjectsList === 'function') updateProjectsList();
        if (typeof renderSidebarImageList === 'function') renderSidebarImageList();
        if (images.length > 0 && typeof switchImage === 'function') switchImage(0);
    }

    async function pickChapterFolder() {
        if (typeof desktopPickFolder === 'function') {
            try {
                const result = await desktopPickFolder();
                await applyProjectFromServerResult(result);
            } catch (e) {
                showError('خطا در انتخاب پوشه: ' + (e.message || e));
            }
            return;
        }
        const input = document.getElementById('folder-upload');
        if (input) input.click();
        else showError('انتخاب پوشه پشتیبانی نمی‌شود.');
    }

    async function pickChapterZip() {
        if (typeof desktopPickZip === 'function') {
            try {
                const result = await desktopPickZip();
                await applyProjectFromServerResult(result);
            } catch (e) {
                showError('خطا در انتخاب ZIP: ' + (e.message || e));
            }
            return;
        }
        const input = document.getElementById('zip-upload');
        if (input) input.click();
    }

    async function pickChapterImages() {
        if (typeof desktopPickImages === 'function') {
            try {
                const result = await desktopPickImages();
                await applyProjectFromServerResult(result);
            } catch (e) {
                showError('خطا در انتخاب تصویر: ' + (e.message || e));
            }
            return;
        }
        const input = document.getElementById('image-upload');
        if (input) input.click();
    }

    // Called when desktop Init cancelled browser default for a file drop
    window.__desktopForwardDrop = async function (e) {
        try {
            if (typeof collectDroppedFiles !== 'function' || typeof handleUploadFlow !== 'function') return;
            const files = await collectDroppedFiles(e.dataTransfer);
            if (files && files.length) await handleUploadFlow(files);
            else if (typeof showError === 'function') {
                showError('برای پوشه از دکمه «پوشه فصل» و برای ZIP از «ZIP فصل» استفاده کنید.');
            }
        } catch (err) {
            console.error(err);
            if (typeof showError === 'function') {
                if (err && err.code === 'FOLDER_EMPTY') {
                    showError('برای پوشه از دکمه «پوشه فصل» استفاده کنید.');
                } else {
                    showError('خطا در دراپ فایل: ' + (err.message || err));
                }
            }
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (/[?&]desktop=1/.test(location.search)) {
            document.documentElement.classList.add('desktop-app');
            window.mangaDesktop = window.mangaDesktop || { available: true };
        }
        activateDesktopChrome();
        // Re-bind sidebar list node after layout settles
        try {
            if (typeof outputList !== 'undefined') outputList = document.getElementById('output-list');
            if (typeof rightSidebar !== 'undefined') rightSidebar = document.getElementById('right-sidebar');
        } catch (_) {}
        setTimeout(() => {
            if (typeof updateOutputList === 'function') updateOutputList();
            if (typeof redrawAllMarkings === 'function') redrawAllMarkings();
        }, 100);

        const fb = document.getElementById('btn-folder-chapter');
        if (fb) fb.addEventListener('click', (e) => { e.preventDefault(); pickChapterFolder(); });
        const zb = document.getElementById('btn-zip-chapter');
        if (zb) zb.addEventListener('click', (e) => { e.preventDefault(); pickChapterZip(); });
        const ib = document.getElementById('btn-images-chapter');
        if (ib) ib.addEventListener('click', (e) => { e.preventDefault(); pickChapterImages(); });

        // Browser fallback labels when not desktop
        if (!isDesktop()) {
            ['image-upload-label', 'folder-upload-label', 'zip-upload-label'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = '';
            });
            // hide native buttons' dual - show labels which are the real inputs
            // Actually keep buttons but wire them to inputs for browser
        }
    });

    window.pickChapterFolder = pickChapterFolder;
    window.pickChapterZip = pickChapterZip;
    window.pickChapterImages = pickChapterImages;
    window.applyProjectFromServerResult = applyProjectFromServerResult;
})();
