// drawing_canvas.js - نسخه مجهز به سیستم پردازش متمرکز چندضلعی‌ها بر روی وب‌سرویس پایتون

function selectTool(e) { 
    const btn = e.currentTarget; // استفاده از currentTarget جهت جلوگیری از بروز باگ کلیک روی اموجی
    toolBtns.forEach(b => b.classList.remove('active')); 
    btn.classList.add('active'); 
    currentTool = btn.dataset.tool; 
    currentPolygonPoints = [];
    selectedMarking = null; 
    highlightSidebarItem(null); 
    redrawAllMarkings(); 
}

function getMousePos(e) {
    const wrapperRect = imageContainerWrapper.getBoundingClientRect();
    const mouseX = e.clientX - wrapperRect.left;
    const mouseY = e.clientY - wrapperRect.top;
    const x = (mouseX - viewPosX) / zoomLevel;
    const y = (mouseY - viewPosY) / zoomLevel;
    return { x, y };
}

function startAction(e) {
    deactivateRotationTimer();

    if (e.button === 2 || e.ctrlKey || isSpacePressed) {
        isPanning = true;
        imageContainer.classList.add('panning');
        panStartX = e.clientX; panStartY = e.clientY;
        e.preventDefault(); return;
    }
    if (e.button !== 0 || activeImageIndex === -1) return;
    
    const { x, y } = getMousePos(e);

    // بررسی کلیک روی ضربدر قرمز (حذف)
    for (let i = markings.length - 1; i >= 0; i--) {
        const mark = markings[i];
        if (mark.imageId !== activeImageIndex) continue;
        if (isPointInDeleteHandle(x, y, mark)) { deleteMarking(mark.id); return; }
    }

    if (currentTool === 'magic-wand') return;

    if (isPickingColorForId !== null) {
        pickColorFromImage(x, y, isPickingColorForId);
        return;
    }

    if (currentTool === 'edit') {
        if (selectedMarking && (selectedMarking.type === 'rect' || selectedMarking.type === 'ellipse')) {
            const handle = getResizeHandleUnderMouse(x, y, selectedMarking);
            if (handle !== -1) {
                isResizingMarking = true;
                resizeHandleIndex = handle;
                resizeStartBounds = { 
                    x: selectedMarking.x, 
                    y: selectedMarking.y, 
                    width: selectedMarking.width, 
                    height: selectedMarking.height 
                };
                dragOffsetX = x; dragOffsetY = y;
                return;
            }
        }

        for (let i = markings.length - 1; i >= 0; i--) {
            const mark = markings[i];
            if (mark.imageId !== activeImageIndex) continue;
            
            if (isPointInMark(x, y, mark)) {
                selectedMarking = mark;
                isDraggingMarking = true;
                dragOffsetX = x; 
                dragOffsetY = y;
                highlightSidebarItem(mark.id);
                redrawAllMarkings();
                return;
            }
        }
        
        if (selectedMarking) {
            selectedMarking = null;
            highlightSidebarItem(null);
            redrawAllMarkings();
        }
        return;
    }

    isDrawing = true;
    startX = x; startY = y;
    if (currentTool === 'polygon') { currentPolygonPoints.push({ x, y }); drawPolygonInProgress(); }
}

