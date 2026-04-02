'use strict';

// ================================================================
// 카드 DB (cards.csv 동적 로드 후 구축)
// ================================================================
let CARDS_DB = [];

// 캐릭터+이름 조합 맵 (먼저, 더 정확)
const CHAR_NAME_MAP = new Map();
// 이름만 맵 (폴백)
const NAME_MAP = new Map();

/**
 * CSV 한 줄을 필드 배열로 파싱 (따옴표 포함 필드 지원)
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let insideQuote = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (insideQuote && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                insideQuote = !insideQuote;
            }
        } else if (ch === ',' && !insideQuote) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

/**
 * cards.csv를 fetch로 읽어 CARDS_DB를 반환
 * @returns {Promise<Array>}
 */
async function loadCardsFromCSV() {
    const response = await fetch('cards.csv');
    const text = await response.text();
    const lines = text.split(/\r?\n/);

    const db = [];
    // 첫 행은 헤더(no,name_kr,name_en,character,type,rarity)이므로 건너뜀
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const [noStr, name_kr, name_en, character, cardType, rarity] = parseCsvLine(line);
        const no = parseInt(noStr, 10);
        if (isNaN(no)) continue;

        db.push({ no, name_kr, name_en, character, cardType, rarity });
    }
    return db;
}

/**
 * CARDS_DB를 받아 조회 맵(CHAR_NAME_MAP, NAME_MAP)을 구축
 * @param {Array} db
 */
function buildCardsDB(db) {
    CARDS_DB = db;
    CHAR_NAME_MAP.clear();
    NAME_MAP.clear();

    CARDS_DB.forEach(card => {
        const nk = toKey(card.name_en);
        if (!nk) return;
        const ck = `${toKey(card.character)}:${nk}`;
        if (!CHAR_NAME_MAP.has(ck)) CHAR_NAME_MAP.set(ck, card);
        if (!NAME_MAP.has(nk)) NAME_MAP.set(nk, card);
    });
}

// 조회키: 특수문자 제거 후 소문자
function toKey(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const DIR_TO_CHARACTER = {
    ironclad: 'Ironclad', silent: 'Silent', regent: 'Regent',
    necrobinder: 'Necrobinder', defect: 'Defect', colorless: 'Colorless',
    ancient: 'Ancient', status: 'Status', curse: 'Curse',
    event: 'Event', quest: 'Quest', token: 'Token'
};

/**
 * source_path로부터 cards.csv 레코드를 찾아 반환
 * @param {string} sourcePath e.g. "res://images/packed/card_portraits/ironclad/anger.png"
 */
function findCardMeta(sourcePath) {
    const segs = sourcePath.replace('res://', '').split('/');
    const rawFile = (segs.pop() || '').replace(/\.[^.]+$/, ''); // 확장자 제거
    const dir = (segs.pop() || '').toLowerCase();

    const character = DIR_TO_CHARACTER[dir] || '';
    const fileKey = toKey(rawFile);

    // 1차: 캐릭터+파일명 조합
    const ck = `${toKey(character)}:${fileKey}`;
    if (CHAR_NAME_MAP.has(ck)) return CHAR_NAME_MAP.get(ck);

    // 2차: 파일명만
    if (NAME_MAP.has(fileKey)) return NAME_MAP.get(fileKey);

    // 3차: 파일명에서 숫자 접미사 제거 후 재시도 (ex. anger_2 -> anger)
    const trimmedKey = fileKey.replace(/\d+$/, '');
    if (CHAR_NAME_MAP.has(`${toKey(character)}:${trimmedKey}`)) {
        return CHAR_NAME_MAP.get(`${toKey(character)}:${trimmedKey}`);
    }
    if (NAME_MAP.has(trimmedKey)) return NAME_MAP.get(trimmedKey);

    return null;
}

// ================================================================
// 필터 설정
// ================================================================
const MISC_CHARACTER = new Set(['Status', 'Curse', 'Event', 'Quest', 'Token']);
const MISC_TYPE = new Set(['Status', 'Curse', 'Quest']);
const MISC_RARITY = new Set(['Starter', 'Ancient', 'Misc']);
// 이 캐릭터 필터 선택 시 희귀도 필터 비활성화
const RARITY_DISABLED_CHARS = new Set(['Ancient', 'misc']);

// ================================================================
// 상태
// ================================================================
const state = {
    originalData: null,
    cards: [],          // 원본 artpack 카드 배열 (메타 enriched)
    filteredCards: [],
    editingCardIndex: -1,
    isDirty: false,
    filters: { character: 'all', type: 'all', rarity: 'all' }
};

// ================================================================
// DOM 참조
// ================================================================
const $ = id => document.getElementById(id);
let dom = {};

function initDom() {
    dom = {
        dropZone: $('dropZone'),
        fileInput: $('fileInput'),
        editorSection: $('editorSection'),
        cardGrid: $('cardGrid'),
        searchInput: $('searchInput'),
        cardCountEl: $('cardCount'),
        exportBtn: $('exportBtn'),
        addCardBtn: $('addCardBtn'),
        importBtn: $('importBtn'),
        appLoading: $('appLoading'),
        // Modal
        editModal: $('editModal'),
        modalPreview: $('modalPreview'),
        modalPath: $('modalPath'),
        modalSize: $('modalSize'),
        modalNameKr: $('modalNameKr'),
        zoomSlider: $('zoomSlider'),
        offsetXSlider: $('offsetXSlider'),
        offsetYSlider: $('offsetYSlider'),
        imageInput: $('imageInput'),
    };
}

// ================================================================
// 초기화
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
    initDom();
    bindEvents();
    lucide.createIcons();

    // cards.csv 로드 후 조회 DB 구축
    try {
        const db = await loadCardsFromCSV();
        buildCardsDB(db);
    } catch (err) {
        console.error('cards.csv 로드 실패:', err);
    }

    const saved = await loadFromDB();
    if (saved) {
        state.originalData = saved.originalData;
        state.cards = saved.cards;
        state.filteredCards = [...state.cards];
        renderUI();
    }
});

