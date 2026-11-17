// api.js - نسخه v1 (رفع باگ‌های بحرانی: تابع رنگ غالب، Regexها، کلیدهای API)

/**
 * معکوس‌سازی (Invert) یک تصویر base64
 */
async function invertImage(base64Data) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 255 - data[i];
                data[i + 1] = 255 - data[i + 1];
                data[i + 2] = 255 - data[i + 2];
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

/**
 * 🔴 جدید: محاسبه رنگ غالب پس‌زمینه و رنگ متن از طریق وب‌سرویس پایتون.
 * این تابع در v0 تعریف نشده بود و باعث ReferenceError در جریان اصلی OCR می‌شد.
 */
async function calculateDominantBackgroundColor(mark) {
    const fallback = { backgroundColor: '#ffffff', textColor: '#000000' };
    if (!currentProjectId || !images[mark.imageId]) return fallback;
    try {
        const response = await fetch('/api/tools/process-marking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: currentProjectId,
                image_name: images[mark.imageId].name,
                mark: mark
            })
        });
        if (!response.ok) throw new Error('خطای سرور در محاسبه رنگ');
        const result = await response.json();
        return {
            backgroundColor: result.backgroundColor || fallback.backgroundColor,
            textColor: result.textColor || fallback.textColor
        };
    } catch (e) {
        console.error('خطا در محاسبه رنگ غالب:', e);
        return fallback;
    }
}

/**
 * پاکسازی خروجی مدل‌های زبانی.
 * 🔴 رفع: در v0 براکت‌ها escape نشده بودند و کل متن پاک می‌شد / SyntaxError می‌داد.
 */
