/**
 * STS2 Card Art Editor - Web Version
 * Core Logic Script
 */

const state = {
    originalData: null,
    cards: [], // Array of override objects
    filteredCards: [],
    editingCardIndex: -1,
    isDirty: false
};

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const editorSection = document.getElementById('editorSection');
const cardGrid = document.getElementById('cardGrid');
const searchInput = document.getElementById('searchInput');
const cardCountEl = document.getElementById('cardCount');
const exportBtn = document.getElementById('exportBtn');
const appLoading = document.getElementById('appLoading');

// Modal Elements
const editModal = document.getElementById('editModal');
const modalPreview = document.getElementById('modalPreview');
const modalPath = document.getElementById('modalPath');
const modalSize = document.getElementById('modalSize');
const zoomSlider = document.getElementById('zoomSlider');
const offsetXSlider = document.getElementById('offsetXSlider');
const offsetYSlider = document.getElementById('offsetYSlider');
const imageInput = document.getElementById('imageInput');

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    initLucide();
});

function initEventListeners() {
    // Drop Zone
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) {
            handleFileUpload(file);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileUpload(file);
    });

    // Search
    searchInput.addEventListener('input', debounce(() => {
        filterCards();
    }, 300));

    // Modal
    document.getElementById('closeModal').onclick = closeModal;
    document.getElementById('cancelEdit').onclick = closeModal;
    document.getElementById('saveEdit').onclick = saveChanges;
    document.getElementById('resetCardBtn').onclick = resetCurrentCard;

    // Buttons
    document.getElementById('importBtn').onclick = () => fileInput.click();
    document.getElementById('addCardBtn').onclick = addNewCard;
    document.getElementById('exportBtn').onclick = exportJSON;
    document.getElementById('uploadImageBtn').onclick = () => imageInput.click();

    // Sliders
    [zoomSlider, offsetXSlider, offsetYSlider].forEach(slider => {
        slider.addEventListener('input', updateModalAdjustment);
    });
}

function initLucide() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// --- File Handling ---

async function handleFileUpload(file) {
    showLoading(true);
    
    try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        
        if (data.format !== 'card_art_bundle') {
            alert('올바른 STS2 아트팩 형식이 아닙니다. (format: card_art_bundle 필요)');
            showLoading(false);
            return;
        }

        state.originalData = data;
        state.cards = data.overrides || [];
        state.filteredCards = [...state.cards];
        
        renderUI();
        showLoading(false);
    } catch (err) {
        console.error('File Upload Error:', err);
        alert('파일을 읽는 중에 오류가 발생했습니다: ' + err.message);
        showLoading(false);
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

// --- UI Rendering ---

function renderUI() {
    dropZone.classList.add('hidden');
    editorSection.classList.remove('hidden');
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('addCardBtn').disabled = false;
    
    updateStats();
    renderCardGrid();
}

function addNewCard() {
    const path = prompt('추가할 카드의 원본 경로를 입력하세요:', 'res://images/packed/card_portraits/colorless/new_card');
    if (!path) return;
    
    const newCard = {
        source_path: path,
        width: 1000,
        height: 760,
        updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
        type: 'static',
        png_base64: '' // Empty initially
    };
    
    state.cards.push(newCard);
    state.filteredCards = [...state.cards];
    renderCardGrid();
    updateStats();
    
    // Open editor for the new card
    openEditor(state.filteredCards.length - 1);
}

function updateStats() {
    cardCountEl.textContent = state.cards.length;
}

function renderCardGrid() {
    cardGrid.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    
    state.filteredCards.forEach((card, index) => {
        const item = createCardElement(card, index);
        fragment.appendChild(item);
    });
    
    cardGrid.appendChild(fragment);
    
    // Lazy load images
    initLazyLoading();
}

function createCardElement(card, index) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.onclick = () => openEditor(index);
    
    const fileName = card.source_path.split('/').pop().replace('.tres', '');
    const isAnimated = card.type === 'animated_gif' || (card.frames && card.frames.length > 0);
    
    div.innerHTML = `
        <div class="card-thumbnail">
            <img data-src="${getCardImageSrc(card)}" alt="${fileName}" class="lazy">
            ${isAnimated ? '<span class="badge">GIF</span>' : ''}
        </div>
        <div class="card-meta">
            <div class="card-name">${fileName}</div>
            <div class="card-path">${card.source_path}</div>
        </div>
    `;
    
    return div;
}

function getCardImageSrc(card) {
    if (card.frames && card.frames.length > 0) {
        return `data:image/png;base64,${card.frames[0].png_base64}`;
    }
    return `data:image/png;base64,${card.png_base64}`;
}

function initLazyLoading() {
    const images = document.querySelectorAll('img.lazy');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                observer.unobserve(img);
            }
        });
    }, { rootMargin: '200px' });
    
    images.forEach(img => observer.observe(img));
}

// --- Filtering ---

function filterCards() {
    const query = searchInput.value.toLowerCase();
    state.filteredCards = state.cards.filter(card => {
        const fileName = card.source_path.toLowerCase();
        return fileName.includes(query);
    });
    renderCardGrid();
}

// --- Editor Modal ---

function openEditor(indexInFiltered) {
    const card = state.filteredCards[indexInFiltered];
    // Find absolute index in state.cards
    state.editingCardIndex = state.cards.indexOf(card);
    
    modalPath.textContent = card.source_path;
    modalSize.textContent = `${card.width || 1000} x ${card.height || 760}`;
    modalPreview.src = getCardImageSrc(card);
    
    // Reset sliders (In a real app, we'd load saved adjustment from JSON if it existed)
    zoomSlider.value = 100;
    offsetXSlider.value = 0;
    offsetYSlider.value = 0;
    
    editModal.classList.remove('hidden');
    initLucide();
}

function closeModal() {
    editModal.classList.add('hidden');
    modalPreview.src = '';
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        modalPreview.src = event.target.result;
        state.isDirty = true;
    };
    reader.readAsDataURL(file);
}

function updateModalAdjustment() {
    const zoom = zoomSlider.value / 100;
    const x = offsetXSlider.value;
    const y = offsetYSlider.value;
    
    modalPreview.style.transform = `scale(${zoom}) translate(${x}px, ${y}px)`;
}

function saveChanges() {
    const card = state.cards[state.editingCardIndex];
    const newImageSrc = modalPreview.src;
    
    if (newImageSrc.startsWith('data:image')) {
        const base64 = newImageSrc.split(',')[1];
        card.png_base64 = base64;
        card.updated_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
        
        // Note: In this simple version, we don't apply cropping for real, 
        // just storing the base64. A real tool would use a Canvas to crop/resize.
    }
    
    state.isDirty = true;
    renderCardGrid();
    closeModal();
}

function resetCurrentCard() {
    if (confirm('이 카드의 변경 사항을 취소하시겠습니까? (원본 복원은 게임 내에서 가능합니다)')) {
        // Just reload indices or reset state if we kept original
        closeModal();
    }
}

// --- Export ---

function exportJSON() {
    const exportData = {
        ...state.originalData,
        exported_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
        count: state.cards.length,
        overrides: state.cards
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, '\t')], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `updated_artpack_${new Date().getTime()}.cardartpack.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    state.isDirty = false;
    alert('아트팩이 성공적으로 내보내기 되었습니다.');
}

// --- Helpers ---

function showLoading(show) {
    if (show) appLoading.classList.remove('hidden');
    else appLoading.classList.add('hidden');
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
