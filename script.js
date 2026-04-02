'use strict';

// ================================================================
// 상수 정의
// ================================================================

/** 카드 타입 한국어 표기 */
const CARD_TYPE_KO = {
    Attack: '공격',
    Skill: '스킬',
    Power: '파워',
    Status: '상태이상',
    Curse: '저주',
};

/** 카드 프레임 이미지 경로 접두사 */
const FRAME_PREFIX = 'source/img/card_frame/273px-StS2_';

/** 고유 프레임을 사용하는 특수 캐릭터 그룹 (Status, Curse 등) */
const SPECIAL_CHARACTERS = new Set(['Status', 'Curse', 'Event', 'Quest', 'Token']);

/** 필터에서 '기타(special)'로 분류되는 카드 타입 */
const SPECIAL_TYPES = new Set(['Status', 'Curse', 'Quest']);

/** 필터에서 '기타(special)'로 분류되는 희귀도 */
const SPECIAL_RARITIES = new Set(['Starter', 'Ancient', 'Misc']);

/** 선택 시 희귀도 필터를 비활성화하는 캐릭터 필터값 */
const RARITY_DISABLED_CHARS = new Set(['Ancient', 'special']);

/** 모달 토글 버튼 아이콘 (lucide.createIcons 재호출 없이 사용) */
const SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;

const DIR_TO_CHARACTER = {
    ironclad: 'Ironclad', silent: 'Silent', regent: 'Regent',
    necrobinder: 'Necrobinder', defect: 'Defect', colorless: 'Colorless',
    ancient: 'Ancient', status: 'Status', curse: 'Curse',
    event: 'Event', quest: 'Quest', token: 'Token',
};

// ================================================================
// 카드 DB
// ================================================================
let CARDS_DB = [];
const CHAR_NAME_MAP = new Map();
const NAME_MAP = new Map();

/** 특수문자 제거 후 소문자 조회 키 생성 */
function toKey(str) {
    if (!str) return '';
    let result = '';
    const lower = str.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
        const c = lower[i];
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) result += c;
    }
    return result;
}

