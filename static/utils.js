// توابع کمکی عمومی کلاینت - نسخه v4 (افزودن ثابت LINE_HEIGHT + اصلاح wrapText)

// نسبت پایه‌ی استروک به اندازه فونت (~۴٪ — ضخامت متعادل برای مانگا)
const STROKE_RATIO = 0.04;

// 🔴 جدید (v4): ثابت مشترک فاصله‌خط بین پیش‌نمایش (DOM) و خروجی ZIP (Canvas).
// این مقدار باید همیشه با line-height در style.css (.text-overlay) یکسان بماند.
const LINE_HEIGHT = 1.4;

function getBoundingBox(pointsOrMark) {
    if (Array.isArray(pointsOrMark)) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pointsOrMark.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (pointsOrMark.type === 'rect' || pointsOrMark.type === 'rectangle' || pointsOrMark.type === 'ellipse') {
        return { x: pointsOrMark.x, y: pointsOrMark.y, width: pointsOrMark.width, height: pointsOrMark.height };
    }
    if (pointsOrMark.points) {
        return getBoundingBox(pointsOrMark.points);
    }
    return { x: 0, y: 0, width: 0, height: 0 };
}

function isRepetitiveGarbage(text) {
    if (!text || text.length < 30) return false;
    const uniqueChars = new Set(text.split(''));
    const uniqueCharRatio = uniqueChars.size / text.length;
    if (uniqueCharRatio < 0.1) return true;
    const words = text.split(/\s+/);
    if (words.length > 5) {
        const firstWord = words[0]; const secondWord = words[1];
        const repetitionCount = words.filter(w => w === firstWord || w === secondWord).length;
        if (repetitionCount / words.length > 0.7) return true;
    }
    return false;
}

function showError(message) {
    errorMessage.textContent = message;
    errorContainer.classList.remove('hidden');
}