// ================================================================
// 이벤트 바인딩
// ================================================================
function bindEvents() {
    // 드롭존
    dom.dropZone.addEventListener('dragover', e => { e.preventDefault(); dom.dropZone.classList.add('drag-over'); });
    dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('drag-over'));
    dom.dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dom.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file?.name.endsWith('.json')) handleFileUpload(file);
    });
    dom.fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); });

    // 헤더 버튼
    dom.importBtn.onclick = () => dom.fileInput.click();
    dom.addCardBtn.onclick = addNewCard;
    dom.exportBtn.onclick = exportJSON;

    // 검색
    dom.searchInput.addEventListener('input', debounce(filterCards, 250));

    // 필터 칩
    document.querySelectorAll('.chip-list').forEach(group => {
        const groupName = group.dataset.filterGroup;
        const chips = group.querySelectorAll('.filter-chip');
        chips.forEach(chip => {
            chip.onclick = () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.filters[groupName] = chip.dataset.filterValue;
                // 희귀도 필터 비활성화 처리
                if (groupName === 'character') syncRarityFilterState();
                filterCards();
            };
        });
    });

    // 모달
    $('closeModal').onclick = closeModal;
    $('cancelEdit').onclick = closeModal;
    $('saveEdit').onclick = saveChanges;
    $('resetCardBtn').onclick = resetCurrentCard;
    $('uploadImageBtn').onclick = () => dom.imageInput.click();
    dom.imageInput.addEventListener('change', handleImageUpload); // 버그 수정

    // 슬라이더
    [dom.zoomSlider, dom.offsetXSlider, dom.offsetYSlider].forEach(s => {
        s.addEventListener('input', updateModalPreviewTransform);
    });

    // 페이지 이탈 경고
    window.addEventListener('beforeunload', e => {
        if (state.isDirty) { e.preventDefault(); e.returnValue = ''; }
    });
}