/** cards.json으로부터 카드 DB 구축 */
async function fetchCardDatabase() {
    try {
        const response = await fetch('cards.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        CARDS_DB = await response.json();
        CARDS_DB.forEach(card => {
            const nk = toKey(card.name_en);
            if (!nk) return;
            const ck = `${toKey(card.character)}:${nk}`;
            if (!CHAR_NAME_MAP.has(ck)) CHAR_NAME_MAP.set(ck, card);
            if (!NAME_MAP.has(nk)) NAME_MAP.set(nk, card);
        });
    } catch (err) {
        console.error('Database load failed:', err);
    }
}

/** source_path로부터 카드 메타데이터 검색 */
function findCardMeta(sourcePath) {
    let path = sourcePath.startsWith('res://') ? sourcePath.substring(6) : sourcePath;
    const segs = path.split('/');
    const fullFileName = segs.pop() || '';
    const lastDot = fullFileName.lastIndexOf('.');
    const fileName = lastDot !== -1 ? fullFileName.substring(0, lastDot) : fullFileName;
    const dirName = (segs.pop() || '').toLowerCase();
    const character = DIR_TO_CHARACTER[dirName] || '';
    const fileKey = toKey(fileName);

    // 1차: 캐릭터 + 파일명 조합
    const combinedKey = `${toKey(character)}:${fileKey}`;
    if (CHAR_NAME_MAP.has(combinedKey)) return CHAR_NAME_MAP.get(combinedKey);

    // 2차: 파일명만
    if (NAME_MAP.has(fileKey)) return NAME_MAP.get(fileKey);

    // 3차: 숫자 접미사 제거 후 재시도 (ex. anger_2 → anger)
    let end = fileKey.length;
    while (end > 0 && fileKey[end - 1] >= '0' && fileKey[end - 1] <= '9') end--;
    const trimmedKey = fileKey.substring(0, end);
    if (trimmedKey && trimmedKey !== fileKey) {
        const ck2 = `${toKey(character)}:${trimmedKey}`;
        if (CHAR_NAME_MAP.has(ck2)) return CHAR_NAME_MAP.get(ck2);
        if (NAME_MAP.has(trimmedKey)) return NAME_MAP.get(trimmedKey);
    }
    return null;
}

// ================================================================
// 상태
// ================================================================
const state = {
    originalData: null,
    cards: [],
    editingCardIndex: -1,
    isDirty: false,
    filters: { character: 'all', type: 'all', rarity: 'all' },
};

// ================================================================
// DOM 참조
// ================================================================
const $ = id => document.getElementById(id);
let dom = {};

function initDom() {
    dom = {
        fileInput: $('fileInput'),
        editorSection: $('editorSection'),
        cardGrid: $('cardGrid'),
        searchInput: $('searchInput'),
        cardCountEl: $('cardCount'),
        exportBtn: $('exportBtn'),
        importBtn: $('importBtn'),
        unloadBtn: $('unloadBtn'),
        appLoading: $('appLoading'),
        editModal: $('editModal'),
        cardLargePreview: $('cardLargePreview'),
        modalSize: $('modalSize'),
        modalNameKr: $('modalNameKr'),
        zoomSlider: $('zoomSlider'),
        offsetXSlider: $('offsetXSlider'),
        offsetYSlider: $('offsetYSlider'),
        zoomVal: $('zoomVal'),
        offsetXVal: $('offsetXVal'),
        offsetYVal: $('offsetYVal'),
        imageInput: $('imageInput'),
        toggleOriginalBtn: $('toggleOriginalBtn'),
        // 모달 레이어 참조 추가
        modalLayerBg: $('modalLayerBg'),
        modalLayerFrame: $('modalLayerFrame'),
        modalLayerBanner: $('modalLayerBanner'),
        modalLayerType: $('modalLayerType'),
        modalLayerOrb: $('modalLayerOrb'),
        modalPreview: $('modalPreview'),
        modalPreviewOriginal: $('modalPreviewOriginal'),
        modalTextName: $('modalTextName'),
        modalTextType: $('modalTextType'),
    };
}

// ================================================================
// 카드 에셋 조회
// ================================================================

/** 캐릭터/타입/희귀도 조합에 맞는 카드 프레임 에셋 경로를 반환 */
function getCardAssets(character, cardType, rarity) {
    const p = FRAME_PREFIX;
    const rarityMap = { Starter: 'Common', Common: 'Common', Uncommon: 'Uncommon', Rare: 'Rare', Ancient: 'Rare', Misc: 'Uncommon' };
    const r = rarityMap[rarity] || 'Common';
    const t = ['Attack', 'Skill', 'Power'].includes(cardType) ? cardType : 'Skill';

    if (character === 'Status' || rarity === 'Status') {
        return { bg: `${p}BgSkillColorless.png`, frame: `${p}FrameStatus.png`, banner: `${p}BannerStatus.png`, orb: '', type: `${p}TypeStatus.png` };
    }

    if (character === 'Curse' || rarity === 'Curse') {
        return { bg: `${p}BgCurse.png`, frame: `${p}FrameCurse.png`, banner: `${p}BannerCurse.png`, orb: '', type: `${p}TypeCurse.png` };
    }

    if (character === 'Event' || rarity === 'Event') {
        const c = character === 'Event' ? 'Colorless' : character;
        return {
            bg: `${p}Bg${t}${c}.png`,
            frame: `${p}Frame${t}Event.png`,
            banner: `${p}BannerEvent.png`,
            orb: `${p}Card${c}Orb.png`,
            type: `${p}TypeEvent.png`
        };
    }

    if (character === 'Quest' || rarity === 'Quest') {
        return { bg: `${p}BgQuest.png`, frame: `${p}FrameQuest.png`, banner: `${p}BannerQuest.png`, orb: '', type: `${p}Type${r}.png` };
    }

    if (character === 'Token' || rarity === 'Token') {
        const c = 'Colorless';
        return {
            bg: `${p}Bg${t}${c}.png`,
            frame: `${p}Frame${t}${r}.png`,
            banner: `${p}Banner${r}.png`,
            orb: `${p}Card${c}Orb.png`,
            type: `${p}Type${r}.png`
        };
    }

    if (rarity === 'Ancient') {
        const c = character === 'Ancient' ? 'Colorless' : character;
        return {
            bg: `${p}AncientCardHighlight.png`,
            frame: `${p}AncientTextBg${t}.png`,
            banner: `${p}BannerAncient.png`,
            type: `${p}TypeAncient.png`,
            orb: `${p}Card${c}Orb.png`,
        };
    }

    const c = character === 'Ancient' ? 'Colorless' : character;
    return {
        bg: `${p}Bg${t}${c}.png`,
        frame: `${p}Frame${t}${r}.png`,
        banner: `${p}Banner${r}.png`,
        orb: `${p}Card${c}Orb.png`,
        type: `${p}Type${r}.png`,
    };
}

/** 카드 아트 이미지 src 반환 (커스텀 Blob URL 우선) */
function getCardArtSrc(card) {
    if (card?.blobUrl) return card.blobUrl;
    if (card?.png_base64 && !card.blobUrl) {
        // 백오프: 직접 호출되지 않았더라도 비상시를 위해 업데이트 시도 (드문 경우)
        updateCardBlobUrl(card);
        if (card.blobUrl) return card.blobUrl;
    }
    const character = (card?.character || 'colorless').toLowerCase();
    const nameEn = (card?.name_en || '').toLowerCase().replace(/ /g, '_');
    if (character === 'ancient' && nameEn === 'apparition') {
        return 'source/img/card_images/silent_apparition.webp';
    }
    return `source/img/card_images/${character}_${nameEn}.webp`;
}

/** base64 문자열을 Blob 객체로 변환 */
function base64ToBlob(base64, type = 'image/png') {
    if (!base64) return null;
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    return new Blob([array], { type });
}

/** 카드 객체의 Blob URL 갱신 및 관리 */
function updateCardBlobUrl(card) {
    if (card.blobUrl) {
        URL.revokeObjectURL(card.blobUrl);
        card.blobUrl = null;
    }
    if (card.png_base64) {
        const blob = base64ToBlob(card.png_base64);
        if (blob) card.blobUrl = URL.createObjectURL(blob);
    }
}

// ================================================================
// 공유 카드 렌더링 함수
// ================================================================

/**
 * 카드 프레임 레이어 HTML 생성 (그리드 카드 / 모달 공용)
 * @param {object} assets  getCardAssets() 반환값
 * @param {string} artContent  layer-art 내부에 들어갈 HTML 문자열
 */
function buildCardFrameHTML(assets, artContent) {
    const fallback = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';
    return `
        <img src="${assets.bg}"     class="layer layer-bg"     onerror="this.onerror=null;this.src='${fallback}'">
        <img src="${assets.frame}"  class="layer layer-frame"  onerror="this.onerror=null;this.src='${fallback}'">
        <img src="${assets.banner}" class="layer layer-banner" onerror="this.onerror=null;this.src='${fallback}'">
        <img src="${assets.type}"   class="layer layer-type"   onerror="this.onerror=null;this.src='${fallback}'">
        ${assets.orb ? `<img src="${assets.orb}" class="layer layer-orb" onerror="this.onerror=null;this.src='${fallback}'">` : ''}
        <div class="layer layer-art">${artContent}</div>
    `;
}

/**
 * 카드 이름·타입 텍스트 레이어 HTML 생성
 */
function buildCardTextHTML(card) {
    const typeKo = CARD_TYPE_KO[card.cardType] || card.cardType;
    return `
        <div class="layer layer-text">
            <div class="card-name-overlay">${card.name_kr || card.name_en}</div>
        </div>
        <div class="layer layer-text">
            <div class="card-type-overlay">${typeKo}</div>
        </div>
    `;
}

// ================================================================
// 초기화
// ================================================================

function getBaseSourcePath(card) {
    const charDir = Object.keys(DIR_TO_CHARACTER).find(k => DIR_TO_CHARACTER[k] === card.character) || 'colorless';
    return `res://images/packed/card_portraits/${charDir}/${(card.name_en || '').toLowerCase().replace(/ /g, '_')}.png`;
}

function initAllCards() {
    state.cards = CARDS_DB.map(card => {
        const isAncient = card.rarity === 'Ancient';
        return {
            source_path: getBaseSourcePath(card),
            type: 'static',
            artType: 'static',
            no: card.no,
            name_kr: card.name_kr,
            name_en: card.name_en,
            character: card.character,
            cardType: card.cardType,
            rarity: card.rarity,
            width: isAncient ? 606 : 1000,
            height: isAncient ? 852 : 760,
            png_base64: '',
            blobUrl: null,
        };
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initDom();
    bindEvents();
    lucide.createIcons();

    dom.appLoading.classList.remove('hidden');

    await fetchCardDatabase();
    initAllCards();

    const saved = await loadFromDB();
    if (saved) {
        state.originalData = saved.originalData;
        if (saved.cards) {
            saved.cards.forEach(savedCard => {
                let target = state.cards.find(c => c.source_path === savedCard.source_path);
                if (!target && savedCard.name_en) {
                    target = state.cards.find(c => c.name_en === savedCard.name_en);
                }
                if (target && savedCard.png_base64) {
                    target.png_base64 = savedCard.png_base64;
                    target.updated_at = savedCard.updated_at;
                    updateCardBlobUrl(target);
                }
            });
        }
    }

    // 이미지 전체 사전 로딩 (lazy 로딩 미사용)
    await preloadAllAssets();

    dom.appLoading.classList.add('hidden');
    renderUI();
});

/** 모든 카드 에셋과 아트 이미지를 미리 로드 */
async function preloadAllAssets() {
    const uniqueUrls = new Set();
    state.cards.forEach(card => {
        const assets = getCardAssets(card.character, card.cardType, card.rarity);
        Object.values(assets).forEach(url => { if (url) uniqueUrls.add(url); });
        uniqueUrls.add(getCardArtSrc(card));
        // 커스텀 이미지가 있더라도 원본 경로도 프리로드
        uniqueUrls.add(getCardArtSrc({ ...card, png_base64: '' }));
    });

    await Promise.all(Array.from(uniqueUrls).map(url =>
        new Promise(resolve => {
            const img = new Image();
            img.onload = img.onerror = resolve;
            img.src = url;
        })
    ));
}

// ================================================================
// 이벤트 바인딩
// ================================================================
function bindEvents() {
    dom.fileInput.addEventListener('change', e => {
        if (e.target.files[0]) handleFileUpload(e.target.files[0]);
    });

    dom.importBtn.onclick = () => dom.fileInput.click();
    dom.unloadBtn.onclick = unloadArtPack;
    dom.exportBtn.onclick = exportJSON;

    dom.searchInput.addEventListener('input', filterCards);

    document.querySelectorAll('.chip-list').forEach(group => {
        const groupName = group.dataset.filterGroup;
        group.querySelectorAll('.filter-chip').forEach(chip => {
            chip.onclick = () => {
                group.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.filters[groupName] = chip.dataset.filterValue;
                if (groupName === 'character') syncRarityFilterState();
                filterCards();
            };
        });
    });

    $('closeModal').onclick = closeModal;
    $('cancelEdit').onclick = closeModal;
    document.querySelector('.modal-overlay').addEventListener('click', closeModal);
    $('saveEdit').onclick = saveChanges;
    $('resetCardBtn').onclick = resetCurrentCard;
    $('uploadImageBtn').onclick = () => dom.imageInput.click();
    dom.imageInput.addEventListener('change', handleImageUpload);
    dom.toggleOriginalBtn.onclick = toggleOriginalView;

    [dom.zoomSlider, dom.offsetXSlider, dom.offsetYSlider].forEach(s =>
        s.addEventListener('input', updateModalPreviewTransform)
    );

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
        (data.overrides || []).forEach(ov => {
            const fileCard = enrichCard(ov);
            let target = state.cards.find(c => c.source_path === fileCard.source_path);
            if (!target && fileCard.name_en) {
                target = state.cards.find(c => c.name_en === fileCard.name_en);
            }
            if (target) {
                target.png_base64 = fileCard.png_base64;
                target.updated_at = fileCard.updated_at;
                target.artType = fileCard.artType;
                updateCardBlobUrl(target);
            }
        });

        state.isDirty = false;
        await saveToDB({ originalData: state.originalData, cards: state.cards });
        dom.cardGrid.innerHTML = '';
        renderUI();
    } catch (err) {
        console.error('파일 업로드 오류:', err);
        alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    } finally {
        showLoading(false);
    }
}

/** artpack 카드 객체에 DB 메타데이터를 병합 */
function enrichCard(raw) {
    const meta = findCardMeta(raw.source_path || '');
    const isAncient = meta?.rarity === 'Ancient';
    return {
        ...raw,
        artType: raw.type || 'static',
        no: meta?.no ?? 9999,
        name_kr: meta?.name_kr ?? extractFallbackName(raw.source_path),
        name_en: meta?.name_en ?? '',
        character: meta?.character ?? inferCharacterFromPath(raw.source_path),
        cardType: meta?.cardType ?? inferTypeFromPath(raw.source_path),
        rarity: meta?.rarity ?? 'Common',
        width: raw.width ?? (isAncient ? 606 : 1000),
        height: raw.height ?? (isAncient ? 852 : 760),
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
    dom.editorSection.classList.remove('hidden');
    dom.exportBtn.disabled = false;
    dom.unloadBtn.disabled = !state.originalData;
    updateStats();
    renderCardGrid();
    lucide.createIcons();
}

/** 수정된 카드 수 업데이트 */
function updateStats() {
    dom.cardCountEl.textContent = state.cards.filter(c => c.png_base64).length;
}

function renderCardGrid() {
    if (dom.cardGrid.children.length === 0) {
        state.cards.sort((a, b) => (a.no || 9999) - (b.no || 9999));
        const fragment = document.createDocumentFragment();
        state.cards.forEach(card => {
            card.domNode = createCardElement(card);
            fragment.appendChild(card.domNode);
        });
        dom.cardGrid.appendChild(fragment);
    }
    filterCards();
}

/** 카드 DOM을 새로 생성해 교체 (저장/리셋 후 호출) */
function replaceCardDOM(card) {
    if (!card.domNode) return;
    const isHidden = card.domNode.style.display === 'none';
    const newDom = createCardElement(card);
    newDom.style.display = isHidden ? 'none' : '';
    dom.cardGrid.replaceChild(newDom, card.domNode);
    card.domNode = newDom;
}

/** 카드 그리드 아이템 DOM 생성 */
function createCardElement(card) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.onclick = () => openEditor(state.cards.indexOf(card));

    const assets = getCardAssets(card.character, card.cardType, card.rarity);
    const artSrc = getCardArtSrc(card);
    const fallback = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';
    const artContent = `<img src="${artSrc}" alt="${card.name_en || card.name_kr}" onerror="this.onerror=null;this.src='${fallback}'">`;
    const rarityClass = card.rarity ? `rarity-${card.rarity.toLowerCase()}` : '';

    const cardEl = document.createElement('div');
    cardEl.className = `sts2-card ${rarityClass}`;
    cardEl.innerHTML = buildCardFrameHTML(assets, artContent) + buildCardTextHTML(card);

    if (card.png_base64) {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = '수정됨';
        cardEl.appendChild(badge);
    }

    div.appendChild(cardEl);
    return div;
}

// ================================================================
// 필터링
// ================================================================
function syncRarityFilterState() {
    const rarityGroup = document.querySelector('.rarity-group');
    const isDisabled = RARITY_DISABLED_CHARS.has(state.filters.character);
    rarityGroup.classList.toggle('filter-locked', isDisabled);
    if (isDisabled) {
        state.filters.rarity = 'all';
        rarityGroup.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        rarityGroup.querySelector('[data-filter-value="all"]')?.classList.add('active');
    }
}

function filterCards() {
    const query = dom.searchInput.value.toLowerCase();
    const { character, type, rarity } = state.filters;
    const rarityDisabled = RARITY_DISABLED_CHARS.has(character);

    state.cards.forEach(card => {
        const matchChar = character === 'all' ? true
            : character === 'Ancient' ? card.rarity === 'Ancient'
                : character === 'special' ? (SPECIAL_CHARACTERS.has(card.character) || card.rarity === 'Event')
                    : (card.character === character && card.rarity !== 'Event');

        const matchType = type === 'all' ? true
            : type === 'special' ? SPECIAL_TYPES.has(card.cardType)
                : card.cardType === type;

        const matchRarity = rarityDisabled || rarity === 'all' ? true
            : rarity === 'special' ? SPECIAL_RARITIES.has(card.rarity)
                : card.rarity === rarity;

        const matchSearch = !query
            || (card.name_kr || '').toLowerCase().includes(query)
            || (card.name_en || '').toLowerCase().includes(query)
            || (card.source_path || '').toLowerCase().includes(query);

        if (card.domNode) {
            card.domNode.style.display = (matchChar && matchType && matchRarity && matchSearch) ? '' : 'none';
        }
    });
}

// ================================================================
// 아트팩 해제
// ================================================================
async function unloadArtPack() {
    if (!confirm('현재 로드된 아트팩을 해제하고 초기 상태로 되돌리시겠습니까?')) return;

    showLoading(true);
    try {
        // 모든 Blob URL 해제
        state.cards.forEach(c => {
            if (c.blobUrl) URL.revokeObjectURL(c.blobUrl);
            c.blobUrl = null;
        });

        state.originalData = null;
        state.isDirty = false;

        // 초기 카드로 리셋
        initAllCards();

        // DB 캐시 초기화
        const db = await openDB();
        const tx = db.transaction('AppData', 'readwrite');
        tx.objectStore('AppData').delete('currentState');

        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

        // 그리드 초기화 (기존 DOM 노드 제거 후 다시 렌더링)
        dom.cardGrid.innerHTML = '';
        renderUI();
    } catch (err) {
        console.error('아트팩 해제 오류:', err);
    } finally {
        showLoading(false);
    }
}

// ================================================================
// 모달 에디터
// ================================================================
function openEditor(cardIndex) {
    const card = state.cards[cardIndex];
    if (!card) return;
    state.editingCardIndex = cardIndex;

    const fallbackSrc = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';
    const charPrefix = (card.character || '').toLowerCase();
    const defaultArtSrc = `source/img/card_images/${charPrefix}_${(card.name_en || '').toLowerCase().replace(/ /g, '_')}.webp`;
    const artSrc = card.png_base64 ? `data:image/png;base64,${card.png_base64}` : defaultArtSrc;

    const assets = getCardAssets(card.character, card.cardType, card.rarity);

    // 이미지 경로 업데이트 (src가 다를 때만 업데이트하여 캐시 활용 극대화)
    const updateSrc = (img, src) => {
        if (!src) { img.src = ''; return; }
        // 브라우저의 img.src는 항상 절대경로를 반환하므로, URL 객체로 변환하여 비교
        const absSrc = new URL(src, window.location.href).href;
        if (img.src !== absSrc) {
            img.src = src;
            img.onerror = () => { img.src = fallbackSrc; img.onerror = null; };
        }
    };

    updateSrc(dom.modalLayerBg, assets.bg);
    updateSrc(dom.modalLayerFrame, assets.frame);
    updateSrc(dom.modalLayerBanner, assets.banner);
    updateSrc(dom.modalLayerType, assets.type);

    if (assets.orb) {
        dom.modalLayerOrb.classList.remove('hidden');
        updateSrc(dom.modalLayerOrb, assets.orb);
    } else {
        dom.modalLayerOrb.classList.add('hidden');
    }

    updateSrc(dom.modalPreviewOriginal, defaultArtSrc);
    updateSrc(dom.modalPreview, artSrc);

    // 텍스트 업데이트
    dom.modalTextName.innerText = card.name_kr || card.name_en;
    dom.modalTextType.innerText = CARD_TYPE_KO[card.cardType] || card.cardType;

    dom.modalSize.textContent = `${card.width || 1000} × ${card.height || 760}`;
    dom.modalNameKr.textContent = card.name_kr ? `${card.name_kr} (${card.name_en || ''})` : (card.name_en || '');

    // 슬라이더 초기화
    dom.zoomSlider.value = 100;
    dom.offsetXSlider.value = 0;
    dom.offsetYSlider.value = 0;
    updateModalPreviewTransform();

    // 토글 버튼 초기 상태 (인라인 SVG로 lucide.createIcons 호출 불필요)
    dom.modalPreview.classList.remove('hidden');
    dom.modalPreviewOriginal.classList.add('hidden');
    dom.toggleOriginalBtn.innerHTML = `${SVG_EYE} 원본(Original) 대상 보기`;

    // 희귀도 클래스 적용
    dom.cardLargePreview.querySelector('.sts2-card').className = `sts2-card ${card.rarity ? `rarity-${card.rarity.toLowerCase()}` : ''}`;

    requestAnimationFrame(() => {
        dom.editModal.classList.remove('hidden');
    });
}

function closeModal() {
    dom.editModal.classList.add('hidden');
    dom.imageInput.value = '';
}

/** 원본/커스텀 이미지 토글 */
function toggleOriginalView() {
    const isShowingCustom = !dom.modalPreview.classList.contains('hidden');
    dom.modalPreview.classList.toggle('hidden', isShowingCustom);
    dom.modalPreviewOriginal.classList.toggle('hidden', !isShowingCustom);
    dom.toggleOriginalBtn.innerHTML = isShowingCustom
        ? `${SVG_IMAGE} 커스텀 대상 보기`
        : `${SVG_EYE} 원본(Original) 대상 보기`;
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
    const zoom = dom.zoomSlider.value;
    const x = dom.offsetXSlider.value;
    const y = dom.offsetYSlider.value;
    dom.zoomVal.setAttribute('data-value', `${zoom}%`);
    dom.offsetXVal.setAttribute('data-value', `${x}px`);
    dom.offsetYVal.setAttribute('data-value', `${y}px`);
    dom.modalPreview.style.transform = `scale(${zoom / 100}) translate(${x}px, ${y}px)`;
}

function saveChanges() {
    const card = state.cards[state.editingCardIndex];
    if (!card) return;
    const src = dom.modalPreview.src;
    if (src.startsWith('data:image')) {
        card.png_base64 = src.split(',')[1];
        card.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        state.isDirty = true;
        updateCardBlobUrl(card);
        saveToDB({ originalData: state.originalData, cards: state.cards });
        replaceCardDOM(card);
        updateStats();
    }
    closeModal();
}

function resetCurrentCard() {
    if (!confirm('이 카드의 커스텀 이미지를 제거하시겠습니까?')) return;
    const card = state.cards[state.editingCardIndex];
    if (!card) return;
    card.png_base64 = '';
    updateCardBlobUrl(card);
    state.isDirty = true;
    saveToDB({ originalData: state.originalData, cards: state.cards });
    replaceCardDOM(card);
    updateStats();
    closeModal();
}

// ================================================================
// 내보내기
// ================================================================
function exportJSON() {
    const modifiedCards = state.cards.filter(c => c.png_base64?.length > 0);
    const overrides = modifiedCards.map(({ artType, no, name_kr, name_en, character, cardType, rarity, domNode, ...rest }) => ({
        ...rest, type: artType,
    }));

    const exportData = {
        ...(state.originalData || { format: 'card_art_bundle' }),
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
        // domNode는 직렬화 불가 → 제외
        const safeValue = {
            ...value,
            cards: (value.cards || []).map(({ domNode, ...rest }) => rest),
        };
        tx.objectStore('AppData').put(safeValue, 'currentState');
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