// export_manager.js - نسخه v3 (رفع دروازه JSZip + اصلاح sort + مسیر ذخیره صحیح)

function escapeHtmlText(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function exportToTxt() {
    if (markings.length === 0) { showError("هیچ متنی برای خروجی گرفتن وجود ندارد."); return; }

    const sortedMarkings = [...markings].sort((a, b) => a.id - b.id);
    const projectName = projectNameInput.value.trim() || 'Untitled Project';
    const genreValue = genreSelect.value;

    // قالب‌های ترجمه آماده برای ارسال به مدل زبانی
    let promptTemplate;
    // Shared workflow: read all lines → map speakers/thoughts/narration → fluent Tehrani Persian
    const workflowBlock = `WORKFLOW (follow in order):
1) Read the ENTIRE numbered source block first. Do not translate yet.
2) Infer context: who is speaking, who is thinking, what is narration/SFX, and how lines connect in the conversation.
3) Then translate line by line into natural colloquial Tehrani Persian so dialogue feels fluent and dynamic (like real manga/manhwa speech), not isolated machine lines.
4) Keep every ID [001], [002], … exactly. One output line per input line.
5) No preamble, no analysis dump, no notes — only the final translated lines.`;

    if (['hentai', 'adult', 'ecchi'].includes(genreValue)) {
        promptTemplate = `You are a professional manga/manhwa localization specialist working on an adult fiction project for private archival use.

Your task is to produce natural spoken Persian as used by young people in Tehran (colloquial Tehrani / street register). Output must sound like real spoken dialogue, not formal or bookish Persian.

${workflowBlock}

Translation requirements:
- Translate every line completely. Do not skip, summarize, or leave any line blank.
- Match the source intensity and tone (rough, playful, intimate, aggressive, etc.).
- Use authentic Iranian colloquial vocabulary appropriate to adult dialogue. Prefer natural Tehrani speech over clinical or literary wording.
- Keep character voice consistent once you have identified each speaker.
- Do not add warnings, disclaimers, moral notes, asterisks, or placeholders.
- If a line is already Persian or empty, keep it under the same ID.

Output format ONLY:
[001] translated Persian text
[002] translated Persian text
...

Begin with the source block below.`;
    } else if (genreValue === 'fantasy') {
        promptTemplate = `You are a professional manga/manhwa translator specializing in fantasy and epic stories.

Translate into natural Persian with an elevated but readable tone. Keep proper names and titles consistent. Do not soften dark or violent content in the source.

${workflowBlock}

Prefer fluent narrative Persian over stiff formal style.

Output format ONLY:
[001] translated text
[002] translated text
...`;
    } else if (genreValue === 'martial') {
        promptTemplate = `You are a professional manga/manhwa translator specializing in martial-arts and action stories.

Translate into natural, slightly rough colloquial Persian. Preserve fight terms and each character's speech style. Do not soften threats or harsh dialogue.

${workflowBlock}

Prefer spoken Iranian register over formal literary Persian.

Output format ONLY:
[001] translated text
...`;
    } else {
        promptTemplate = `You are a professional manga/manhwa translator.

Translate into natural colloquial Tehrani Persian (spoken, everyday style — not formal or bookish). Preserve character voice, humor, and emotion. Do not change meaning or drop content.

${workflowBlock}

Output format ONLY:
[001] translated text
[002] translated text
...`;
    }

    let textContent = promptTemplate + '\n\n';
    textContent += '--- SOURCE TEXT ---\n\n';
    textContent += sortedMarkings.map(mark => {
        const idStr = String(mark.displayId).padStart(3, '0');
        const cleanText = (mark.originalText || '').replace(/\r?\n|\r/g, ' ').trim();
        return `[${idStr}] ${cleanText}`;
    }).join('\n');

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const fileName = (projectNameInput.value.trim().replace(/\s+/g, '_') || "manga_project") + "_translation_prompt.txt";
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

function parseAndApplyTranslation() {
    const rawText = importTextarea.value.trim();
    if (!rawText) {
        alert("لطفاً متن ترجمه شده را وارد کنید.");
        return;
    }
    let updatedCount = 0;
    const regex = /\[(\d+)\]\s*([\s\S]*?)(?=\s*\[\d+\]|$)/g;
    let match;
    while ((match = regex.exec(rawText)) !== null) {
        const displayId = parseInt(match[1], 10);
        const translatedText = match[2].trim();
        const mark = markings.find(m => m.displayId === displayId);
        if (mark) {
            mark.translatedText = translatedText;
            updatedCount++;
        }
    }
    if (updatedCount > 0) {
        importModal.classList.add('hidden');
        updateOutputList();
        redrawAllMarkings();
        alert(`${updatedCount} مورد با موفقیت ترجمه و جایگزین شد.`);
    } else {
        alert("هیچ موردی با فرمت صحیح [شماره] پیدا نشد یا فرمت ورودی مشکل دارد.");
    }
}

async function exportToHtml() {
    if (images.length === 0) { showError("هیچ تصویری برای خروجی گرفتن وجود ندارد."); return; }
    // 🔴 رفع: دروازه isJsZipLoaded حذف شد — این پرچم هرگز true نمی‌شد و خروجی HTML را برای همیشه مسدود کرده بود
    const originalBtnText = exportHtmlBtn.textContent;
    exportHtmlBtn.disabled = true;
    exportHtmlBtn.textContent = 'در حال ذخیره روی سرور...';
    const projectName = projectNameInput.value.trim().replace(/\s+/g, '_') || 'manga_project';

    try {
        let fontsCss = '';
        for (let i = 0; i < loadedFonts.length; i++) {
            if (loadedFonts[i] && loadedFontNames[i]) {
                fontsCss += `@font-face { font-family: '${loadedFontNames[i]}'; src: url('${loadedFonts[i]}'); font-weight: normal; font-style: normal; }\n`;
            }
        }

        let htmlContent = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlText(projectName)}</title>
<style>
${fontsCss}
body { margin: 0; background: #222; font-family: Tahoma, sans-serif; }
.page-container { position: relative; width: 100vw; margin: 0 auto 20px auto; display: block; }
.page-container img { width: 100%; display: block; }
.marking-bg { position: absolute; box-sizing: border-box; }
.marking-text { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center; white-space: pre-wrap; line-height: 1.4; }
</style>
</head>
<body>
`;

        for (const imgData of images) {
            const processedCanvas = document.createElement('canvas');
            processedCanvas.width = imgData.element.width;
            processedCanvas.height = imgData.element.height;
            processedCanvas.getContext('2d').drawImage(imgData.element, 0, 0);
            const dataUrl = processedCanvas.toDataURL('image/jpeg', 0.85);

            htmlContent += `<div class="page-container">\n<img src="${dataUrl}" alt="${escapeHtmlText(imgData.name)}">\n`;

            const imageMarkings = markings.filter(m => m.imageId === imgData.id && (m.originalText || m.translatedText));

            for (const mark of imageMarkings) {
                const fullBounds = getBoundingBox(mark);
                const safeTextBounds = calculateSafeTextBounds(mark);
                const containerStyle = `left: ${(fullBounds.x / imgData.element.width) * 100}%; top: ${(fullBounds.y / imgData.element.height) * 100}%; width: ${(fullBounds.width / imgData.element.width) * 100}%; height: ${(fullBounds.height / imgData.element.height) * 100}%;`;

                let clipPathStyle = '';
                if (mark.type === 'ellipse') {
                    clipPathStyle = `clip-path: ellipse(50% 50% at 50% 50%); border-radius: 50%;`;
                } else if ((mark.type === 'polygon' || mark.type === 'freehand' || mark.shapeType === 'magic-wand') && mark.points) {
                    const polygonPath = mark.points.map(p => {
                        const relX = p.x - fullBounds.x;
                        const relY = p.y - fullBounds.y;
                        return `${(relX / fullBounds.width) * 100}% ${((relY) / fullBounds.height) * 100}%`;
                    }).join(',');
                    clipPathStyle = `clip-path: polygon(${polygonPath});`;
                }

                const bgMode = mark.bgMode || (mark.isBlurred ? 'blur' : 'none');
                let bgStyle = '';
                if (bgMode === 'cloud') {
                    const { r, g, b } = hexToRgb(mark.backgroundColor || '#ffffff');
                    bgStyle = `background: radial-gradient(circle at center, rgba(${r},${g},${b},1) 0%, rgba(${r},${g},${b},1) 60%, rgba(${r},${g},${b},0.4) 100%); ${clipPathStyle}`;
                } else if (bgMode === 'blur') {
                    bgStyle = `background-color: rgba(255,255,255,0.4); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); ${clipPathStyle}`;
                } else {
                    bgStyle = `background-color: ${mark.backgroundColor || 'transparent'}; ${clipPathStyle}`;
                }

                const widthScale = mark.textWidthScale || 1.0;
                const finalSafeWidth = safeTextBounds.width * widthScale;
                const textRelX = safeTextBounds.x - fullBounds.x;
                const textRelY = safeTextBounds.y - fullBounds.y;
                const centeredLeft = textRelX - (finalSafeWidth - safeTextBounds.width) / 2;
                const textLeftPct = (centeredLeft / fullBounds.width) * 100;
                const textTopPct = (textRelY / fullBounds.height) * 100;
                const textWidthPct = (finalSafeWidth / fullBounds.width) * 100;
                const textHeightPct = (safeTextBounds.height / fullBounds.height) * 100;

                const fontIndex = mark.fontIndex !== undefined ? mark.fontIndex : 0;
                const fontFamily = loadedFontNames[fontIndex] || 'Tahoma';
                const writingMode = mark.isVerticalWriting ? 'writing-mode: vertical-rl;' : '';

                const strokeScale = mark.strokeWidthScale !== undefined ? mark.strokeWidthScale : 1.0;
                const strokeColor = getStrokeColor(mark.textColor || '#000000');
                // Approximate outline in em units (relative to font-size) via text-shadow
                let textStroke = '';
                if (strokeScale > 0) {
                    const em = Math.min(STROKE_RATIO * strokeScale, 0.22);
                    const offsets = getStrokeOffsets(1); // unit circle scaled by em below
                    textStroke = 'text-shadow: ' + offsets.map(([x, y]) => {
                        const xx = (x * em).toFixed(3);
                        const yy = (y * em).toFixed(3);
                        return `${xx}em ${yy}em 0 ${strokeColor}`;
                    }).join(', ') + '; -webkit-text-stroke: 0;';
                }

                const activeText = showOriginal ? (mark.originalText || '') : (mark.translatedText || '');
                const fontSizeVw = (mark.fontSize || 16) / imgData.element.width * 100;
                const dirStyle = isRtlScriptText(activeText) ? 'direction: rtl;' : 'direction: ltr;';

                const textStyle = `
                    left: ${textLeftPct}%; top: ${textTopPct}%; width: ${textWidthPct}%; height: ${textHeightPct}%;
                    font-family: '${fontFamily}', Tahoma; color: ${mark.textColor || '#000000'}; font-weight: normal;
                    font-size: ${fontSizeVw}vw; transform: rotate(${mark.rotation || 0}deg);
                    ${dirStyle} ${writingMode} ${textStroke}
                `;

                htmlContent += `<div class="marking-bg" style="${containerStyle} ${bgStyle}"></div>\n`;
                htmlContent += `<div class="marking-text" style="${textStyle}">${escapeHtmlText(activeText)}</div>\n`;
            }
            htmlContent += `</div>\n`;
        }
        htmlContent += `</body>\n</html>`;

        // 🔴 رفع: حذف fetch تکراری — استفاده از تابع مشترک با مسیر ذخیره صحیح
        const blob = new Blob([htmlContent], { type: 'text/html' });
        await uploadAndSaveExportFile(blob, `${projectName}.html`);
    } catch (error) {
        showError("خطا در صادر کردن فایل: " + error.message);
        console.error(error);
    } finally {
        exportHtmlBtn.disabled = false;
        exportHtmlBtn.textContent = originalBtnText;
    }
}

async function uploadAndSaveExportFile(blob, filename) {
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('filename', filename);
    try {
        const response = await fetch('/api/save-export', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (response.ok) {
            // 🔴 رفع باگ: سرور saved_path برمی‌گرداند نه path
            alert(`فایل با موفقیت در مسیر زیر روی هارد سرور ذخیره شد:\n${result.saved_path}`);
        } else {
            alert("خطا در ذخیره‌سازی فایل خروجی: " + result.error);
        }
    } catch (e) {
        console.error(e);
        alert("ارتباط با سرور جهت ذخیره خروجی برقرار نشد.");
    }
}