// ================================================================
// 파일 처리
// ================================================================
async function handleFileUpload(file) {
    showLoading(true);
    try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);

        if (data.format !== 'card_art_bundle') {
            alert('올바른 STS2 아트팩 형식이 아닙니다. (format: card_art_bundle 필요)');
            return;
        }

        state.originalData = data;
        // artpack의 type 필드는 'static'/'animated_gif' → artType 으로 rename하고 CSV 메타 병합
        state.cards = (data.overrides || []).map(enrichCard);
        state.filteredCards = [...state.cards];
        state.isDirty = false;

        await saveToDB({ originalData: state.originalData, cards: state.cards });
        renderUI();
    } catch (err) {
        console.error('파일 업로드 오류:', err);
        alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    } finally {
        showLoading(false);
    }
}

/**
 * artpack의 카드 객체에 CSV 메타데이터를 병합
 */
function enrichCard(raw) {
    const meta = findCardMeta(raw.source_path || '');
    return {
        ...raw,
        artType: raw.type || 'static', // artpack의 type (static/animated)
        // CSV 메타
        no: meta?.no ?? 9999,
        name_kr: meta?.name_kr ?? extractFallbackName(raw.source_path),
        name_en: meta?.name_en ?? '',
        character: meta?.character ?? inferCharacterFromPath(raw.source_path),
        cardType: meta?.cardType ?? inferTypeFromPath(raw.source_path),
        rarity: meta?.rarity ?? 'Common',
    };
}

function extractFallbackName(sourcePath) {
    if (!sourcePath) return 'Unknown';
    const file = sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'unknown';
    return file.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function inferCharacterFromPath(sourcePath) {
    const dir = (sourcePath || '').split('/').slice(-2, -1)[0]?.toLowerCase() || '';
    return DIR_TO_CHARACTER[dir] || 'Colorless';
}

function inferTypeFromPath(sourcePath) {
    const path = (sourcePath || '').toLowerCase();
    if (path.includes('attack')) return 'Attack';
    if (path.includes('power')) return 'Power';
    return 'Skill';
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = e => resolve(e.target.result);
        r.onerror = reject;
        r.readAsText(file);
    });
}

// ================================================================
// UI 렌더링
// ================================================================
function renderUI() {
    dom.dropZone.classList.add('hidden');
    dom.editorSection.classList.remove('hidden');
    dom.exportBtn.disabled = false;
    dom.addCardBtn.disabled = false;
    updateStats();
    renderCardGrid();
    lucide.createIcons();
}

function updateStats() {
    dom.cardCountEl.textContent = state.cards.length;
}

function renderCardGrid() {
    dom.cardGrid.innerHTML = '';

    // no 기준 오름차순 정렬
    const sorted = [...state.filteredCards].sort((a, b) => (a.no || 9999) - (b.no || 9999));

    const fragment = document.createDocumentFragment();
    sorted.forEach((card, idx) => {
        fragment.appendChild(createCardElement(card, idx));
    });
    dom.cardGrid.appendChild(fragment);
    initLazyLoading();
}

function createCardElement(card, index) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.onclick = () => openEditor(state.cards.indexOf(card));

    const { character, cardType, rarity, name_kr, name_en, no } = card;
    const assets = getCardAssets(character, cardType, rarity);

    // 커스텀 아트 있으면 base64 우선, 없으면 로컬 경로
    let artSrc = card.png_base64
        ? `data:image/png;base64,${card.png_base64}`
        : `source/img/cards/${character}/${(name_en || '').replace(/ /g, '_')}.png`;

    div.innerHTML = `
    <div class="sts2-card">
      <div class="layer layer-bg" style="background-image:url('${assets.bg}')"></div>
      <div class="layer layer-art">
        <img data-src="${artSrc}" alt="${name_en || name_kr}"
             class="lazy"
             onerror="this.onerror=null;this.src='source/img/card_base/273px-StS2_AncientCardHighlight.png'">
      </div>
      <div class="layer layer-frame" style="background-image:url('${assets.frame}')"></div>
      <div class="layer layer-banner" style="background-image:url('${assets.banner}')"></div>
      ${assets.orb ? `<div class="layer layer-orb" style="background-image:url('${assets.orb}')"></div>` : ''}
      <div class="layer layer-text">
        <div class="card-name-overlay">${name_kr || name_en}</div>
      </div>
    </div>
    <div class="card-meta">
      <div class="card-name">${name_kr || name_en} <span class="card-no">#${no}</span></div>
      <div class="card-path">${name_en || card.source_path?.split('/').pop() || ''}</div>
    </div>
  `;

    if (card.png_base64) {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = '수정됨';
        div.querySelector('.sts2-card').appendChild(badge);
    }

    return div;
}