function cleanOcrOutput(rawText) {
    if (!rawText) return "";
    let text = rawText.trim();

    // ۱. حذف تگ‌های فکری <think>...</think> و نشت reasoning مدل‌های Qwen
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/^(?:thinking|reasoning)(?:\s*(?:process|content))?\s*[:：]?\s*/i, '');
    text = text.replace(/\n*(?:final answer|answer)\s*[:：]\s*/gi, '\n');

    // ۲. حذف نشت دستورالعمل‌های پرامپت (براکت‌های escape‌شده + non-greedy)
    text = text.replace(/\[STRICT RULE:[\s\S]*?\]/gi, '');
    text = text.replace(/\[TASK:[\s\S]*?\]/gi, '');
    text = text.replace(/\[PRIMARY LANGUAGE:[\s\S]*?\]/gi, '');
    text = text.replace(/\[DIRECTION:[\s\S]*?\]/gi, '');
    text = text.replace(/\[?(task|strict rule|no_think|primary language|direction)[^\]]*\]?/gi, '');

    // ۳. حذف تگ‌های اسلش‌دار انتهای متن مانند /jason ، /json ، /text
    text = text.replace(/\/(jason|json|text|no_think|task|strict rule)\b/gi, '');

    // ۴. استخراج محتوای داخل تگ‌های کاذب مانند <jason>...</jason>
    const tagBlockRegex = /<(jason|json|ocr|text|content|result|output|data|response)[^>]*>([\s\S]*?)<\/\1>/gi;
    while (tagBlockRegex.test(text)) {
        text = text.replace(tagBlockRegex, '$2');
    }

    // ۵. حذف تگ‌های کاذب باقی‌مانده (باز و بسته)
    text = text.replace(/<\/?(jason|json|ocr|text|content|result|output|data|response)[^>]*>/gi, '');

    // ۶. حذف بلوک‌های کد مارک‌داون (```json / ```jason / ```)
    text = text.replace(/^```[a-zA-Z]*\s*/i, '').replace(/\s*```$/i, '');
    text = text.replace(/```[a-zA-Z]*/g, '');

    // ۷. حذف پیشوندهای مکالمه‌ای مدل‌های کوچک
    const conversationalPrefixes = [
        /^(here is the|the) (extracted )?text (from the image )?(is|are)?:\s*/i,
        /^(this is the )?extracted text:\s*/i,
        /^output:\s*/i,
        /^text:\s*/i,
        /^in this image, the text says:\s*/i
    ];
    conversationalPrefixes.forEach(regex => {
        text = text.replace(regex, '');
    });

    // ۸. حذف کوتیشن‌مارک‌های ابتدا و انتها
    if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
        text = text.substring(1, text.length - 1);
    }
    return text.trim();
}

/**
 * فراخوانی API LM Studio بر اساس استاندارد OpenAI Chat Completion
 */
async function callLmStudioAPI(base64ImageData) {
    const endpoint = apiUrlInput.value.trim();
    if (!endpoint) throw new Error("آدرس سرور LM Studio تعیین نشده است.");
    // OpenAI-compatible endpoint (LM Studio: /v1/chat/completions)
    const API_URL = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

    const langInput = document.getElementById('ocr-language-select');
    const dirInput = document.getElementById('ocr-direction-select');
    const langCode = langInput ? langInput.value : 'auto';
    const dirCode = dirInput ? dirInput.value : 'auto';
    const isVerticalClientSide = dirCode.startsWith('vertical');

    // ── پرامپت بهینه برای مدل‌های کوچک Qwen3.5 (2B / 4B) و OCR تصویر ──
    // کوتاه، صریح، بدون درخواست reasoning — فقط رونویسی خام
    const langHint = {
        japanese: 'Japanese (hiragana, katakana, kanji)',
        korean: 'Korean (Hangul)',
        chinese: 'Chinese (hanzi)',
        english: 'English',
        hindi: 'Hindi (Devanagari)',
        spanish: 'Spanish',
        french: 'French',
        russian: 'Russian (Cyrillic)',
        auto: 'whatever language appears'
    }[langCode] || 'whatever language appears';

    let directionHint = '';
    if (dirCode.startsWith('vertical')) {
        const order = dirCode === 'vertical-ltr' ? 'columns left-to-right' : 'columns right-to-left';
        directionHint = ` Text is VERTICAL (${order}, top to bottom).`;
    } else if (dirCode.startsWith('horizontal')) {
        const order = dirCode === 'horizontal-ltr' ? 'left-to-right' : 'right-to-left';
        directionHint = ` Text is HORIZONTAL (${order}).`;
    }

    // System: نقش ثابت + قوانین سخت — مناسب مدل‌های کوچک
    const systemPrompt =
        `You are an OCR engine for manga speech bubbles. ` +
        `Your ONLY job is to copy every character visible in the image, exactly as written. ` +
        `Rules:\n` +
        `1. Output ONLY the raw transcribed text. Nothing else.\n` +
        `2. Do NOT translate, explain, summarize, or add labels.\n` +
        `3. Do NOT use markdown, quotes, tags, or <think> blocks.\n` +
        `4. Keep original line breaks if text spans multiple lines.\n` +
        `5. If the image has no readable text, output a single empty response.\n` +
        `6. Language: ${langHint}.${directionHint}`;

    // User: دستور کوتاه — مدل‌های کوچک با پرامپت طولانی گیج می‌شوند
    const userTextPrompt = 'OCR this image. Output only the text.';

    async function performRequest(imageData) {
        // پارامترهای خاموش‌کردن thinking برای Qwen3.5 در LM Studio
        // (چند نام مختلف چون نسخه‌های مختلف LM Studio پارامترهای متفاوتی می‌پذیرند)
        const requestBody = {
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userTextPrompt },
                        { type: 'image_url', image_url: { url: imageData } }
                    ]
                }
            ],
            temperature: typeof ocrTemperature !== 'undefined' ? ocrTemperature : 0.0,
            max_tokens: 512,
            stream: false,
            // خاموش کردن reasoning / thinking (Qwen3.5 + LM Studio)
            reasoning_effort: 'none',
            enable_thinking: false,
            enableThinking: false,
            chat_template_kwargs: { enable_thinking: false },
            // پارامترهای کمکی برای پایداری خروجی کوتاه
            top_p: 0.9,
            top_k: 20,
            repeat_penalty: 1.05
        };

        const maxRetries = 3;
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000);
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    if (response.status >= 500 && attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                        continue;
                    }
                    const errorData = await response.json().catch(() => null);
                    throw new Error(errorData?.error?.message || `خطای HTTP! وضعیت: ${response.status}`);
                }
                const data = await response.json();
                const msg = data.choices?.[0]?.message;
                // اگر thinking خاموش نشود، متن گاهی فقط در reasoning_content می‌آید
                let content = (msg && msg.content) ? msg.content : '';
                if ((!content || !content.trim()) && msg && msg.reasoning_content) {
                    content = msg.reasoning_content;
                }
                if (content) {
                    const cleanedText = cleanOcrOutput(content);
                    return { text: cleanedText, is_vertical: isVerticalClientSide };
                }
                return { text: '', is_vertical: isVerticalClientSide };
            } catch (error) {
                lastError = error;
                if (error.name === 'AbortError') {
                    throw new Error('درخواست به دلیل طولانی شدن زمان (Timeout) لغو شد.');
                }
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                }
            }
        }
        throw lastError || new Error('خطای ناشناخته در ارتباط با سرور');
    }

    let result = await performRequest(base64ImageData);
    if (result.text === '' || (typeof isRepetitiveGarbage === 'function' && isRepetitiveGarbage(result.text))) {
        try {
            const invertedImage = await invertImage(base64ImageData);
            const retryResult = await performRequest(invertedImage);
            if (retryResult.text !== '' && !(typeof isRepetitiveGarbage === 'function' && isRepetitiveGarbage(retryResult.text))) {
                result = retryResult;
            }
        } catch (invertError) {
            console.error('Error during image inversion or retry:', invertError);
        }
    }
    return result;
}

async function performApiCall(batch, loadingText) {
    const originalBtnText = sendBatchBtn.textContent;
    sendBatchBtn.disabled = true; confirmNextBtn.disabled = true; retryEmptyBtn.disabled = true; retryDeletedBtn.disabled = true;
    const tempBtn = isAwaitingConfirmation ? retryEmptyBtn : sendBatchBtn;
    tempBtn.classList.add('is-loading');
    tempBtn.setAttribute('data-tip', loadingText);
    let success = false;
    let failCount = 0;
    try {
        // هر علامت به‌صورت مستقل پردازش می‌شود تا خطای یک مورد کل دسته را از کار نیندازد
        const apiPromises = batch.map(async (mark) => {
            try {
                const imageData = await getMarkedImageData(mark);
                if (!imageData) return;
                if (!mark.backgroundColor || !mark.textColor) {
                    const { backgroundColor, textColor } = await calculateDominantBackgroundColor(mark);
                    if (!mark.backgroundColor) mark.backgroundColor = backgroundColor;
                    if (!mark.textColor) mark.textColor = textColor;
                }
                const aiResponse = await callLmStudioAPI(imageData);
                let text = (aiResponse && aiResponse.text) ? aiResponse.text : "";
                if (typeof isRepetitiveGarbage === 'function' && isRepetitiveGarbage(text)) {
                    text = "";
                }
                mark.originalText = text.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s\s+/g, ' ').trim();
                if (typeof mark.translatedText === 'undefined') mark.translatedText = '';
                if (typeof mark.rotation === 'undefined') mark.rotation = 0;
                mark.isVertical = !!(aiResponse && aiResponse.is_vertical);
                if (mark.strokeWidthScale === undefined) mark.strokeWidthScale = defaultStrokeScale;
            } catch (markErr) {
                failCount++;
                console.error(`خطا در پردازش علامت #${mark.id}:`, markErr);
            }
        });
        await Promise.all(apiPromises);
        success = true;
        if (failCount > 0) {
            showError(`${failCount} مورد از دسته با خطا مواجه شد. می‌توانید موارد خالی را مجدداً ارسال کنید.`);
        }
    } catch (error) {
        showError(`خطا در ارتباط با هوش مصنوعی: ${error.message}`);
        console.error(error);
        success = false;
    } finally {
        sendBatchBtn.disabled = false; confirmNextBtn.disabled = false; retryEmptyBtn.disabled = false; retryDeletedBtn.disabled = false;
        
        tempBtn.classList.remove('is-loading');

        updateOutputList();
        if (rightSidebar.classList.contains('hidden')) toggleSidebar();
        if (success && typeof saveStateToServer === 'function') {
            saveStateToServer();
        }
        if (success && batch.length > 0) {
            const allFilled = batch.every(m => m.originalText && m.originalText.trim().length > 0);
            if (allFilled) {
                startAutoAdvanceCountdown();
            }
        }
        return success;
    }
}

