// tools_magic_wand.js - نسخه متصل به پردازشگر برداری بومی پایتون (بسیار سریع و بدون کرش کلاینت)

function startMagicWandTimer(e, mouseX, mouseY) {
    if (currentTool !== 'magic-wand' || e.button !== 0) return;
    isDrawing = false; 
    
    // تشخیص اینکه آیا کلید Shift نگه داشته شده است یا خیر (Smart Hole Filling)
    const isSmartMode = e.shiftKey;
    
    const btn = document.querySelector('.tool-btn[data-tool="magic-wand"]');
    btn.classList.add('holding');

    const holdMs = Math.max(100, Math.min(1000, magicWandHoldMs || 500));
    magicWandTimer = setTimeout(() => {
        performMagicWandSelection(mouseX, mouseY, isSmartMode);
        cancelMagicWandTimer();
    }, holdMs);
}

function cancelMagicWandTimer() {
    if (magicWandTimer) {
        clearTimeout(magicWandTimer);
        magicWandTimer = null;
    }
    const btn = document.querySelector('.tool-btn[data-tool="magic-wand"]');
    if (btn) btn.classList.remove('holding');
}

/**
 * اجرای عملیات و ردیابی جادویی بر لایه دیسک سرور با پایتون
 */
async function performMagicWandSelection(startX, startY, isSmartMode) {
    if (activeImageIndex === -1 || !currentProjectId) return;
    
    const imgDataObj = images[activeImageIndex];
    magicWandLoading.classList.remove('hidden');

    try {
        const response = await fetch('/api/tools/magic-wand', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                project_id: currentProjectId,
                image_name: imgDataObj.name,
                x: Math.floor(startX),
                y: Math.floor(startY),
                tolerance: magicWandTolerance,
                blur: magicWandBlur,
                edge_sensitivity: magicWandEdgeSensitivity,
                smart_mode: isSmartMode
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "خطا در پردازش عصای جادویی");

        if (!result.points || result.points.length < 3) {
            throw new Error("ناحیه انتخاب‌شده بسیار کوچک است یا لایه‌ای یافت نشد.");
        }

        // ساخت چندضلعی منظم بر مبنای آرایه برداری ارسالی از سمت مفسر پایتون
        const newMark = {
            id: nextMarkingId++,
            type: 'polygon',
            points: result.points,
            imageId: activeImageIndex,
            fontSizeScale: 1.0,
            textWidthScale: 1.0,
            strokeWidthScale: defaultStrokeScale,
            isVerticalWriting: false,
            fontIndex: 0,
            shapeType: 'magic-wand'
        };

        finalizeMarkingCreation(newMark);

    } catch (err) {
        console.error(err);
        showError("خطا در انتخاب هوشمند: " + (err.message || err));
    } finally {
        magicWandLoading.classList.add('hidden');
        redrawAllMarkings();
    }
}