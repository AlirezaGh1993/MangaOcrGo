// مدیریت نمایش متن روی تصویر (DOM Overlay) - نسخه v4 (قفل فاصله‌خط روی LINE_HEIGHT)
function createOrUpdateTextOverlay(mark) {
    const textToShow = showOriginal ? mark.originalText : mark.translatedText;
    const hasText = textToShow && textToShow.trim().length > 0;
    const bgMode = mark.bgMode || (mark.isBlurred ? 'blur' : 'none');

    if (!hasText && !mark.backgroundColor && bgMode === 'none') {
        if (mark.overlayElement) { mark.overlayElement.remove(); mark.overlayElement = null; }
        return;
    }

    const imgWrapper = images[mark.imageId].wrapper;
    let overlay = mark.overlayElement;
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'text-overlay';
        const bgLayer = document.createElement('div');
        bgLayer.className = 'overlay-bg-layer';
        const textLayer = document.createElement('div');
        textLayer.className = 'overlay-text-content';
        overlay.appendChild(bgLayer);
        overlay.appendChild(textLayer);
        imgWrapper.appendChild(overlay);
        mark.overlayElement = overlay;
    }

    const bgLayer = overlay.querySelector('.overlay-bg-layer');
    const textLayer = overlay.querySelector('.overlay-text-content');
    const fullBounds = getBoundingBox(mark);
    const safeTextBounds = calculateSafeTextBounds(mark);

    Object.assign(overlay.style, {
        position: 'absolute',
        left: `${fullBounds.x}px`,
        top: `${fullBounds.y}px`,
        width: `${fullBounds.width}px`,
        height: `${fullBounds.height}px`,
        display: (mark.imageId === activeImageIndex) ? 'block' : 'none',
        zIndex: (selectedMarking && selectedMarking.id === mark.id) ? '10' : '5'
    });

    Object.assign(bgLayer.style, {
        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%'
    });

    if (bgMode === 'cloud') {
        const { r, g, b } = hexToRgb(mark.backgroundColor || '#ffffff');
        bgLayer.style.backgroundColor = 'transparent';
        bgLayer.style.background = `radial-gradient(circle at center, rgba(${r},${g},${b},1) 0%, rgba(${r},${g},${b},1) 60%, rgba(${r},${g},${b},0.4) 100%)`;
        bgLayer.style.backdropFilter = 'none';
        bgLayer.style.webkitBackdropFilter = 'none';
    } else if (bgMode === 'blur') {
        bgLayer.style.background = 'none';
        bgLayer.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
        bgLayer.style.backdropFilter = 'blur(5px)';
        bgLayer.style.webkitBackdropFilter = 'blur(5px)';
    } else {
        bgLayer.style.background = 'none';
        bgLayer.style.backgroundColor = hasText ? (mark.backgroundColor || 'transparent') : 'transparent';
        bgLayer.style.backdropFilter = 'none';
        bgLayer.style.webkitBackdropFilter = 'none';
    }

    if (mark.type === 'ellipse') {
        bgLayer.style.clipPath = 'ellipse(50% 50% at 50% 50%)';
        bgLayer.style.borderRadius = '50%';
    } else if ((mark.type === 'polygon' || mark.type === 'freehand') && mark.points && mark.points.length > 0) {
        const polygonPath = mark.points.map(p => {
            const relX = p.x - fullBounds.x;
            const relY = p.y - fullBounds.y;
            return `${(relX / fullBounds.width) * 100}% ${((relY) / fullBounds.height) * 100}%`;
        }).join(',');
        bgLayer.style.clipPath = `polygon(${polygonPath})`;
        bgLayer.style.borderRadius = '0';
    } else {
        bgLayer.style.clipPath = 'none';
        bgLayer.style.borderRadius = '0';
    }

    // Force text box geometrically centered in the mark bounding box.
    // Manual drag offsets (textOffsetX/Y) still apply on top.
    const widthScale = mark.textWidthScale || 1.0;
    let finalSafeWidth = safeTextBounds.width * widthScale;
    let finalSafeHeight = safeTextBounds.height;
    // Clamp so scaled width cannot exceed the mark itself
    if (finalSafeWidth > fullBounds.width) finalSafeWidth = fullBounds.width;
    if (finalSafeHeight > fullBounds.height) finalSafeHeight = fullBounds.height;
    const offsetX = mark.textOffsetX || 0;
    const offsetY = mark.textOffsetY || 0;
    const centeredLeft = (fullBounds.width - finalSafeWidth) / 2;
    const centeredTop = (fullBounds.height - finalSafeHeight) / 2;

    const rtlText = isRtlScriptText(textToShow);
    Object.assign(textLayer.style, {
        position: 'absolute',
        left: `${centeredLeft + offsetX}px`,
        top: `${centeredTop + offsetY}px`,
        width: `${finalSafeWidth}px`,
        height: `${finalSafeHeight}px`,
        lineHeight: String(LINE_HEIGHT),
        transform: `rotate(${mark.rotation || 0}deg)`,
        transformOrigin: 'center center',
        color: mark.textColor || '#000000',
        fontWeight: 'normal',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxSizing: 'border-box',
        overflow: 'hidden',
        // Persian/Arabic: force RTL so glyphs join and punctuation sits correctly
        direction: rtlText ? 'rtl' : 'ltr',
        unicodeBidi: 'plaintext'
    });

    const fontIndex = mark.fontIndex !== undefined ? mark.fontIndex : 0;
    const selectedFont = getFontFamilyByIndex(fontIndex);
    textLayer.style.fontFamily = `"${selectedFont}", Tahoma, "Segoe UI", sans-serif`;
    textLayer.style.writingMode = mark.isVerticalWriting ? 'vertical-rl' : 'horizontal-tb';

    if (textToShow) {
        fitTextToBox(textLayer, textToShow, finalSafeWidth, finalSafeHeight, mark);
        const finalFontSize = parseFloat(textLayer.style.fontSize);
        if (!isNaN(finalFontSize) && finalFontSize > 0) {
            const strokeScale = mark.strokeWidthScale !== undefined ? mark.strokeWidthScale : 1.0;
            const strokePx = computeStrokePx(finalFontSize, strokeScale);
            const strokeColor = getStrokeColor(mark.textColor || '#000000');
            // Always text-shadow outline (never webkitTextStroke — breaks Persian joins)
            textLayer.style.webkitTextStroke = '0px transparent';
            textLayer.style.paintOrder = 'normal';
            textLayer.style.textShadow = strokePx > 0
                ? buildCssStrokeShadow(strokePx, strokeColor)
                : 'none';
        }
    }
}