function duringAction(e) {
    if (isPanning) {
        viewPosX += e.clientX - panStartX; viewPosY += e.clientY - panStartY;
        panStartX = e.clientX; panStartY = e.clientY;
        updateTransform(); return;
    }

    if (magicWandTimer && Math.hypot(e.movementX, e.movementY) > 5) {
        cancelMagicWandTimer();
    }
    
    const { x: currentX, y: currentY } = getMousePos(e);

    if (currentTool === 'edit') {
        if (isResizingMarking && selectedMarking) {
            const dx = currentX - dragOffsetX;
            const dy = currentY - dragOffsetY;
            const s = resizeStartBounds;
            
            if (resizeHandleIndex === 0) { // TL
                selectedMarking.x = s.x + dx; selectedMarking.y = s.y + dy;
                selectedMarking.width = s.width - dx; selectedMarking.height = s.height - dy;
            } else if (resizeHandleIndex === 1) { // TR
                selectedMarking.y = s.y + dy;
                selectedMarking.width = s.width + dx; selectedMarking.height = s.height - dy;
            } else if (resizeHandleIndex === 2) { // BR
                selectedMarking.width = s.width + dx; selectedMarking.height = s.height + dy;
            } else if (resizeHandleIndex === 3) { // BL
                selectedMarking.x = s.x + dx;
                selectedMarking.width = s.width - dx; selectedMarking.height = s.height + dy;
            }
            if(selectedMarking.width < 0) { selectedMarking.x += selectedMarking.width; selectedMarking.width *= -1; }
            if(selectedMarking.height < 0) { selectedMarking.y += selectedMarking.height; selectedMarking.height *= -1; }
            
            createOrUpdateTextOverlay(selectedMarking);
            redrawAllMarkings();
            return;
        }

        if (isDraggingMarking && selectedMarking) {
            const dx = currentX - dragOffsetX;
            const dy = currentY - dragOffsetY;
            
            if (e.altKey) {
                selectedMarking.textOffsetX = (selectedMarking.textOffsetX || 0) + dx;
                selectedMarking.textOffsetY = (selectedMarking.textOffsetY || 0) + dy;
            } else {
                if (selectedMarking.type === 'rect' || selectedMarking.type === 'ellipse') {
                    selectedMarking.x += dx;
                    selectedMarking.y += dy;
                } else {
                    selectedMarking.points.forEach(p => { p.x += dx; p.y += dy; });
                }
            }
            
            dragOffsetX = currentX;
            dragOffsetY = currentY;
            createOrUpdateTextOverlay(selectedMarking);
            redrawAllMarkings();
            return;
        }
        return;
    }

    if (!isDrawing || activeImageIndex === -1) return;
    
    redrawAllMarkings();
    const ctx = images[activeImageIndex].context;
    ctx.strokeStyle = 'red'; ctx.lineWidth = 2 / zoomLevel;
    
    if (currentTool === 'rect') {
        ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
    } else if (currentTool === 'ellipse') {
        ctx.beginPath();
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);
        const cx = Math.min(startX, currentX) + w/2;
        const cy = Math.min(startY, currentY) + h/2;
        ctx.ellipse(cx, cy, w/2, h/2, 0, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (currentTool === 'freehand') {
        let tempMark = markings.find(m => m.temp);
        if (!tempMark) { 
            tempMark = { type: 'freehand', points: [{ x: startX, y: startY }], temp: true, imageId: activeImageIndex }; 
            markings.push(tempMark); 
        }
        tempMark.points.push({ x: currentX, y: currentY });
        drawFreehand(ctx, tempMark.points);
    } else if (currentTool === 'polygon') {
        drawPolygonInProgress(getMousePos(e));
    }
}

function endAction(e) {
    if (isPanning) { isPanning = false; imageContainer.classList.remove('panning'); return; }
    
    if (currentTool === 'magic-wand') {
        cancelMagicWandTimer();
        return;
    }
    
    if (currentTool === 'edit') {
        isDraggingMarking = false;
        isResizingMarking = false;
        resizeHandleIndex = -1;
        if(selectedMarking) {
             createOrUpdateTextOverlay(selectedMarking);
        }
        pushToHistory(); 
        return;
    }

    if (!isDrawing || e.button !== 0) return;
    if (currentTool !== 'polygon') isDrawing = false;
    
    const { x: endX, y: endY } = getMousePos(e);
    if (Math.hypot(startX - endX, startY - endY) < 5 && currentTool !== 'polygon') {
        const tempIndex = markings.findIndex(m => m.temp);
        if (tempIndex > -1) markings.splice(tempIndex, 1);
        redrawAllMarkings(); return;
    }
    
    let newMark;
    const width = Math.abs(startX - endX);
    const height = Math.abs(startY - endY);
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);

    if (currentTool === 'rect') {
        newMark = { type: 'rect', x, y, width, height };
    } else if (currentTool === 'ellipse') {
        newMark = { type: 'ellipse', x, y, width, height };
    } else if (currentTool === 'freehand') {
        const tempMarkIndex = markings.findIndex(m => m.temp);
        if (tempMarkIndex > -1) { 
            newMark = { type: 'freehand', points: markings[tempMarkIndex].points }; 
            markings.splice(tempMarkIndex, 1); 
        }
    }
    
    if (newMark) { 
        newMark.id = nextMarkingId++; 
        newMark.imageId = activeImageIndex; 
        newMark.fontSizeScale = 1.0;
        newMark.textWidthScale = 1.0; 
        newMark.strokeWidthScale = defaultStrokeScale; 
        newMark.isVerticalWriting = false;
        newMark.fontIndex = 0;
        
        finalizeMarkingCreation(newMark);
    }
    redrawAllMarkings();
}

