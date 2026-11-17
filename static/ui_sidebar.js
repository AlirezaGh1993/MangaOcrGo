// ui_sidebar.js - نسخه مینی‌مال شده کارت‌ها با پشتیبانی از حالت پس‌زمینه ابری ☁️

function updateOutputList() {
    try {
        const listEl = outputList || document.getElementById('output-list');
        const sideEl = rightSidebar || document.getElementById('right-sidebar');
        if (!listEl) {
            console.error('updateOutputList: #output-list not found');
            return;
        }
        const scrollPos = sideEl ? sideEl.scrollTop : 0;
        const sortedMarkings = [...markings].sort((a, b) => (a.id || 0) - (b.id || 0));

        // حذف آیتم‌های یتیم
        Array.from(listEl.children).forEach(item => {
            const id = parseInt(item.dataset.markId, 10);
            if (!markings.find(m => m.id === id)) item.remove();
        });

        sortedMarkings.forEach(mark => {
            if (mark.id === undefined || mark.id === null) return;
            let item = listEl.querySelector(`.output-item[data-mark-id="${mark.id}"]`);
            if (!item) {
                // جستجو در کل document در صورت جابه‌جایی
                item = document.querySelector(`.output-item[data-mark-id="${mark.id}"]`);
            }
            if (!item) {
                item = createOutputItem(mark);
                listEl.appendChild(item);
            } else {
                if (item.parentElement !== listEl) listEl.appendChild(item);
                updateOutputItemContent(item, mark);
            }
        });

        if (retryDeletedBtn) {
            retryDeletedBtn.classList.toggle('hidden', !markings.some(m => m.needsRetry));
        }
        if (typeof updateButtonStates === 'function') updateButtonStates();
        if (sideEl) sideEl.scrollTop = scrollPos;
    } catch (err) {
        console.error('updateOutputList error:', err);
    }
}

