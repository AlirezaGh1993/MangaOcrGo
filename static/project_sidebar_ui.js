// project_sidebar_ui.js - نسخه v5 (مرتب‌سازی بر اساس نام + سوییچر سریع پروژه)
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 🔴 جدید: مرتب‌سازی پروژه‌ها بر اساس نام (فارسی، عدد-آگاه)
function sortProjectsByName(projects) {
    return projects.sort((a, b) => a.name.localeCompare(b.name, 'fa', { sensitivity: 'base', numeric: true }));
}

function initSidebarTabs() {
    const tabButtons = document.querySelectorAll('.sidebar-tabs .tab-btn');
    function switchTab(targetTab) {
        tabButtons.forEach(btn => {
            if (btn.dataset.tab === targetTab) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        document.querySelectorAll('#left-sidebar .tool-section').forEach(section => {
            if (section.dataset.sectionId === targetTab) section.classList.remove('hidden');
            else section.classList.add('hidden');
        });
    }
    tabButtons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    switchTab('project');
}

async function updateProjectsList() {
    const listContainer = document.getElementById('server-projects-list');
    if (!listContainer) return;
    try {
        const response = await fetch('/api/projects');
        const projects = sortProjectsByName(await response.json());   // 🔴 مرتب بر اساس نام
        listContainer.innerHTML = '';
        if (projects.length === 0) {
            listContainer.innerHTML = '<p style="font-size:0.8rem; color:#888; text-align:center;">پروژه‌ای روی سرور یافت نشد.</p>';
            return;
        }
        projects.forEach(proj => {
            const isActive = proj.id === currentProjectId;
            const safeName = escapeHtml(proj.name);
            const card = document.createElement('div');
            card.className = `project-card ${isActive ? 'active-project' : ''}`;
            card.innerHTML = `
                <div class="project-card-header">
                    <span class="project-card-title" title="${safeName}">${safeName}</span>
                    <span class="project-card-meta">${proj.images_count} عکس</span>
                </div>
                <div class="project-card-actions">
                    <button class="btn-switch-project" style="background-color:#007bff;color:white;" ${isActive ? 'disabled' : ''}>ورود</button>
                    <button class="btn-rename-project" style="background-color:#ffc107;color:#212529;">نام</button>
                    <button class="btn-delete-project" style="background-color:#dc3545;color:white;">حذف</button>
                </div>`;
            card.querySelector('.btn-switch-project').addEventListener('click', () => { if (typeof loadProjectFromServer === 'function') loadProjectFromServer(proj.id); });
            card.querySelector('.btn-rename-project').addEventListener('click', () => {
                const newName = prompt("نام نمایشی جدید پروژه:", proj.name);
                if (newName && newName.trim() && typeof renameProjectOnServer === 'function') renameProjectOnServer(proj.id, newName.trim());
            });
            card.querySelector('.btn-delete-project').addEventListener('click', () => {
                if (confirm(`آیا از حذف کامل پروژه مطمئن هستید؟`)) { if (typeof deleteProjectFromServer === 'function') deleteProjectFromServer(proj.id); }
            });
            listContainer.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

// ──────────────── 🔴 جدید: سوییچر سریع پروژه (فلش کنار نام) ────────────────
function initProjectSwitcher() {
    const btn = document.getElementById('project-switcher-btn');
    const list = document.getElementById('project-switcher-list');
    if (!btn || !list) return;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!list.classList.contains('hidden')) { closeProjectSwitcher(); return; }
        await renderProjectSwitcherList();
        list.classList.remove('hidden');
        btn.classList.add('open');
    });
    document.addEventListener('click', (e) => {
        if (!list.contains(e.target) && e.target !== btn) closeProjectSwitcher();
    });
}
function closeProjectSwitcher() {
    const list = document.getElementById('project-switcher-list');
    const btn = document.getElementById('project-switcher-btn');
    if (list) list.classList.add('hidden');
    if (btn) btn.classList.remove('open');
}
async function renderProjectSwitcherList() {
    const list = document.getElementById('project-switcher-list');
    if (!list) return;
    try {
        const response = await fetch('/api/projects');
        const projects = sortProjectsByName(await response.json());   // مرتب بر اساس نام
        list.innerHTML = '';
        if (projects.length === 0) {
            list.innerHTML = '<div class="project-switcher-empty">پروژه‌ای روی سرور نیست</div>';
            return;
        }
        projects.forEach(proj => {
            const item = document.createElement('div');
            item.className = 'project-switcher-item' + (proj.id === currentProjectId ? ' active' : '');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = proj.name;   // textContent = ایمن در برابر XSS
            item.appendChild(nameSpan);
            item.addEventListener('click', () => {
                closeProjectSwitcher();
                if (proj.id !== currentProjectId && typeof loadProjectFromServer === 'function') {
                    loadProjectFromServer(proj.id);
                }
            });
            list.appendChild(item);
        });
    } catch (e) { console.error(e); }
}

function renderSidebarImageList() {
    const listContainer = document.getElementById('image-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    images.forEach((img, index) => {
        const isActive = index === activeImageIndex;
        const safeName = escapeHtml(img.name);
        const item = document.createElement('div');
        item.className = `image-list-item ${isActive ? 'active-item' : ''}`;
        item.draggable = true;
        item.dataset.index = index;
        item.innerHTML = `
            <span class="img-item-drag-handle">☰</span>
            <div class="img-item-details" style="padding-left:10px;">
                <span class="img-item-index">تصویر ${index + 1}</span>
                <span class="img-item-name" title="${safeName}">${safeName}</span>
            </div>
            <button class="img-item-delete-btn" title="حذف تصویر">&times;</button>`;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('img-item-delete-btn')) return;
            if (typeof setActiveImage === 'function') { setActiveImage(index); renderSidebarImageList(); }
        });
        item.querySelector('.img-item-delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`آیا از حذف تصویر "${img.name}" و تمام حباب‌های آن مطمئن هستید؟`)) await deleteSingleImage(img.name, index);
        });
        item.addEventListener('dragstart', (e) => { item.classList.add('dragging'); e.dataTransfer.setData('text/plain', index); });
        item.addEventListener('dragend', () => { item.classList.remove('dragging'); document.querySelectorAll('.image-list-item').forEach(el => el.style.borderTop = ''); });
        item.addEventListener('dragover', (e) => { e.preventDefault(); item.style.borderTop = '2px solid #007bff'; });
        item.addEventListener('dragleave', () => { item.style.borderTop = ''; });
        item.addEventListener('drop', (e) => {
            e.preventDefault(); item.style.borderTop = '';
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (fromIndex !== index) reorderImages(fromIndex, index);
        });
        listContainer.appendChild(item);
    });
}