/**
 * متد سیستمی ثبت نهایی و کامیت کردن حباب ترسیم شده به آرایه اصلی علامت‌گذاری‌ها
 */
async function finalizeMarkingCreation(newMark) {
    // مقادیر پیش‌فرض
    if (!newMark.textColor) newMark.textColor = '#000000';
    if (!newMark.backgroundColor) newMark.backgroundColor = 'transparent';
    if (newMark.textOffsetX === undefined) newMark.textOffsetX = 0;
    if (newMark.textOffsetY === undefined) newMark.textOffsetY = 0;
    if (newMark.originalText === undefined) newMark.originalText = '';
    if (newMark.translatedText === undefined) newMark.translatedText = '';
    if (newMark.imageId === undefined || newMark.imageId === null) {
        newMark.imageId = activeImageIndex;
    }
    if (images[newMark.imageId]) {
        newMark.imageName = images[newMark.imageId].name;
    } else if (images[activeImageIndex]) {
        newMark.imageId = activeImageIndex;
        newMark.imageName = images[activeImageIndex].name;
    }

    // جلوگیری از id تکراری
    if (!newMark.id) newMark.id = nextMarkingId++;
    if (typeof nextMarkingId === 'number' && newMark.id >= nextMarkingId) {
        nextMarkingId = newMark.id + 1;
    }

    // ۱) افزودن به آرایه + نمایش فوری در سایدبار متن‌ها (قبل از هر await)
    if (!markings.find(m => m.id === newMark.id)) {
        markings.push(newMark);
    }
    markings.forEach((m, i) => { m.displayId = i + 1; });
    // شماره recap بر اساس ترتیب id
    [...markings].sort((a, b) => a.id - b.id).forEach((m, i) => { m.displayId = i + 1; });

    selectedMarking = newMark;
    // Re-resolve DOM nodes (WebView/desktop may have rebuilt layout)
    if (typeof outputList === 'undefined' || !outputList) {
        try { outputList = document.getElementById('output-list'); } catch (_) {}
    }
    if (typeof updateOutputList === 'function') {
        try { updateOutputList(); } catch (e) { console.error('updateOutputList', e); }
    }
    if (typeof highlightSidebarItem === 'function') highlightSidebarItem(newMark.id);
    if (typeof redrawAllMarkings === 'function') redrawAllMarkings();
    if (typeof updateButtonStates === 'function') updateButtonStates();

    // ۲) پردازش رنگ/مرز روی سرور Go (غیرمسدودکننده برای UI)
    if (currentProjectId && newMark.imageName) {
        try {
            const response = await fetch('/api/tools/process-marking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: currentProjectId,
                    image_name: newMark.imageName,
                    mark: {
                        type: newMark.type,
                        x: newMark.x, y: newMark.y,
                        width: newMark.width, height: newMark.height,
                        points: newMark.points,
                        shapeType: newMark.shapeType
                    }
                })
            });
            if (response.ok) {
                const result = await response.json();
                if (result.backgroundColor) newMark.backgroundColor = result.backgroundColor;
                if (result.textColor) newMark.textColor = result.textColor;
                if (result.safeBounds) newMark.safeBounds = result.safeBounds;
                if (result.points && result.points.length > 0) {
                    newMark.points = result.points;
                    if (newMark.type === 'freehand') newMark.type = 'polygon';
                }
                if (typeof redrawAllMarkings === 'function') redrawAllMarkings();
                if (typeof updateOutputList === 'function') updateOutputList();
            }
        } catch (e) {
            console.error('process-marking:', e);
        }
    }

    // ۳) ذخیره فوری
    if (typeof pushToHistory === 'function') pushToHistory();
    if (typeof saveStateToServer === 'function') {
        try { await saveStateToServer(true); } catch (e) { console.error(e); }
    }
    if (typeof activateRotationTimer === 'function') activateRotationTimer();
}

function endPolygon() {
    if (currentTool === 'polygon' && currentPolygonPoints.length > 2) {
        const newMark = { 
            id: nextMarkingId++, 
            type: 'polygon', 
            points: [...currentPolygonPoints], 
            imageId: activeImageIndex, 
            fontSizeScale: 1.0, 
            textWidthScale: 1.0, 
            strokeWidthScale: defaultStrokeScale,
            isVerticalWriting: false,
            fontIndex: 0
        };
        finalizeMarkingCreation(newMark);
        currentPolygonPoints = [];
        redrawAllMarkings();
    }
}