function rgbToHex(r, g, b) {
    if (r > 255 || g > 255 || b > 255) throw "Invalid color component";
    return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function hexToRgb(hex) {
    if (!hex || hex === 'transparent') return { r: 255, g: 255, b: 255 };
    let cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split('').map(c => c + c).join('');
    }
    const num = parseInt(cleanHex, 16);
    if (isNaN(num)) return { r: 255, g: 255, b: 255 };
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

/**
 * محاسبه هوشمند رنگ استروک متضاد با رنگ متن (مشکی برای متن سفید، سفید برای متن مشکی)
 */
function getStrokeColor(textColor) {
    if (!textColor) return '#FFFFFF';
    const { r, g, b } = hexToRgb(textColor);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/** Pixel radius of the outline from font size + user scale. */
function computeStrokePx(fontSize, strokeScale) {
    const scale = (strokeScale === undefined || strokeScale === null) ? 1 : strokeScale;
    if (scale <= 0 || !fontSize) return 0;
    // Cap so ultra-high scale does not swallow the glyph
    const px = fontSize * STROKE_RATIO * scale;
    return Math.min(px, fontSize * 0.22);
}

/**
 * Offset pairs for a clean outline (works for RTL Persian without breaking joins).
 * Denser ring than 8-dir so gaps do not appear on curves.
 */
function getStrokeOffsets(radius) {
    if (radius <= 0) return [];
    const r = Math.max(0.5, radius);
    const dirs = [];
    // 12 directions around the circle
    const steps = r < 1.2 ? 8 : (r < 2.5 ? 12 : 16);
    for (let i = 0; i < steps; i++) {
        const a = (Math.PI * 2 * i) / steps;
        dirs.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    // Inner half-ring for thicker outlines → solid band
    if (r >= 1.8) {
        const r2 = r * 0.55;
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i) / 8;
            dirs.push([Math.cos(a) * r2, Math.sin(a) * r2]);
        }
    }
    return dirs;
}

/** CSS text-shadow outline (DOM preview) — same geometry as canvas offsets. */
function buildCssStrokeShadow(strokePx, strokeColor) {
    if (strokePx <= 0) return 'none';
    const offsets = getStrokeOffsets(strokePx);
    return offsets.map(([x, y]) => {
        const xx = (Math.round(x * 10) / 10);
        const yy = (Math.round(y * 10) / 10);
        return `${xx}px ${yy}px 0 ${strokeColor}`;
    }).join(', ');
}

/**
 * Draw outlined text on canvas. Uses offset-fill (not strokeText) so:
 * - Persian/Arabic letter joining stays intact
 * - Thickness matches DOM text-shadow
 * - No *2 lineWidth inflation that made export look heavier
 */
function drawCanvasOutlinedText(ctx, text, x, y, strokePx, strokeColor, fillColor) {
    if (strokePx > 0 && strokeColor) {
        const offsets = getStrokeOffsets(strokePx);
        ctx.fillStyle = strokeColor;
        for (let i = 0; i < offsets.length; i++) {
            ctx.fillText(text, x + offsets[i][0], y + offsets[i][1]);
        }
    }
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
}


/** True if text contains Arabic / Persian / Urdu letters (cursive RTL scripts). */
function isRtlScriptText(text) {
    if (!text) return false;
    // Arabic block + Persian supplements
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Shared font-size + line-break engine for PREVIEW and EXPORT.
 * One canvas measurement path → identical size and wrapping everywhere.
 * Returns { size, lines }.
 */
function computeTextLayout(text, maxWidth, maxHeight, fontName, mark) {
    const empty = { size: 8, lines: text ? [String(text)] : [''] };
    if (!text || maxWidth < 4 || maxHeight < 4) return empty;

    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const wordCount = Math.max(1, words.length);
    const aspect = maxWidth / Math.max(1, maxHeight);

    let highCap = Math.min(maxWidth, maxHeight);
    if (wordCount <= 3) {
        highCap = Math.min(maxHeight * 0.55, maxWidth * 0.35);
    } else if (wordCount <= 8) {
        highCap = Math.min(maxHeight * 0.40, maxWidth * 0.28);
    } else {
        highCap = Math.min(maxHeight * 0.28, maxWidth * 0.22);
    }
    if (aspect > 2.2 && wordCount <= 6) {
        highCap = Math.min(maxHeight * 0.70, maxWidth * 0.18);
    }
    highCap = Math.max(12, Math.min(320, Math.floor(highCap)));

    if (!computeTextLayout._ctx) {
        computeTextLayout._ctx = document.createElement('canvas').getContext('2d');
    }
    const ctx = computeTextLayout._ctx;
    const family = fontName || 'Tahoma';
    const fontStr = (size) => `normal ${size}px "${family}", Tahoma, "Segoe UI", sans-serif`;

    const rtl = isRtlScriptText(text);
    ctx.direction = rtl ? 'rtl' : 'ltr';

    const measure = (size) => {
        ctx.font = fontStr(size);
        ctx.direction = rtl ? 'rtl' : 'ltr';
        const lines = wrapText(ctx, text, maxWidth);
        const totalHeight = lines.length * size * LINE_HEIGHT;
        let maxLineWidth = 0;
        for (let i = 0; i < lines.length; i++) {
            const w = ctx.measureText(lines[i]).width;
            if (w > maxLineWidth) maxLineWidth = w;
        }
        return { lines, totalHeight, maxLineWidth, ok: totalHeight <= maxHeight + 0.5 && maxLineWidth <= maxWidth + 0.5 };
    };

    let low = 8, high = highCap, bestSize = 8, bestLines = [text];
    while (low <= high) {
        const mid = (low + high) >> 1;
        const m = measure(mid);
        if (m.ok) {
            bestSize = mid;
            bestLines = m.lines;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    const globalAdj = (typeof globalTextSizeAdjust === 'number') ? globalTextSizeAdjust : 0;
    const globalMul = 1 + (globalAdj * 0.1);
    const markMul = (mark && mark.fontSizeScale) ? mark.fontSizeScale : 1.0;
    let desired = Math.round(bestSize * markMul * globalMul);
    if (desired < 8) desired = 8;
    if (desired > bestSize) desired = bestSize;

    // Re-measure lines at final size (wrapping can change at smaller sizes)
    const final = measure(desired);
    const lines = final.ok ? final.lines : bestLines;

    if (mark) {
        mark.fontSize = desired;
        mark.layoutLines = lines.slice();
        mark.layoutBoxW = maxWidth;
        mark.layoutBoxH = maxHeight;
    }
    return { size: desired, lines };
}

/** @deprecated use computeTextLayout */
function computeOptimalFontSize(text, maxWidth, maxHeight, fontName, mark) {
    return computeTextLayout(text, maxWidth, maxHeight, fontName, mark).size;
}

function fitTextToBox(element, text, maxWidth, maxHeight, mark) {
    if (!text) {
        element.style.fontSize = '0px';
        element.textContent = '';
        return;
    }

    const fontIndex = mark && mark.fontIndex !== undefined ? mark.fontIndex : 0;
    const fontName = (typeof getFontFamilyByIndex === 'function')
        ? getFontFamilyByIndex(fontIndex)
        : ((typeof loadedFontNames !== 'undefined' && loadedFontNames[fontIndex]) || 'Tahoma');

    const layout = computeTextLayout(text, maxWidth, maxHeight, fontName, mark);

    element.style.whiteSpace = 'pre-line';
    element.style.wordBreak = 'normal';
    element.style.overflowWrap = 'normal';
    element.style.boxSizing = 'border-box';
    element.style.padding = '0';
    element.style.margin = '0';
    element.style.fontSize = layout.size + 'px';
    // Force the SAME line breaks as ZIP export (do not let the browser re-wrap)
    element.textContent = layout.lines.join('\n');
}

function wrapText(context, text, maxWidth) {
    if (!text) return [];
    // Split on whitespace; further split tokens that alone exceed maxWidth
    const rawWords = text.split(/\s+/).filter(Boolean);
    const words = [];
    for (const word of rawWords) {
        if (context.measureText(word).width <= maxWidth) {
            words.push(word);
            continue;
        }
        // hard-break long glued OCR tokens
        let chunk = '';
        for (const ch of word) {
            const test = chunk + ch;
            if (chunk && context.measureText(test).width > maxWidth) {
                words.push(chunk);
                chunk = ch;
            } else {
                chunk = test;
            }
        }
        if (chunk) words.push(chunk);
    }
    if (words.length === 0) return [''];
    const lines = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + ' ' + word;
        if (context.measureText(testLine).width > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    return lines;
}

async function getMarkedImageData(mark) {
    const imgData = images[mark.imageId];
    const bounds = getBoundingBox(mark);
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const maxDimension = 300;
    let targetWidth = bounds.width;
    let targetHeight = bounds.height;
    if (bounds.width > maxDimension || bounds.height > maxDimension) {
        if (bounds.width > bounds.height) {
            targetWidth = maxDimension;
            targetHeight = Math.round((bounds.height / bounds.width) * maxDimension);
        } else {
            targetHeight = maxDimension;
            targetWidth = Math.round((bounds.width / bounds.height) * maxDimension);
        }
    }
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;
    tempCtx.drawImage(
        imgData.element,
        bounds.x, bounds.y, bounds.width, bounds.height,
        0, 0, targetWidth, targetHeight
    );
    return tempCanvas.toDataURL('image/jpeg', 0.85);
}

function deepCloneMarkings(markingsArray) {
    return markingsArray.map(m => {
        try {
            const { overlayElement, deleteHandle, ...rest } = m;
            return JSON.parse(JSON.stringify(rest));
        } catch (e) {
            // fallback shallow copy without DOM refs
            const copy = {};
            for (const k of Object.keys(m)) {
                if (k === 'overlayElement' || k === 'deleteHandle') continue;
                try { copy[k] = JSON.parse(JSON.stringify(m[k])); } catch(_) { copy[k] = m[k]; }
            }
            return copy;
        }
    });
}

function pushToHistory() {
    if (isDraggingMarking || isResizingMarking) return;
    try {
        const snapshot = {
            markings: deepCloneMarkings(markings),
            lastProcessedMarkingIndex: lastProcessedMarkingIndex,
            nextMarkingId: nextMarkingId,
            selectedMarkingId: selectedMarking ? selectedMarking.id : null
        };
        historyStack.push(snapshot);
        if (historyStack.length > maxHistory) historyStack.shift();
    } catch (e) {
        console.error('pushToHistory:', e);
    }
    if (typeof saveStateToServer === 'function') {
        saveStateToServer();
    }
}

function undo() {
    if (historyStack.length === 0) return;
    const snapshot = historyStack.pop();
    markings = snapshot.markings.map(m => ({ ...m, overlayElement: null, deleteHandle: undefined }));
    lastProcessedMarkingIndex = snapshot.lastProcessedMarkingIndex;
    nextMarkingId = snapshot.nextMarkingId;
    selectedMarking = snapshot.selectedMarkingId ? markings.find(m => m.id === snapshot.selectedMarkingId) || null : null;
    updateMarkingNumbers();
    redrawAllMarkings();
    updateOutputList();
    deactivateRotationTimer();
}

function calculateSafeTextBounds(mark) {
    // Usable text region: almost the full mark, centered, small margin from border.
    const bb = getBoundingBox(mark);
    if (!bb || bb.width <= 0 || bb.height <= 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    let scale = 0.90;
    if (mark.type === 'ellipse') {
        scale = 0.82;
    } else if (mark.type === 'rect' || mark.type === 'rectangle') {
        scale = 0.92;
    } else if (mark.points && mark.points.length >= 3) {
        scale = (mark.shapeType === 'magic-wand') ? 0.84 : 0.88;
    }

    const w = Math.max(8, bb.width * scale);
    const h = Math.max(8, bb.height * scale);
    return {
        x: Math.round(bb.x + (bb.width - w) / 2),
        y: Math.round(bb.y + (bb.height - h) / 2),
        width: Math.round(w),
        height: Math.round(h)
    };
}

function setTheme(newTheme) {
    theme = newTheme;
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
    }
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = theme;
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    fetch('/api/config')
        .then(r => r.json())
        .then(config => {
            if (config.theme && config.theme !== theme) {
                setTheme(config.theme);
            }
        })
        .catch(() => {});
}