async function reorderImages(fromIndex, toIndex) {
    const movedImage = images.splice(fromIndex, 1)[0];
    images.splice(toIndex, 0, movedImage);
    images.forEach((img, idx) => { img.id = idx; img.wrapper.dataset.imageId = idx; });
    markings.forEach(mark => { const foundIdx = images.findIndex(img => img.name === mark.imageName); if (foundIdx !== -1) mark.imageId = foundIdx; });
    if (typeof setActiveImage === 'function') setActiveImage(toIndex);
    if (typeof saveStateToServer === 'function') await saveStateToServer();
    renderSidebarImageList();
}

async function deleteSingleImage(filename, index) {
    if (!currentProjectId) return;
    try {
        const response = await fetch(`/api/project/${currentProjectId}/images/${filename}`, { method: 'DELETE' });
        if (response.ok) {
            markings = markings.filter(m => m.imageName !== filename && m.imageId !== index);
            const deletedImg = images[index];
            if (deletedImg && deletedImg.wrapper) deletedImg.wrapper.remove();
            images.splice(index, 1);
            images.forEach((img, idx) => { img.id = idx; img.wrapper.dataset.imageId = idx; });
            markings.forEach(mark => { const foundIdx = images.findIndex(img => img.name === mark.imageName); if (foundIdx !== -1) mark.imageId = foundIdx; });
            if (images.length > 0) { if (typeof setActiveImage === 'function') setActiveImage(Math.max(0, index - 1)); }
            else { activeImageIndex = -1; clearAllMarkingsConfirmless(); }
            if (typeof saveStateToServer === 'function') await saveStateToServer();
            renderSidebarImageList();
        } else { alert("خطا در حذف فایل از سرور دیسک"); }
    } catch (e) { console.error(e); }
}