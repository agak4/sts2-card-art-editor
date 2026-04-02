/**
 * STS2 Card Art Editor - Web Version
 * Core Logic Script
 */

const state = {
    originalData: null,
    cards: [], // Array of override objects
    filteredCards: [],
    editingCardIndex: -1,
    isDirty: false,
    filters: {
        character: 'all',
        type: 'all',
        rarity: 'all'
    }
};

const CATEGORY_KEYWORDS = {
    ironclad: ['ironclad'],
    silent: ['silent'],
    regent: ['regent'],
    necreobinder: ['necreobinder'],
    defect: ['defect'],
    colorless: ['colorless'],
    ancient: ['ancient'],
    misc: ['status', 'curse', 'event', 'quest', 'token']
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

document.addEventListener('DOMContentLoaded', async () => {
    initEventListeners();
    initLucide();
    
    // Auto-restore from IndexedDB
    const savedData = await loadFromDB();
    if (savedData) {
        state.originalData = savedData.originalData;
        state.cards = savedData.cards;
        state.filteredCards = [...state.cards];
        state.isDirty = false;
        renderUI();
    }
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

    // Filter Buttons
    initFilterEvents();

    // Prevent accidental closure
    window.addEventListener('beforeunload', (e) => {
        if (state.isDirty) {
            e.preventDefault();
            e.returnValue = ''; // Required for some browsers
        }
    });

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

function initFilterEvents() {
    const filterGroups = document.querySelectorAll('.chip-list');
    filterGroups.forEach(group => {
        const groupName = group.dataset.filterGroup;
        const chips = group.querySelectorAll('.filter-chip');
        
        chips.forEach(chip => {
            chip.onclick = () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.filters[groupName] = chip.dataset.filterValue;
                filterCards();
            };
        });
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
        state.isDirty = false;
        
        await saveToDB({ 
            originalData: state.originalData, 
            cards: state.cards 
        });
        
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
    state.isDirty = true;
    
    saveToDB({ 
        originalData: state.originalData, 
        cards: state.cards 
    });
    
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
    
    // no 번호 기준 오름차순 정렬
    state.filteredCards.sort((a, b) => {
        const noA = parseInt(a.no) || 0;
        const noB = parseInt(b.no) || 0;
        return noA - noB;
    });
    
    const fragment = document.createDocumentFragment();
    
    state.filteredCards.forEach((card, index) => {
        const item = createCardElement(card, index);
        fragment.appendChild(item);
    });
    
    cardGrid.appendChild(fragment);
    
    initLazyLoading();
}

function createCardElement(card, index) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.onclick = () => openEditor(index);
    
    // 데이터 형식 정제 (Legacy 지원)
    const info = (card.paths && card.name_kr) ? null : getCardClassification(card);
    
    const nameKr = card.name_kr || (info ? info.name : 'Unknown Card');
    const nameEn = card.name_en || (info ? info.name_en : 'unknown_card');
    const type = (card.type && card.type !== 'static') ? card.type : (info ? info.type : 'Skill');
    const character = card.character || (info ? info.character : 'Colorless');
    const rarity = card.rarity || (info ? info.rarity : 'Common');
    const no = card.no || (index + 1);

    // 자산 경로 추론
    const assets = card.paths || getCardAssets({ character, type, rarity, name_en: nameEn });
    
    // Art 경로는 Legacy 자료일 경우 nameEn을 기반으로 재생성 시도함
    let artSrc = assets.art;
    if (!artSrc || artSrc === '') {
        artSrc = `source/img/cards/${character}/${nameEn.split(' ').join('_')}.png`;
    }
    
    const bgStyle = assets.bg ? `background-image: url('${assets.bg}')` : '';
    const frameStyle = assets.frame ? `background-image: url('${assets.frame}')` : '';
    const bannerStyle = assets.banner ? `background-image: url('${assets.banner}')` : '';
    const orbStyle = assets.orb ? `background-image: url('${assets.orb}')` : '';
    
    div.innerHTML = `
        <div class="sts2-card">
            <div class="layer layer-bg" style="${bgStyle}"></div>
            <div class="layer layer-art">
                <img data-src="${artSrc}" alt="${nameEn}" class="lazy" onerror="this.src='source/img/card_base/273px-StS2_AncientCardHighlight.png'">
            </div>
            <div class="layer layer-frame" style="${frameStyle}"></div>
            <div class="layer layer-banner" style="${bannerStyle}"></div>
            <div class="layer layer-orb" style="${orbStyle}"></div>
            <div class="layer layer-text">
                <div class="card-name-overlay">${nameKr}</div>
                <div class="card-type-overlay">${type.toUpperCase()}</div>
            </div>
        </div>
        <div class="card-meta">
            <div class="card-name">${nameKr} <span class="card-no">#${no}</span></div>
            <div class="card-path">${nameEn}</div>
        </div>
    `;
    
    return div;
}

// 경로 분석 및 자동 명명 규칙
function getCardClassification(card) {
    const path = (card.source_path || '').toLowerCase();
    
    // 이름 추출
    const pathParts = path.split('/');
    const fileName = pathParts[pathParts.length - 1].split('.').shift();
    const formattedName = fileName.split('_').join(' ');
    
    let character = 'Colorless';
    if (path.includes('ironclad')) character = 'Ironclad';
    else if (path.includes('silent')) character = 'Silent';
    else if (path.includes('defect')) character = 'Defect';
    else if (path.includes('regent')) character = 'Regent';
    else if (path.includes('necrobinder')) character = 'Necrobinder';

    let type = 'Skill';
    if (path.includes('attack')) type = 'Attack';
    else if (path.includes('power')) type = 'Power';
    else if (path.includes('curse')) type = 'Curse';
    else if (path.includes('status')) type = 'Status';
    else if (path.includes('quest')) type = 'Quest';
    else if (path.includes('event')) type = 'Event';

    let rarity = 'Common';
    if (path.includes('uncommon')) rarity = 'Uncommon';
    else if (path.includes('rare')) rarity = 'Rare';
    else if (path.includes('starter') || path.includes('basic')) rarity = 'Common';
    else if (path.includes('ancient')) rarity = 'Ancient';
    
    return { 
        name: formattedName.charAt(0).toUpperCase() + formattedName.slice(1),
        name_en: formattedName,
        character, 
        type, 
        rarity
    };
}

function getCardAssets(info) {
    const { character, type, rarity } = info;
    const prefix = 'source/img/card_base/273px-StS2_';
    const raritySuffix = (rarity === 'Common' || rarity === 'Starter') ? 'Common' : rarity;
    
    const paths = {
        bg: `${prefix}Bg${type}${character}.png`,
        frame: `${prefix}Frame${type}${raritySuffix}.png`,
        banner: `${prefix}Banner${raritySuffix}.png`,
        orb: `${prefix}Card${character}Orb.png`,
        art: ''
    };

    // 특수 예외 처리 (Curse, Status, Event, Quest 등)
    if (type === 'Curse' || type === 'Status') {
        const t = (type === 'Status') ? 'Curse' : type;
        paths.bg = `${prefix}Bg${t}.png`;
        paths.frame = `${prefix}Frame${type}.png`;
        paths.banner = `${prefix}Banner${type}.png`;
        paths.orb = ''; 
    } else if (type === 'Quest' || type === 'Event') {
        const t = (type === 'Event') ? 'Quest' : type; // Event는 전용 Bg가 없어 Quest Bg 공유함
        paths.bg = `${prefix}Bg${t}.png`;
        
        // Event/Quest는 종류별(Attack/Skill/Power) 프레임이 있을 수도, 단독일 수도 있음
        // 에셋 목록에 FrameAttackEvent.png 등이 있으므로 이를 대응함 (FrameEvent.png는 존재하지 않음)
        const frameRarity = (rarity === 'Event' || rarity === 'Quest' || type === 'Event' || type === 'Quest') ? 'Event' : '';
        
        if (frameRarity) {
            const frameBase = (type === 'Attack' || type === 'Skill' || type === 'Power') ? type : 'Skill';
            paths.frame = `${prefix}Frame${frameBase}${frameRarity}.png`;
        } else {
            paths.frame = `${prefix}Frame${type}.png`;
        }
        paths.banner = `${prefix}Banner${type}.png`;
    }

    return paths;
}

function initLazyLoading() {
    const images = document.querySelectorAll('img.lazy');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.classList.remove('lazy');
                    observer.unobserve(img);
                }
            }
        });
    }, { rootMargin: '200px' });
    
    images.forEach(img => observer.observe(img));
}