function redrawAllMarkings() {
    if (activeImageIndex === -1 || !images[activeImageIndex]) return;
    const imgData = images[activeImageIndex];
    const ctx = imgData.context;
    ctx.clearRect(0, 0, imgData.canvas.width, imgData.canvas.height);

    // Match by image id OR active index (WebView / reload edge cases)
    const belongs = (m) => m && (m.imageId === imgData.id || m.imageId === activeImageIndex);

    markings.filter(belongs).forEach(mark => drawMarking(ctx, mark));

    if (currentTool === 'edit' && selectedMarking && belongs(selectedMarking)) {
        drawSelectionHandles(ctx, selectedMarking);
    }

    if (currentTool === 'polygon') drawPolygonInProgress();
    markings.filter(belongs).forEach(mark => {
        if (typeof createOrUpdateTextOverlay === 'function') createOrUpdateTextOverlay(mark);
    });
}

function drawMarking(ctx, mark) {
    if (selectedMarking && selectedMarking.id === mark.id) {
        ctx.strokeStyle = '#007bff'; ctx.fillStyle = '#007bff';
    } else {
        ctx.strokeStyle = '#ff0000'; ctx.fillStyle = '#ff0000';
    }
    
    ctx.lineWidth = 2 / zoomLevel;
    ctx.font = `${16 / zoomLevel}px Arial`;
    
    let bounds;
    
    if (mark.type === 'rect') {
        ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
        bounds = mark;
    } else if (mark.type === 'ellipse') {
        ctx.beginPath();
        const cx = mark.x + mark.width/2;
        const cy = mark.y + mark.height/2;
        ctx.ellipse(cx, cy, mark.width/2, mark.height/2, 0, 0, 2 * Math.PI);
        ctx.stroke();
        bounds = mark;
    } else {
        ctx.beginPath(); 
        ctx.moveTo(mark.points[0].x, mark.points[0].y);
        for (let i = 1; i < mark.points.length; i++) ctx.lineTo(mark.points[i].x, mark.points[i].y);
        if (mark.type === 'polygon') ctx.closePath(); 
        ctx.stroke(); 
        bounds = getBoundingBox(mark.points);
    }
    
    const labelY = bounds.y - (5 / zoomLevel);

    // ۱. سر اول (سمت چپ): چاپ شماره علامت‌گذاری
    ctx.textAlign = 'left';
    if (mark.displayId !== undefined) {
        ctx.fillText(String(mark.displayId), bounds.x, labelY);
    }

    // ۲. وسط (مرکز): چاپ پویای نام فونت استفاده شده (به استثنای فونت پیش‌فرض ۰)
    ctx.textAlign = 'center';
    const idx = mark.fontIndex !== undefined ? mark.fontIndex : 0;
    if (idx > 0) {
        const customName = (typeof fontCustomNames !== 'undefined' && fontCustomNames[idx]) ? fontCustomNames[idx].trim() : '';
        const fontLabel = customName ? customName : `T${idx}`;
        ctx.fillText(fontLabel, bounds.x + bounds.width / 2, labelY);
    }

    // ۳. سر آخر (سمت راست): چاپ آیکون حذف (❌)
    ctx.textAlign = 'right';
    ctx.fillText('❌', bounds.x + bounds.width, labelY);
    
    // تنظیم دقیق محدوده کلیک دکمه حذف متناسب با همترازی راست‌چین جدید آیکون ضربدر
    mark.deleteHandle = { 
        x: bounds.x + bounds.width - (20 / zoomLevel), 
        y: labelY - (15 / zoomLevel), 
        width: 25 / zoomLevel, 
        height: 25 / zoomLevel 
    };

    if (selectedMarking && selectedMarking.id === mark.id) {
        ctx.save();
        ctx.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        ctx.rotate((mark.rotation || 0) * Math.PI / 180);
        ctx.strokeStyle = '#007bff';
        ctx.setLineDash([5 / zoomLevel, 3 / zoomLevel]);
        ctx.beginPath();
        ctx.moveTo(-bounds.width / 2, 0);
        ctx.lineTo(bounds.width / 2, 0);
        ctx.stroke();
        ctx.restore();
    }
}