function startAutoAdvanceCountdown() {
    isAutoAdvancePending = true;
    let countdown = parseInt(autoAdvanceTimeInput.value, 10) || 10;
    const confirmBadge = document.getElementById('confirm-badge');
    confirmNextBtn.classList.add('auto-mode-active');
    function updateBtn() {
        if (!isAutoAdvancePending) return;
        if (countdown > 0) {
            if (confirmBadge) confirmBadge.textContent = countdown;
            confirmNextBtn.setAttribute('data-tip', `توقف ارسال خودکار (${countdown} ثانیه)`);
            batchRangeDisplay.textContent = `ارسال خودکار دسته بعدی در ${countdown} ثانیه...`;
            countdown--;
            autoAdvanceTimerId = setTimeout(updateBtn, 1000);
        } else {
            confirmBatchAndProceed();
            setTimeout(() => { processNextMarkingBatch(); }, 500);
        }
    }
    updateBtn();
}
async function retryMarkings(markingsToRetry) {
    if (markingsToRetry.length === 0) { alert("موردی برای ارسال مجدد یافت نشد."); return; }
    const success = await performApiCall(markingsToRetry, 'در حال ارسال مجدد...');
    if (success) { markingsToRetry.forEach(m => m.needsRetry = false); updateOutputList(); }
}