function createOutputItem(mark) {
    const item = document.createElement('div');
    item.className = 'output-item';
    item.dataset.markId = mark.id;
    
    item.innerHTML = `
        <button class="delete-output-btn" title="پاک کردن این متن">&times;</button>
        <span class="output-item-number"></span>
        <span class="retry-single-btn" title="ارسال مجدد این مورد" style="display:none;">&#8635;</span>
        <div class="output-item-header">
            <textarea class="output-item-text" rows="2"></textarea>
        </div>
        <div class="output-item-controls">
            <input type="color" class="control-color" style="width:30px; padding:0; border:none;" title="رنگ متن">
            <button class="icon-btn control-bg-picker" title="انتخاب رنگ پس‌زمینه">💉</button>
            <button class="icon-btn control-font-toggle" title="تغییر فونت (T)">T</button>
            <div style="display:flex; gap:2px; margin-left:10px;">
                <span style="border-left:1px solid #ccc; margin:0 5px;"></span>
                <button class="icon-btn control-font-minus" title="کوچک کردن متن">-</button>
                <button class="icon-btn control-font-plus" title="بزرگ کردن متن">+</button>
                <button class="icon-btn control-width" title="تغییر عرض محدوده متن">↔</button>
                <button class="icon-btn control-blur" title="تار یا ابری کردن پس‌زمینه">💧</button>
                <button class="icon-btn control-stroke" title="تغییر ضخامت استروک">✒️</button>
                <button class="icon-btn control-writing-mode" title="جهت نوشتن">T↓</button>
            </div>
        </div>
    `;

    const deleteBtn = item.querySelector('.delete-output-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteSingleOutput(mark.id));

    const numSpan = item.querySelector('.output-item-number');
    if (numSpan) numSpan.addEventListener('click', () => scrollToMarking(mark));

    const retryBtn = item.querySelector('.retry-single-btn');
    if (retryBtn) retryBtn.addEventListener('click', () => retrySingleMarking(mark, retryBtn));

    const textArea = item.querySelector('.output-item-text');
    if (textArea) {
        textArea.addEventListener('input', e => {
            if (showOriginal) mark.originalText = e.target.value;
            else mark.translatedText = e.target.value;
            createOrUpdateTextOverlay(mark);
            if (retryBtn) retryBtn.style.display = e.target.value ? 'none' : 'inline-block';
            
            if (typeof saveStateToServer === 'function') saveStateToServer();
        });
    }

    const colorInput = item.querySelector('.control-color');
    if (colorInput) {
        colorInput.addEventListener('input', e => {
            mark.textColor = e.target.value; 
            createOrUpdateTextOverlay(mark);
            if (typeof saveStateToServer === 'function') saveStateToServer();
        });
    }

    const bgPickerBtn = item.querySelector('.control-bg-picker');
    if (bgPickerBtn) {
        bgPickerBtn.addEventListener('click', () => {
            isPickingColorForId = mark.id; 
            document.getElementById('image-container-wrapper').style.cursor = 'crosshair';
            bgPickerBtn.style.backgroundColor = '#ffeb3b';
            setTimeout(() => bgPickerBtn.style.backgroundColor = '', 2000);
        });
    }

    const fontBtn = item.querySelector('.control-font-toggle');
    if (fontBtn) {
        fontBtn.addEventListener('click', () => {
            const currentFontIndex = mark.fontIndex !== undefined ? mark.fontIndex : 0;
            const nextIndex = getNextAvailableFontIndex(currentFontIndex);
            mark.fontIndex = nextIndex;
            createOrUpdateTextOverlay(mark);
            updateOutputItemContent(item, mark);
            if (typeof saveStateToServer === 'function') saveStateToServer();
        });
    }

    const minusBtn = item.querySelector('.control-font-minus');
    if (minusBtn) minusBtn.addEventListener('click', () => {
        mark.fontSizeScale = (mark.fontSizeScale || 1.0) - 0.1;
        if(mark.fontSizeScale < 0.1) mark.fontSizeScale = 0.1;
        createOrUpdateTextOverlay(mark);
        if (typeof saveStateToServer === 'function') saveStateToServer();
    });

    const plusBtn = item.querySelector('.control-font-plus');
    if (plusBtn) plusBtn.addEventListener('click', () => {
        mark.fontSizeScale = (mark.fontSizeScale || 1.0) + 0.1;
        createOrUpdateTextOverlay(mark);
        if (typeof saveStateToServer === 'function') saveStateToServer();
    });
    
    const widthBtn = item.querySelector('.control-width');
    if (widthBtn) widthBtn.addEventListener('click', () => {
        if (!mark.textWidthScale || mark.textWidthScale === 1.0) mark.textWidthScale = 1.5;
        else if (mark.textWidthScale === 1.5) mark.textWidthScale = 2.0;
        else if (mark.textWidthScale === 2.0) mark.textWidthScale = 3.0;
        else mark.textWidthScale = 1.0;
        createOrUpdateTextOverlay(mark);
        if (typeof saveStateToServer === 'function') saveStateToServer();
    });

    // پیاده‌سازی چرخه ۳‌تایی دکمه پس‌زمینه (عادی ➔ تار 💧 ➔ ابری ☁️ ➔ عادی)
    const blurBtn = item.querySelector('.control-blur');
    if (blurBtn) {
        blurBtn.addEventListener('click', () => {
            let currentMode = mark.bgMode || (mark.isBlurred ? 'blur' : 'none');
            if (currentMode === 'none') currentMode = 'blur';
            else if (currentMode === 'blur') currentMode = 'cloud';
            else currentMode = 'none';

            mark.bgMode = currentMode;
            mark.isBlurred = (currentMode === 'blur');

            updateOutputItemContent(item, mark);
            createOrUpdateTextOverlay(mark);
            if (typeof saveStateToServer === 'function') saveStateToServer();
        });
    }

    const strokeBtn = item.querySelector('.control-stroke');
    if (strokeBtn) {
        strokeBtn.addEventListener('click', () => { 
            const current = mark.strokeWidthScale !== undefined ? mark.strokeWidthScale : defaultStrokeScale;
            let newVal = current + strokeStep;
            if (newVal > MAX_STROKE) newVal = defaultStrokeScale;
            if (newVal < defaultStrokeScale) newVal = defaultStrokeScale;
            mark.strokeWidthScale = newVal;
            
            strokeBtn.title = `ضخامت استروک: ${newVal.toFixed(1)}x`;
            strokeBtn.textContent = Math.abs(newVal - defaultStrokeScale) < 0.01 ? '✒️' : `${newVal.toFixed(1)}x`;
            createOrUpdateTextOverlay(mark);
            if (typeof saveStateToServer === 'function') saveStateToServer();
        }); 
    }

    const writingModeBtn = item.querySelector('.control-writing-mode');
    if (writingModeBtn) writingModeBtn.addEventListener('click', () => {
        mark.isVerticalWriting = !mark.isVerticalWriting;
        writingModeBtn.classList.toggle('active', mark.isVerticalWriting);
        createOrUpdateTextOverlay(mark);
        if (typeof saveStateToServer === 'function') saveStateToServer();
    });

    updateOutputItemContent(item, mark);
    return item;
}

function updateOutputItemContent(item, mark) {
    if (selectedMarking && selectedMarking.id === mark.id) item.classList.add('active-selection');
    else item.classList.remove('active-selection');
    
    if (currentBatchMarkings.includes(mark)) item.classList.add('current-batch-item');
    else item.classList.remove('current-batch-item');
    
    if (mark.needsRetry) item.classList.add('needs-retry');
    else item.classList.remove('needs-retry');

    const numSpan = item.querySelector('.output-item-number');
    if (numSpan) numSpan.textContent = `[${String(mark.displayId).padStart(3, '0')}]`;
    
    const textArea = item.querySelector('.output-item-text');
    if (textArea) {
        const targetText = showOriginal ? (mark.originalText || '') : (mark.translatedText || '');
        if (textArea.value !== targetText && document.activeElement !== textArea) {
            textArea.value = targetText;
        }
        const fontIndex = mark.fontIndex !== undefined ? mark.fontIndex : 0;
        const family = getFontFamilyByIndex(fontIndex);
        textArea.style.fontFamily = `"${family}", Tahoma`;
    }

    const retryBtn = item.querySelector('.retry-single-btn');
    if (retryBtn) retryBtn.style.display = (!mark.originalText && !mark.translatedText) ? 'inline-block' : 'none';

    const colorInput = item.querySelector('.control-color');
    if (colorInput) colorInput.value = mark.textColor || '#000000';

    // به‌روزرسانی پویا آیکون و تولتیپ دکمه پس‌زمینه بر اساس وضعیت فعال
    const blurBtn = item.querySelector('.control-blur');
    if (blurBtn) {
        const mode = mark.bgMode || (mark.isBlurred ? 'blur' : 'none');
        blurBtn.classList.toggle('active', mode !== 'none');
        if (mode === 'cloud') {
            blurBtn.textContent = '☁️';
            blurBtn.title = 'پس‌زمینه ابری (کلیک برای غیرفعال‌سازی)';
        } else if (mode === 'blur') {
            blurBtn.textContent = '💧';
            blurBtn.title = 'پس‌زمینه تار (کلیک برای حالت ابری ☁️)';
        } else {
            blurBtn.textContent = '💧';
            blurBtn.title = 'تار یا ابری کردن پس‌زمینه (💧 / ☁️)';
        }
    }
    
    const fontBtn = item.querySelector('.control-font-toggle');
    if (fontBtn) {
        const idx = mark.fontIndex !== undefined ? mark.fontIndex : 0;
        fontBtn.innerHTML = idx === 0 ? 'T' : `T<sub style="font-size:0.7em; vertical-align: sub;">${idx}</sub>`;
        
        let displayName = 'سیستمی (پیش‌فرض)';
        if (idx === 0) {
            if (loadedFonts[0]) {
                displayName = 'پیش‌فرض (بارگذاری شده)';
            }
        } else {
            const customName = fontCustomNames[idx] || '';
            displayName = customName.trim() ? customName : `فونت ${idx}`;
        }
        fontBtn.title = `فونت فعلی: ${displayName}`;
    }

    const strokeBtn = item.querySelector('.control-stroke');
    if (strokeBtn) {
        const val = mark.strokeWidthScale !== undefined ? mark.strokeWidthScale : defaultStrokeScale;
        if (mark.strokeWidthScale === undefined) mark.strokeWidthScale = val;
        strokeBtn.textContent = Math.abs(val - defaultStrokeScale) < 0.01 ? '✒️' : `${val.toFixed(1)}x`;
        strokeBtn.title = `ضخامت استروک: ${val.toFixed(1)}x`;
    }

    const writingModeBtn = item.querySelector('.control-writing-mode');
    if (writingModeBtn) writingModeBtn.classList.toggle('active', mark.isVerticalWriting || false);
    
    if (mark.originalText || mark.translatedText) {
        createOrUpdateTextOverlay(mark);
    }
}

// 🔴 جایگزین updateButtonStates — آیکون/نشان به‌جای متن
function updateButtonStates() {
    const sortedMarkings = [...markings].sort((a, b) => a.id - b.id);
    const remainingMarkings = sortedMarkings.slice(lastProcessedMarkingIndex + 1);
    const sendBadge = document.getElementById('send-batch-badge');
    sendBatchBtn.disabled = isAwaitingConfirmation || remainingMarkings.length === 0;
    sendBatchBtn.classList.toggle('hidden', isAwaitingConfirmation);
    confirmNextBtn.classList.toggle('hidden', !isAwaitingConfirmation);
    retryEmptyBtn.classList.toggle('hidden', !isAwaitingConfirmation || !currentBatchMarkings.some(m => !m.originalText && !m.translatedText));
    if (!isAwaitingConfirmation) {
        if (remainingMarkings.length > 0) {
            const count = Math.min(remainingMarkings.length, batchSize);
            if (sendBadge) sendBadge.textContent = count;
            sendBatchBtn.setAttribute('data-tip', `ارسال ${count} علامت بعدی`);
            sendBatchBtn.classList.remove('auto-mode-active');
            const startNum = remainingMarkings[0].displayId;
            const endNum = remainingMarkings[count - 1].displayId;
            batchRangeDisplay.textContent = `(${String(startNum).padStart(3,'0')} تا ${String(endNum).padStart(3,'0')})`;
        } else if (markings.length > 0) {
            if (sendBadge) sendBadge.textContent = '';
            sendBatchBtn.setAttribute('data-tip', 'تمام علامت‌ها پردازش شدند');
            batchRangeDisplay.textContent = '';
        } else {
            if (sendBadge) sendBadge.textContent = batchSize;
            sendBatchBtn.setAttribute('data-tip', `ارسال ${batchSize} علامت بعدی`);
            batchRangeDisplay.textContent = '';
        }
    } else {
        if (!isAutoAdvancePending) batchRangeDisplay.textContent = 'منتظر تایید...';
    }
}

// 🔴 جایگزین confirmBatchAndProceed
function confirmBatchAndProceed() {
    if (autoAdvanceTimerId) {
        clearTimeout(autoAdvanceTimerId);
        autoAdvanceTimerId = null;
        isAutoAdvancePending = false;
        const confirmBadge = document.getElementById('confirm-badge');
        if (confirmBadge) confirmBadge.textContent = '';
        confirmNextBtn.setAttribute('data-tip', 'تایید و ارسال بعدی');
        confirmNextBtn.classList.remove('auto-mode-active');
    }
    lastProcessedMarkingIndex += currentBatchMarkings.length;
    currentBatchMarkings = [];
    isAwaitingConfirmation = false;
    updateOutputList();
    if (typeof saveStateToServer === 'function') saveStateToServer();
}

function highlightSidebarItem(markId) {
    const allItems = document.querySelectorAll('.output-item');
    allItems.forEach(item => item.classList.remove('active-selection'));
    if (markId) {
        const activeItem = document.querySelector(`.output-item[data-mark-id="${markId}"]`);
        if (activeItem) {
            activeItem.classList.add('active-selection');
            activeItem.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
    }
}

function scrollToSidebarItem(markId) {
    const item = document.querySelector(`.output-item[data-mark-id="${markId}"]`);
    if (item) item.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function scrollToMarking(mark) {
    if (activeImageIndex !== mark.imageId) setActiveImage(mark.imageId);
    selectedMarking = mark;
    highlightSidebarItem(mark.id);
    redrawAllMarkings();
    
    const ctx = images[mark.imageId].context;
    let flashCount = 0;
    const flashInterval = setInterval(() => {
        if(flashCount % 2 === 0) {
             ctx.strokeStyle = '#00ff00';
             ctx.lineWidth = 4 / zoomLevel;
             drawMarkingShape(ctx, mark);
        } else {
             redrawAllMarkings();
        }
        flashCount++;
        if(flashCount > 5) {
            clearInterval(flashInterval);
            redrawAllMarkings();
        }
    }, 150);
}

function drawMarkingShape(ctx, mark) {
    if (mark.type === 'rect') {
        ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
    } else if (mark.type === 'ellipse') {
        ctx.beginPath();
        const cx = mark.x + mark.width/2;
        const cy = mark.y + mark.height/2;
        ctx.ellipse(cx, cy, mark.width/2, mark.height/2, 0, 0, 2 * Math.PI);
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.moveTo(mark.points[0].x, mark.points[0].y);
        mark.points.forEach(p => ctx.lineTo(p.x, p.y));
        if (mark.type === 'polygon') ctx.closePath();
        ctx.stroke();
    }
}

function clearAllOutputs() {
    markings.forEach(m => {
        m.originalText = ''; m.translatedText = ''; m.needsRetry = false; 
        m.textColor = undefined; m.rotation = undefined; m.isVertical = undefined; 
        m.fontSizeScale = 1.0; m.textWidthScale = 1.0; m.isBlurred = false; m.bgMode = 'none';
        m.strokeWidthScale = defaultStrokeScale;
        m.isVerticalWriting = false;
        if (m.overlayElement) { m.overlayElement.remove(); m.overlayElement = null; }
    });
    lastProcessedMarkingIndex = -1; currentBatchMarkings = []; isAwaitingConfirmation = false;
    updateOutputList();
    if (typeof saveStateToServer === 'function') saveStateToServer();
}

function clearAllExtractedText() {
    if (!confirm("آیا می‌خواهید تمام متن‌های استخراج شده را برای ارسال مجدد پاک کنید؟")) return;
    markings.forEach(m => {
        m.originalText = '';
        m.needsRetry = false;
        m.fontSizeScale = 1.0;
        m.textWidthScale = 1.0;
        m.isBlurred = false;
        m.bgMode = 'none';
        m.strokeWidthScale = defaultStrokeScale;
        m.isVerticalWriting = false;
        if (m.overlayElement) {
            m.overlayElement.remove();
            m.overlayElement = null;
        }
    });
    lastProcessedMarkingIndex = -1;
    isAwaitingConfirmation = false;
    currentBatchMarkings = [];
    updateOutputList();
    if (typeof saveStateToServer === 'function') saveStateToServer();
    alert("تمام متن‌ها پاک شدند. می‌توانید از ابتدا ارسال کنید.");
}

function deleteSingleOutput(markId) {
    const mark = markings.find(m => m.id === markId);
    if (mark) {
        pushToHistory(); 
        mark.translatedText = '';
        mark.needsRetry = true;
        if (mark.overlayElement) { mark.overlayElement.remove(); mark.overlayElement = null; }
        updateOutputList();
        redrawAllMarkings(); 
        if (typeof saveStateToServer === 'function') saveStateToServer();
    }
}