function drawSelectionHandles(ctx, mark) {
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2 / zoomLevel;
    ctx.fillStyle = '#007bff';
    const size = 8 / zoomLevel;
    
    if (mark.type === 'rect' || mark.type === 'ellipse') {
        if(mark.type === 'rect') ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
        
        ctx.fillRect(mark.x - size/2, mark.y - size/2, size, size);
        ctx.fillRect(mark.x + mark.width - size/2, mark.y - size/2, size, size);
        ctx.fillRect(mark.x + mark.width - size/2, mark.y + mark.height - size/2, size, size);
        ctx.fillRect(mark.x - size/2, mark.y + mark.height - size/2, size, size);
    } else {
        const bb = getBoundingBox(mark.points);
        ctx.strokeRect(bb.x, bb.y, bb.width, bb.height);
    }
}

function getResizeHandleUnderMouse(x, y, mark) {
    if (mark.type !== 'rect' && mark.type !== 'ellipse') return -1;
    const size = 10 / zoomLevel;
    if (Math.abs(x - mark.x) < size && Math.abs(y - mark.y) < size) return 0;
    if (Math.abs(x - (mark.x + mark.width)) < size && Math.abs(y - mark.y) < size) return 1;
    if (Math.abs(x - (mark.x + mark.width)) < size && Math.abs(y - (mark.y + mark.height)) < size) return 2;
    if (Math.abs(x - mark.x) < size && Math.abs(y - (mark.y + mark.height)) < size) return 3;
    return -1;
}

function pickColorFromImage(x, y, markId) {
    if (activeImageIndex === -1) return;
    const imgData = images[activeImageIndex];
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 1; tempCanvas.height = 1;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(imgData.element, x, y, 1, 1, 0, 0, 1, 1);
    const p = tempCtx.getImageData(0, 0, 1, 1).data;
    const hex = "#" + ("000000" + rgbToHex(p[0], p[1], p[2])).slice(-6);
    
    const mark = markings.find(m => m.id === markId);
    if (mark) {
        mark.backgroundColor = hex;
        createOrUpdateTextOverlay(mark);
        updateOutputList();
    }
    
    isPickingColorForId = null;
    imageContainerWrapper.style.cursor = 'default';
}

function drawFreehand(ctx, points) {
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
}

function drawPolygonInProgress(mousePos) {
    if (currentPolygonPoints.length === 0 || activeImageIndex === -1) return;
    const ctx = images[activeImageIndex].context;
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2 / zoomLevel;
    ctx.beginPath();
    currentPolygonPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    if (mousePos && currentPolygonPoints.length > 0) {
        const lastPoint = currentPolygonPoints[currentPolygonPoints.length - 1];
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = '#007bffaa';
        ctx.stroke();
    }
}

function deleteMarking(id) {
    const index = markings.findIndex(m => m.id === id);
    if (index > -1) {
        const mark = markings[index];
        if (mark.overlayElement) mark.overlayElement.remove();
        markings.splice(index, 1);
        
        if (selectedMarking && selectedMarking.id === id) {
            selectedMarking = null;
            highlightSidebarItem(null);
        }
        
        updateMarkingNumbers();
        redrawAllMarkings();
        updateOutputList();
        pushToHistory(); 
    }
}

function isPointInDeleteHandle(x, y, mark) {
    if (!mark.deleteHandle) return false;
    const h = mark.deleteHandle;
    return x >= h.x && x <= h.x + h.width && y >= h.y && y <= h.y + h.height;
}

function isPointInMark(x, y, mark) {
    if (mark.type === 'rect') {
        return (x >= mark.x && x <= mark.x + mark.width && y >= mark.y && y <= mark.y + mark.height);
    } else if (mark.type === 'ellipse') {
        const cx = mark.x + mark.width/2;
        const cy = mark.y + mark.height/2;
        const rx = mark.width/2;
        const ry = mark.height/2;
        return (Math.pow(x - cx, 2) / Math.pow(rx, 2) + Math.pow(y - cy, 2) / Math.pow(ry, 2)) <= 1;
    } else {
        const bb = getBoundingBox(mark.points);
        return (x >= bb.x && x <= bb.x + bb.width && y >= bb.y && y <= bb.y + bb.height);
    }
}

function reorderMarkingIds() {
    markings.sort((a, b) => a.id - b.id);
    markings.forEach((mark, index) => { mark.displayId = index + 1; });
    updateOutputList();
}