function getCardAssets(character, cardType, rarity) {
    const p = 'source/img/card_base/273px-StS2_';
    const miscChars = MISC_CHARACTER;
    const isMisc = miscChars.has(character);

    if (isMisc) {
        const t = character === 'Status' ? 'Status' : character === 'Curse' ? 'Curse' : 'Quest';
        return { bg: `${p}Bg${t}.png`, frame: `${p}Frame${t}.png`, banner: `${p}Banner${t}.png`, orb: '' };
    }

    const rarityMap = { Starter: 'Common', Common: 'Common', Uncommon: 'Uncommon', Rare: 'Rare', Ancient: 'Rare', Misc: 'Uncommon' };
    const r = rarityMap[rarity] || 'Common';
    const c = character === 'Ancient' ? 'Colorless' : character;
    const t = ['Attack', 'Skill', 'Power'].includes(cardType) ? cardType : 'Skill';

    return {
        bg: `${p}Bg${t}${c}.png`,
        frame: `${p}Frame${t}${r}.png`,
        banner: `${p}Banner${r}.png`,
        orb: `${p}Card${c}Orb.png`,
    };
}

function initLazyLoading() {
    const imgs = document.querySelectorAll('img.lazy');
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                const img = e.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                obs.unobserve(img);
            }
        });
    }, { rootMargin: '300px' });
    imgs.forEach(img => obs.observe(img));
}

// ================================================================
// 필터링
// ================================================================
function syncRarityFilterState() {
    const rarityGroup = document.querySelector('.rarity-group');
    const isDisabled = RARITY_DISABLED_CHARS.has(state.filters.character);

    rarityGroup.classList.toggle('filter-locked', isDisabled);

    if (isDisabled) {
        // 희귀도 필터를 '전체'로 강제 초기화
        state.filters.rarity = 'all';
        rarityGroup.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        rarityGroup.querySelector('[data-filter-value="all"]')?.classList.add('active');
    }
}

function filterCards() {
    const query = dom.searchInput.value.toLowerCase();
    const { character, type, rarity } = state.filters;
    const rarityDisabled = RARITY_DISABLED_CHARS.has(character);

    state.filteredCards = state.cards.filter(card => {
        const c = card.character || '';
        const t = card.cardType || '';
        const r = card.rarity || '';

        // 캐릭터 필터
        const matchChar = character === 'all' ? true
            : character === 'misc' ? MISC_CHARACTER.has(c)
                : c === character;

        // 타입 필터
        const matchType = type === 'all' ? true
            : type === 'misc' ? MISC_TYPE.has(t)
                : t === type;

        // 희귀도 필터 (비활성화 시 무시)
        const matchRarity = rarityDisabled || rarity === 'all' ? true
            : rarity === 'misc' ? MISC_RARITY.has(r)
                : r === rarity;

        // 검색
        const matchSearch = !query
            || (card.name_kr || '').toLowerCase().includes(query)
            || (card.name_en || '').toLowerCase().includes(query)
            || (card.source_path || '').toLowerCase().includes(query);

        return matchChar && matchType && matchRarity && matchSearch;
    });

    renderCardGrid();
}

// ================================================================
// 카드 추가
// ================================================================
function addNewCard() {
    const path = prompt('추가할 카드의 원본 경로를 입력하세요:', 'res://images/packed/card_portraits/colorless/');
    if (!path) return;

    const meta = findCardMeta(path);
    const newCard = enrichCard({
        source_path: path,
        width: 1000,
        height: 760,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        type: 'static',
        png_base64: '',
    });

    state.cards.push(newCard);
    state.filteredCards = [...state.cards];
    state.isDirty = true;
    saveToDB({ originalData: state.originalData, cards: state.cards });
    renderCardGrid();
    updateStats();
    openEditor(state.cards.length - 1);
}