async function retrySingleMarking(mark, btnElement) {
    btnElement.classList.add('loading');
    btnElement.innerHTML = '...';
    btnElement.style.pointerEvents = 'none';
    try {
        const imageData = await getMarkedImageData(mark);
        if (imageData) {
            // 🔴 رفع: اکنون await می‌شود
            const { backgroundColor, textColor } = await calculateDominantBackgroundColor(mark);
            if (!mark.backgroundColor) mark.backgroundColor = backgroundColor;
            mark.textColor = textColor;
            const aiResponse = await callLmStudioAPI(imageData);
            if (typeof isRepetitiveGarbage === 'function' && isRepetitiveGarbage(aiResponse.text)) {
                aiResponse.text = "";
            }
            mark.originalText = aiResponse.text;
            mark.isVertical = aiResponse.is_vertical;
            if (typeof mark.rotation === 'undefined') mark.rotation = 0;
            mark.needsRetry = false;
            if (mark.strokeWidthScale === undefined) mark.strokeWidthScale = defaultStrokeScale;
            updateOutputList();
            if (typeof saveStateToServer === 'function') {
                saveStateToServer();
            }
        }
    } catch (e) {
        showError("خطا در ارسال مجدد: " + e.message);
    }
}

async function processNextMarkingBatch() {
    if (!apiUrlInput.value.trim()) { showError("لطفاً آدرس سرور LM Studio را وارد کنید."); return; }
    if (isAwaitingConfirmation) return;
    const sortedMarkings = [...markings].sort((a, b) => a.id - b.id);
    const nextBatch = sortedMarkings.slice(lastProcessedMarkingIndex + 1, lastProcessedMarkingIndex + 1 + batchSize);
    if (nextBatch.length === 0) {
        alert("تمام علامت‌گذاری‌ها پردازش شده‌اند.");
        updateButtonStates();
        return;
    }
    currentBatchMarkings = nextBatch;
    if (currentBatchMarkings.length > 0) {
        updateOutputList();
        const firstId = currentBatchMarkings[0].id;
        scrollToSidebarItem(firstId);
    }
    const success = await performApiCall(currentBatchMarkings, `در حال پردازش دسته (${currentBatchMarkings.length} مورد)...`);
    if (success) {
        isAwaitingConfirmation = true;
        updateOutputList();
    } else {
        currentBatchMarkings = [];
        updateButtonStates();
    }
}