// --- Filtering ---

const FILTER_GROUPS = {
    character: {
        misc: ['Status', 'Curse', 'Event', 'Quest', 'Token']
    },
    type: {
        misc: ['Status', 'Curse', 'Quest']
    },
    rarity: {
        misc: ['Starter', 'Ancient']
    }
};

function filterCards() {
    const query = (searchInput.value || '').toLowerCase();
    const { character, type, rarity } = state.filters;
    
    state.filteredCards = state.cards.filter(card => {
        const nameKr = (card.name_kr || '').toLowerCase();
        const nameEn = (card.name_en || '').toLowerCase();
        
        // 원본 대소문자 유지 데이터와 비교
        const c_orig = card.character || 'Colorless';
        const t_orig = card.type || 'Skill';
        const r_orig = card.rarity || 'Common';
        
        // 캐릭터 필터
        let matchesCharacter = false;
        if (character === 'all') {
            matchesCharacter = true;
        } else if (character === 'misc') {
            matchesCharacter = FILTER_GROUPS.character.misc.includes(c_orig);
        } else {
            matchesCharacter = c_orig === character;
        }

        // 타입 필터
        let matchesType = false;
        if (type === 'all') {
            matchesType = true;
        } else if (type === 'misc') {
            matchesType = FILTER_GROUPS.type.misc.includes(t_orig);
        } else {
            matchesType = t_orig === type;
        }

        // 희귀도 필터
        let matchesRarity = false;
        if (rarity === 'all') {
            matchesRarity = true;
        } else if (rarity === 'misc') {
            matchesRarity = FILTER_GROUPS.rarity.misc.includes(r_orig);
        } else {
            matchesRarity = r_orig === rarity;
        }
        
        // 검색 필터
        const matchesQuery = nameKr.includes(query) || nameEn.includes(query);
        
        return matchesCharacter && matchesType && matchesRarity && matchesQuery;
    });

    updateRarityFilterUI();
    renderCardGrid();
}

