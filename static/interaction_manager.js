// مدیریت تعاملات کاربر (تایمرها، میانبرها)

function activateRotationTimer() {
    if (!selectedMarking) return;
    
    isRotationActive = true;
    rotationTimeRemaining = 3000;
    
    rotationHint.classList.remove('hidden');
    rotationProgress.style.width = '100%';
    
    if (rotationTimer) clearInterval(rotationTimer);
    
    const startTime = Date.now();
    
    rotationTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = 3000 - elapsed;
        
        if (remaining <= 0) {
            deactivateRotationTimer();
        } else {
            const percent = (remaining / 3000) * 100;
            rotationProgress.style.width = `${percent}%`;
        }
    }, 50);
}

function deactivateRotationTimer() {
    isRotationActive = false;
    rotationHint.classList.add('hidden');
    if (rotationTimer) {
        clearInterval(rotationTimer);
        rotationTimer = null;
    }
}

document.addEventListener('keydown', (e) => {
    // اگر کاربر در حال تایپ در اینپوت‌ها است، میانبرها را نادیده بگیر
    if (e.target.matches('input, textarea, select')) return;

    // --- میانبرهای عمومی ---
    if (e.code === 'Space' && !e.repeat) {
        isSpacePressed = true;
        imageContainerWrapper.style.cursor = 'grab';
    }

    if (e.ctrlKey && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'ظ')) { 
        e.preventDefault(); 
        undo(); 
    }
    
    if (e.key === 'ArrowUp') { e.preventDefault(); navigateImages(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateImages(1); }
    if (e.key === 'Tab') { e.preventDefault(); toggleOriginalText(); }
    
    if (e.key === 'Escape') { 
        deactivateRotationTimer(); 
        isPickingColorForId = null; 
        document.getElementById('image-container-wrapper').style.cursor = 'default';
        if (currentTool === 'polygon') {
            currentPolygonPoints = [];
            redrawAllMarkings();
        }
    }

    // --- میانبرهای مربوط به ویرایش علامت‌گذاری انتخاب شده ---
    if (selectedMarking) {
        let needsUpdate = false;

        if (e.key === '1' || e.code === 'Numpad1') { 
            selectedMarking.fontIndex = (selectedMarking.fontIndex === 1) ? 0 : 1; 
            needsUpdate = true; 
        }
        else if (e.key === '2' || e.code === 'Numpad2') { 
            selectedMarking.fontIndex = (selectedMarking.fontIndex === 2) ? 0 : 2; 
            needsUpdate = true; 
        }
        else if (e.key === '3' || e.code === 'Numpad3') { 
            selectedMarking.fontIndex = (selectedMarking.fontIndex === 3) ? 0 : 3; 
            needsUpdate = true; 
        }
        else if (e.key === '4' || e.code === 'Numpad4') { 
            selectedMarking.fontIndex = (selectedMarking.fontIndex === 4) ? 0 : 4; 
            needsUpdate = true; 
        }
        else if (e.key === '5' || e.code === 'Numpad5') { 
            selectedMarking.fontIndex = (selectedMarking.fontIndex === 5) ? 0 : 5; 
            needsUpdate = true; 
        }

        // 2. بزرگ و کوچک کردن فونت (W / S)
        if (e.code === 'KeyW') { 
            selectedMarking.fontSizeScale = (selectedMarking.fontSizeScale || 1.0) + 0.1; 
            needsUpdate = true; 
        }
        if (e.code === 'KeyS') {
            selectedMarking.fontSizeScale = (selectedMarking.fontSizeScale || 1.0) - 0.1;
            if (selectedMarking.fontSizeScale < 0.1) selectedMarking.fontSizeScale = 0.1;
            needsUpdate = true;
        }

        // 3. تغییر عرض محدوده متن (A)
        if (e.code === 'KeyA') {
            if (!selectedMarking.textWidthScale || selectedMarking.textWidthScale === 1.0) selectedMarking.textWidthScale = 1.5;
            else if (selectedMarking.textWidthScale === 1.5) selectedMarking.textWidthScale = 2.0;
            else if (selectedMarking.textWidthScale === 2.0) selectedMarking.textWidthScale = 3.0;
            else selectedMarking.textWidthScale = 1.0;
            needsUpdate = true;
        }

        // 4. تغییر حالت پس‌زمینه (D) - چرخه ۳‌تایی: عادی ➔ تار (💧) ➔ ابری (☁️) ➔ عادی
        if (e.code === 'KeyD') { 
            let currentMode = selectedMarking.bgMode || (selectedMarking.isBlurred ? 'blur' : 'none');
            if (currentMode === 'none') currentMode = 'blur';
            else if (currentMode === 'blur') currentMode = 'cloud';
            else currentMode = 'none';

            selectedMarking.bgMode = currentMode;
            selectedMarking.isBlurred = (currentMode === 'blur');
            needsUpdate = true; 
        }

        // 5. تغییر استروک (E)
        if (e.code === 'KeyE') {
            const currentStroke = selectedMarking.strokeWidthScale !== undefined ? selectedMarking.strokeWidthScale : defaultStrokeScale;
            let newVal = currentStroke + strokeStep;
            if (newVal > MAX_STROKE) newVal = defaultStrokeScale;
            selectedMarking.strokeWidthScale = newVal;
            needsUpdate = true;
        }
        
        // 6. چرخش متن (جهت‌نما چپ/راست)
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (currentTool === 'edit' || isRotationActive) {
                e.preventDefault();
                activateRotationTimer(); 
                
                const delta = e.key === 'ArrowRight' ? 1 : -1;
                const speed = e.shiftKey ? 1 : 5; 
                
                selectedMarking.rotation = (selectedMarking.rotation || 0) + (delta * speed);
                
                if (selectedMarking.rotation > 180) selectedMarking.rotation -= 360;
                if (selectedMarking.rotation < -180) selectedMarking.rotation += 360;
                
                redrawAllMarkings(); 
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            e.preventDefault(); 
            createOrUpdateTextOverlay(selectedMarking);
            updateOutputList(); 
        }
    }
});

imageContainerWrapper.addEventListener('mousedown', (e) => {
    if (currentTool === 'magic-wand') {
        const pos = getMousePos(e);
        startMagicWandTimer(e, pos.x, pos.y);
    }
});