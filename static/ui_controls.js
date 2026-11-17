// ui_controls.js - نسخه نهایی (استروک در تب تنظیمات)
function applyZoom(delta, clientX, clientY) {
    const wrapperRect = imageContainerWrapper.getBoundingClientRect();
    const mouseX = clientX ? clientX - wrapperRect.left : wrapperRect.width / 2;
    const mouseY = clientY ? clientY - wrapperRect.top : wrapperRect.height / 2;
    const newZoom = Math.max(0.2, Math.min(10, zoomLevel * (1 + delta)));
    const xs = (mouseX - viewPosX) / zoomLevel;
    const ys = (mouseY - viewPosY) / zoomLevel;
    viewPosX = mouseX - xs * newZoom;
    viewPosY = mouseY - ys * newZoom;
    zoomLevel = newZoom;
    updateTransform();
}
function updateTransform() {
    imageContainer.style.transform = `translate(${viewPosX}px, ${viewPosY}px) scale(${zoomLevel})`;
    redrawAllMarkings();
}
function resetZoomAndPan() {
    if (activeImageIndex === -1) return;
    zoomLevel = 0.5;
    const wrapperRect = imageContainerWrapper.getBoundingClientRect();
    const img = images[activeImageIndex].element;
    viewPosX = (wrapperRect.width - (img.width * zoomLevel)) / 2;
    viewPosY = 20;
    updateTransform();
}
function handleZoomScroll(e) {
    e.preventDefault();
    applyZoom(e.deltaY > 0 ? -0.1 : 0.1, e.clientX, e.clientY);
}
function navigateImages(direction) {
    if (images.length === 0) return;
    let newIndex = activeImageIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= images.length) newIndex = images.length - 1;
    if (newIndex !== activeImageIndex) setActiveImage(newIndex);
}
function toggleSidebar() { rightSidebar.classList.toggle('hidden'); }

// 🔴 استروک اکنون در HTML تب تنظیمات است — فقط لیسنرها متصل می‌شوند
function initStrokeSettings() {
    const defaultInput = document.getElementById('default-stroke-scale');
    const stepInput = document.getElementById('stroke-step');
    if (!defaultInput || !stepInput) return;
    defaultInput.addEventListener('change', () => {
        let val = parseFloat(defaultInput.value);
        if (isNaN(val) || val < 0.2) val = 0.2;
        if (val > MAX_STROKE) val = MAX_STROKE;
        defaultInput.value = val;
        defaultStrokeScale = val;
        localStorage.setItem('defaultStrokeScale', val);
        updateOutputList();
    });
    stepInput.addEventListener('change', () => {
        let val = parseFloat(stepInput.value);
        if (isNaN(val) || val < 0.1) val = 0.1;
        if (val > 5) val = 5;
        stepInput.value = val;
        strokeStep = val;
        localStorage.setItem('strokeStep', val);
    });
}