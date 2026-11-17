// font_manager.js - نسخه ذخیره‌سازی سمت سرور با پشتیبانی از اسلات پیش‌فرض (۰) و نام‌گذاری اختصاصی ۱ تا ۵

function setupFontListeners() {
    fontInputs.forEach((input) => {
        const index = parseInt(input.dataset.index, 10);
        input.addEventListener('change', (e) => handleFontUploadToServer(e, index));
    });

    clearFontBtns.forEach((btn) => {
        const index = parseInt(btn.dataset.index, 10);
        btn.addEventListener('click', () => clearFontSlotOnServer(index));
    });

    // لیسنر تغییرات نام اختصاصی فونت‌های ۱ تا ۵
    document.querySelectorAll('.font-custom-name-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index, 10);
            fontCustomNames[index] = e.target.value.trim();
            
            // ذخیره‌سازی سراسری روی دیسک سرور و بروزرسانی بلادرنگ محیط کار
            if (typeof saveGlobalSettingsToServer === 'function') {
                saveGlobalSettingsToServer();
            }
            if (typeof updateOutputList === 'function') updateOutputList();
            if (typeof redrawAllMarkings === 'function') redrawAllMarkings();
        });
    });
}

// بارگذاری آدرس فونت‌ها از روی سرور پایتون
async function loadSavedFontsFromServer() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        const savedFonts = config.fonts || {};

        // خواندن نام‌های اختصاصی فونت‌ها از تنظیمات سرور
        if (config.fontCustomNames) {
            fontCustomNames = config.fontCustomNames;
        }

        // لود ۶ اسلات (۰ پیش‌فرض، ۱ تا ۵ اختصاصی)
        for (let i = 0; i <= 5; i++) {
            if (savedFonts[i]) {
                const fontUrl = `/api/font/file/${savedFonts[i].filename}`;
                const originalName = savedFonts[i].original_name;
                await loadFontFromUrl(fontUrl, originalName, i);
            } else if (i === 0) {
                // مقدار پیش‌فرض سیستمی برای اسلات ۰
                updateFontDisplay(0, 'Tahoma', true);
            } else {
                updateFontDisplay(i, 'خالی');
            }

            // پر کردن اینپوت‌های نام‌گذاری در پنل
            if (i >= 1 && i <= 5) {
                const input = document.querySelector(`.font-custom-name-input[data-index="${i}"]`);
                if (input) {
                    input.value = fontCustomNames[i] || '';
                }
            }
        }
    } catch (e) {
        console.error("خطا در دریافت لیست فونت‌ها از سرور:", e);
    }
}

// ارسال فایل فونت به سرور با FormData
async function handleFontUploadToServer(event, index) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`/api/font/${index}`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();

        if (response.ok) {
            await loadFontFromUrl(result.url, result.original_name, index);
            if (typeof saveStateToServer === 'function') saveStateToServer();
        } else {
            alert("خطا در آپلود فونت: " + result.error);
        }
    } catch (e) {
        console.error(e);
        alert("ارتباط با سرور برقرار نشد.");
    }
}

// ثبت و لود فونت در مرورگر از روی لینک سرور با صراحت وزن نرمال
function loadFontFromUrl(fontUrl, fontName, index) {
    return new Promise((resolve) => {
        const fontFaceName = `UserFont_${index}`;
        // تعیین صریح وزن normal جهت ممانعت از پر شدن و ضخیم شدن مصنوعی حروف فارسی
        const fontFace = new FontFace(fontFaceName, `url(${fontUrl})`, { weight: 'normal', style: 'normal' });
        
        fontFace.load().then((loadedFace) => {
            document.fonts.add(loadedFace);
            loadedFonts[index] = fontUrl;
            loadedFontNames[index] = fontFaceName;
            
            updateFontDisplay(index, fontName);
            if (typeof redrawAllMarkings === 'function') redrawAllMarkings();
            resolve();
        }).catch(e => {
            console.error(`خطا در پردازش فونت اسلات ${index}:`, e);
            resolve(); // حل بن‌بست لودینگ در صورت وجود خطای فونت
        });
    });
}

// حذف فونت از روی سرور
async function clearFontSlotOnServer(index) {
    try {
        const response = await fetch(`/api/font/${index}`, { method: 'DELETE' });
        if (response.ok) {
            if (index === 0) {
                loadedFonts[0] = null;
                loadedFontNames[0] = 'Tahoma';
                updateFontDisplay(0, 'Tahoma', true);
            } else {
                loadedFonts[index] = null;
                loadedFontNames[index] = null;
                updateFontDisplay(index, 'خالی');
            }
            if (typeof redrawAllMarkings === 'function') redrawAllMarkings();
            if (typeof saveStateToServer === 'function') saveStateToServer();
        }
    } catch (e) {
        console.error("حذف فونت با خطا مواجه شد:", e);
    }
}

function updateFontDisplay(index, name, isDefault = false) {
    const displayElement = document.getElementById(`font-name-${index}`);
    if (displayElement) {
        displayElement.textContent = name;
        displayElement.style.color = (name === 'خالی' || (isDefault && index === 0)) ? '#666' : '#28a745';
        displayElement.style.fontWeight = (name !== 'خالی') ? 'bold' : 'normal';
    }
}

function getFontFamilyByIndex(index) {
    if (index === undefined || index === null || index === 0) return loadedFontNames[0] || 'Tahoma';
    if (!loadedFontNames[index]) return loadedFontNames[0] || 'Tahoma';
    return loadedFontNames[index];
}

function getNextAvailableFontIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % 6;
    let attempts = 0;
    while (nextIndex !== 0 && !loadedFontNames[nextIndex] && attempts < 6) {
        nextIndex = (nextIndex + 1) % 6;
        attempts++;
    }
    return nextIndex;
}