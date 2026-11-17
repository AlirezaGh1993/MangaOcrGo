async function exportToZip() {
    if (images.length === 0) { showError("هیچ تصویری برای خروجی گرفتن وجود ندارد."); return; }
    if (!markings.some(m => m.originalText || m.translatedText)) { showError("هیچ متنی برای جایگذاری وجود ندارد."); return; }

    const originalBtnText = exportZipBtn.textContent;
    exportZipBtn.disabled = true;
    exportZipBtn.textContent = 'در حال ساخت پکیج تصاویر...';
    const projectName = projectNameInput.value.trim().replace(/\s+/g, '_') || 'manga_project';
    const formData = new FormData();
    formData.append('filename', `${projectName}.zip`);

    const resizePctEl = document.getElementById('export-resize-percent');
    let resizePercent = 100;
    if (resizePctEl) {
        const parsed = parseInt(resizePctEl.value, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 200) resizePercent = parsed;
    }
    const scale = resizePercent / 100;

    // Output format from settings (was hard-coded JPEG — bug)
    const formatSelect = document.getElementById('export-format-select');
    const formatChoice = (formatSelect && formatSelect.value) ? formatSelect.value : 'original';

    try {
        const results = new Array(images.length);
        let doneCount = 0;
        const total = images.length;
        const WORKERS = 3;

        async function processOne(imgData, index) {
            const srcW = imgData.element.width;
            const srcH = imgData.element.height;

            const processedCanvas = document.createElement('canvas');
            const processedCtx = processedCanvas.getContext('2d');
            processedCanvas.width = srcW;
            processedCanvas.height = srcH;
            processedCtx.drawImage(imgData.element, 0, 0);

            const imageMarkings = markings.filter(m => m.imageId === imgData.id && (m.originalText || m.translatedText));

            for (const mark of imageMarkings) {
                const bounds = getBoundingBox(mark);
                if (bounds.width > 0 && bounds.height > 0) {
                    processedCtx.save();
                    processedCtx.beginPath();
                    if (mark.type === 'rect') {
                        processedCtx.rect(mark.x, mark.y, mark.width, mark.height);
                    } else if (mark.type === 'ellipse') {
                        const cx = mark.x + mark.width / 2;
                        const cy = mark.y + mark.height / 2;
                        processedCtx.ellipse(cx, cy, mark.width / 2, mark.height / 2, 0, 0, 2 * Math.PI);
                    } else {
                        if (mark.points && mark.points.length > 2) {
                            processedCtx.moveTo(mark.points[0].x, mark.points[0].y);
                            for (let i = 1; i < mark.points.length; i++) {
                                processedCtx.lineTo(mark.points[i].x, mark.points[i].y);
                            }
                            processedCtx.closePath();
                        }
                    }

                    const bgMode = mark.bgMode || (mark.isBlurred ? 'blur' : 'none');
                    if (bgMode === 'cloud') {
                        processedCtx.clip();
                        const { r, g, b } = hexToRgb(mark.backgroundColor || '#ffffff');
                        const centerX = bounds.x + bounds.width / 2;
                        const centerY = bounds.y + bounds.height / 2;
                        const radius = Math.max(bounds.width, bounds.height) / 2;
                        const grad = processedCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
                        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
                        grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 1)`);
                        grad.addColorStop(1.0, `rgba(${r}, ${g}, ${b}, 0.4)`);
                        processedCtx.fillStyle = grad;
                        processedCtx.fill();
                    } else if (bgMode === 'blur') {
                        processedCtx.clip();
                        processedCtx.filter = 'blur(5px)';
                        processedCtx.drawImage(imgData.element, 0, 0);
                        processedCtx.filter = 'none';
                        processedCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                        processedCtx.fill();
                    } else {
                        processedCtx.fillStyle = mark.backgroundColor || 'transparent';
                        processedCtx.fill();
                    }
                    processedCtx.restore();
                }
            }

            for (const mark of imageMarkings) {
                const bounds = calculateSafeTextBounds(mark);
                if (bounds.width <= 0 || bounds.height <= 0) continue;
                const widthScale = mark.textWidthScale || 1.0;
                const finalWidth = bounds.width * widthScale;
                const finalHeight = bounds.height;
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                const activeText = showOriginal ? (mark.originalText || '') : (mark.translatedText || '');
                if (!activeText) continue;

                const offsetX = mark.textOffsetX || 0;
                const offsetY = mark.textOffsetY || 0;

                processedCtx.save();
                processedCtx.translate(centerX + offsetX, centerY + offsetY);
                processedCtx.rotate((mark.rotation || 0) * Math.PI / 180);
                if (mark.isVerticalWriting) {
                    processedCtx.rotate(90 * Math.PI / 180);
                }

                const availableWidthForText = mark.isVerticalWriting ? finalHeight : finalWidth;
                const availableHeightForText = mark.isVerticalWriting ? finalWidth : finalHeight;

                const fontIndex = mark.fontIndex !== undefined ? mark.fontIndex : 0;
                const fontName = (typeof getFontFamilyByIndex === 'function')
                    ? getFontFamilyByIndex(fontIndex)
                    : (loadedFontNames[fontIndex] || 'Tahoma');
                // Same layout engine as on-screen preview
                const layout = computeTextLayout(
                    activeText,
                    availableWidthForText,
                    availableHeightForText,
                    fontName,
                    mark
                );
                const optimalFontSize = layout.size;
                const lines = layout.lines;
                const rtlExport = isRtlScriptText(activeText);
                processedCtx.font = `normal ${optimalFontSize}px "${fontName}", Tahoma, "Segoe UI", sans-serif`;
                // Canvas RTL: glyphs join + punctuation/mark order match on-screen preview
                processedCtx.direction = rtlExport ? 'rtl' : 'ltr';
                processedCtx.textAlign = 'center';
                processedCtx.textBaseline = 'middle';

                const lineHeight = optimalFontSize * LINE_HEIGHT;
                const totalTextHeight = lines.length * lineHeight;
                let startY = -totalTextHeight / 2 + lineHeight / 2;

                const strokeScale = mark.strokeWidthScale !== undefined ? mark.strokeWidthScale : 1.0;
                const strokePx = computeStrokePx(optimalFontSize, strokeScale);
                const textColor = mark.textColor || '#000000';
                const strokeColor = getStrokeColor(textColor);

                for (const line of lines) {
                    // Offset-fill outline (matches DOM; no strokeText thickness mismatch)
                    drawCanvasOutlinedText(processedCtx, line, 0, startY, strokePx, strokeColor, textColor);
                    startY += lineHeight;
                }
                processedCtx.restore();
            }

            let finalCanvas = processedCanvas;
            if (Math.abs(scale - 1) > 0.001) {
                const outW = Math.max(1, Math.round(srcW * scale));
                const outH = Math.max(1, Math.round(srcH * scale));
                finalCanvas = document.createElement('canvas');
                finalCanvas.width = outW;
                finalCanvas.height = outH;
                const fctx = finalCanvas.getContext('2d');
                fctx.imageSmoothingEnabled = true;
                fctx.imageSmoothingQuality = 'high';
                fctx.drawImage(processedCanvas, 0, 0, srcW, srcH, 0, 0, outW, outH);
            }

            const { mime, outName } = resolveExportFormat(formatChoice, imgData.name);
            const quality = (mime === 'image/png') ? undefined : 0.95;
            const imgBlob = await new Promise((resolve, reject) => {
                finalCanvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob failed for ' + outName));
                }, mime, quality);
            });
            return { index, blob: imgBlob, name: outName };
        }

        // Pool of 3 concurrent workers
        let nextIndex = 0;
        async function worker() {
            while (true) {
                const i = nextIndex++;
                if (i >= total) break;
                results[i] = await processOne(images[i], i);
                doneCount++;
                exportZipBtn.textContent = `پردازش تصویر ${doneCount}/${total}...`;
            }
        }
        const pool = [];
        for (let w = 0; w < Math.min(WORKERS, total); w++) pool.push(worker());
        await Promise.all(pool);

        for (const r of results) {
            if (r) formData.append('files', r.blob, r.name);
        }

        exportZipBtn.textContent = 'در حال ارسال به سرور...';
        const saveResponse = await fetch('/api/save-export', {
            method: 'POST',
            body: formData
        });
        const saveResult = await saveResponse.json();
        if (saveResponse.ok) {
            alert(`فایل ZIP با موفقیت ذخیره شد:\n${saveResult.saved_path}`);
        } else {
            alert("خطا در ذخیره‌سازی: " + saveResult.error);
        }
    } catch (error) {
        showError("خطا در صادر کردن پکیج: " + error.message);
        console.error(error);
    } finally {
        exportZipBtn.disabled = false;
        exportZipBtn.textContent = originalBtnText;
    }
}

/** Map UI format + source filename → MIME + output filename with correct extension */
function resolveExportFormat(choice, sourceName) {
    const base = String(sourceName || 'image').replace(/\.[^.]+$/, '') || 'image';
    const srcExt = (String(sourceName).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    let mime = 'image/jpeg';
    let ext = 'jpg';

    if (choice === 'png') {
        mime = 'image/png';
        ext = 'png';
    } else if (choice === 'webp') {
        mime = 'image/webp';
        ext = 'webp';
    } else if (choice === 'jpg' || choice === 'jpeg') {
        mime = 'image/jpeg';
        ext = 'jpg';
    } else {
        // original — keep source type when possible
        if (srcExt === 'png') { mime = 'image/png'; ext = 'png'; }
        else if (srcExt === 'webp') { mime = 'image/webp'; ext = 'webp'; }
        else if (srcExt === 'gif') { mime = 'image/png'; ext = 'png'; } // canvas cannot emit gif
        else { mime = 'image/jpeg'; ext = 'jpg'; }
    }
    return { mime, outName: base + '.' + ext };
}

function getFittingFontSize(context, text, maxWidth, maxHeight, fontName) {
    return computeTextLayout(text, maxWidth, maxHeight, fontName, null).size;
}