function updateRarityFilterUI() {
    const isLocked = state.filters.character === 'misc' || state.filters.character === 'Ancient';
    const rarityGroup = document.querySelector('.rarity-group');
    const chips = rarityGroup.querySelectorAll('.filter-chip');
    
    if (isLocked) {
        rarityGroup.classList.add('filter-locked');
        // 잠금 시 희귀도 필터를 '전체'로 강제 초기화할 수도 있으나, 
        // 일단 UI상으로만 비활성화 처리 (포인터 이벤트 차단)
    } else {
        rarityGroup.classList.remove('filter-locked');
    }
}

// --- Editor Modal ---

function openEditor(indexInFiltered) {
    const card = state.filteredCards[indexInFiltered];
    if (!card) return;

    // Find absolute index in state.cards
    state.editingCardIndex = state.cards.indexOf(card);
    
    const p = card.paths || {};
    const artSrc = p.art || 'source/img/card_base/273px-StS2_AncientCardHighlight.png';

    modalPath.textContent = p.art || 'N/A';
    modalSize.textContent = `${card.width || 1000} x ${card.height || 760}`;
    modalPreview.src = artSrc;
    
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
    saveToDB({ 
        originalData: state.originalData, 
        cards: state.cards 
    });
    
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
    saveToDB({ 
        originalData: state.originalData, 
        cards: state.cards 
    });
    
    alert('아트팩이 성공적으로 내보내기 되었습니다.');
}

// --- Persistence (IndexedDB) ---

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('STS2CardArtEditor', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('AppData')) {
                db.createObjectStore('AppData');
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e);
    });
}

async function saveToDB(value) {
    try {
        const db = await openDB();
        const tx = db.transaction('AppData', 'readwrite');
        const store = tx.objectStore('AppData');
        store.put(value, 'currentState');
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject();
        });
    } catch (err) {
        console.error('Failed to save to IDB:', err);
    }
}

async function loadFromDB() {
    try {
        const db = await openDB();
        const tx = db.transaction('AppData', 'readonly');
        const store = tx.objectStore('AppData');
        const request = store.get('currentState');
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject();
        });
    } catch (err) {
        console.error('Failed to load from IDB:', err);
        return null;
    }
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