// ================================================================
// 모달 에디터
// ================================================================
function openEditor(cardIndex) {
    const card = state.cards[cardIndex];
    if (!card) return;

    state.editingCardIndex = cardIndex;

    const artSrc = card.png_base64
        ? `data:image/png;base64,${card.png_base64}`
        : '';

    dom.modalPreview.src = artSrc || 'source/img/card_base/273px-StS2_AncientCardHighlight.png';
    dom.modalPath.textContent = card.source_path || 'N/A';
    dom.modalSize.textContent = `${card.width || 1000} × ${card.height || 760}`;
    dom.modalNameKr.textContent = card.name_kr ? `${card.name_kr} (${card.name_en || ''})` : (card.name_en || '');

    dom.zoomSlider.value = 100;
    dom.offsetXSlider.value = 0;
    dom.offsetYSlider.value = 0;
    dom.modalPreview.style.transform = '';

    dom.editModal.classList.remove('hidden');
    lucide.createIcons();
}

function closeModal() {
    dom.editModal.classList.add('hidden');
    dom.imageInput.value = '';
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        dom.modalPreview.src = ev.target.result;
        state.isDirty = true;
    };
    reader.readAsDataURL(file);
}

function updateModalPreviewTransform() {
    const zoom = dom.zoomSlider.value / 100;
    const x = dom.offsetXSlider.value;
    const y = dom.offsetYSlider.value;
    dom.modalPreview.style.transform = `scale(${zoom}) translate(${x}px, ${y}px)`;
}

function saveChanges() {
    const card = state.cards[state.editingCardIndex];
    if (!card) return;

    const src = dom.modalPreview.src;
    if (src.startsWith('data:image')) {
        card.png_base64 = src.split(',')[1];
        card.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        state.isDirty = true;
        saveToDB({ originalData: state.originalData, cards: state.cards });
        renderCardGrid();
    }
    closeModal();
}

function resetCurrentCard() {
    if (!confirm('이 카드의 커스텀 이미지를 제거하시겠습니까?')) return;
    const card = state.cards[state.editingCardIndex];
    if (!card) return;
    card.png_base64 = '';
    state.isDirty = true;
    saveToDB({ originalData: state.originalData, cards: state.cards });
    renderCardGrid();
    closeModal();
}

// ================================================================
// 내보내기
// ================================================================
function exportJSON() {
    // artType → type 으로 복원 (artpack 포맷 유지)
    const overrides = state.cards.map(card => {
        const { artType, no, name_kr, name_en, character, cardType, rarity, ...rest } = card;
        return { ...rest, type: artType };
    });

    const exportData = {
        ...state.originalData,
        exported_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        count: overrides.length,
        overrides,
    };

    const blob = new Blob([JSON.stringify(exportData, null, '\t')], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artpack_${Date.now()}.cardartpack.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    state.isDirty = false;
    saveToDB({ originalData: state.originalData, cards: state.cards });
}

// ================================================================
// IndexedDB 영속화
// ================================================================
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('STS2CardArtEditor', 1);
        req.onupgradeneeded = e => {
            if (!e.target.result.objectStoreNames.contains('AppData')) {
                e.target.result.createObjectStore('AppData');
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = reject;
    });
}

async function saveToDB(value) {
    try {
        const db = await openDB();
        const tx = db.transaction('AppData', 'readwrite');
        tx.objectStore('AppData').put(value, 'currentState');
        return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    } catch (e) { console.warn('IndexedDB 저장 실패:', e); }
}

async function loadFromDB() {
    try {
        const db = await openDB();
        const tx = db.transaction('AppData', 'readonly');
        const req = tx.objectStore('AppData').get('currentState');
        return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = rej; });
    } catch (e) { console.warn('IndexedDB 로드 실패:', e); return null; }
}

// ================================================================
// 유틸
// ================================================================
function showLoading(show) {
    dom.appLoading.classList.toggle('hidden', !show);
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
