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

    const combinedKey = `${toKey(character)}:${fileKey}`;
    if (CHAR_NAME_MAP.has(combinedKey)) return CHAR_NAME_MAP.get(combinedKey);

    if (NAME_MAP.has(fileKey)) return NAME_MAP.get(fileKey);

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
// 상태 관리
// ================================================================
const state = {
    originalData: null,
    cards: [],
    editingCardIndex: -1,
    isDirty: false,
    filters: { character: 'all', type: 'all', rarity: 'all' },
    adjustState: { zoom: 1.0, offsetX: 0.0, offsetY: 0.0, sourceDataUrl: null, sourceImage: null, isAnimated: false, backgroundColor: 'transparent' },
    pendingImportData: null,
    isDraggingScrollbar: false,
    isScrollUpdating: false,
    startY: 0,
    startScrollTop: 0,
    isSelectMode: false,
    selectedCards: new Set(),
    isDraggingSelection: false,
    dragStartIndex: -1,
    dragInitialSelection: new Set(),
    dragAction: null, // 'select' | 'deselect'
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
        resetAdjustBtn: $('resetAdjustBtn'),
        imageInput: $('imageInput'),
        toggleOriginalBtn: $('toggleOriginalBtn'),
        modalLayerBg: $('modalLayerBg'),
        modalLayerFrame: $('modalLayerFrame'),
        modalLayerBanner: $('modalLayerBanner'),
        modalLayerType: $('modalLayerType'),
        modalLayerOrb: $('modalLayerOrb'),
        modalPreview: $('modalPreview'),
        modalPreviewOriginal: $('modalPreviewOriginal'),
        modalTextName: $('modalTextName'),
        modalTextType: $('modalTextType'),
        contentArea: $('contentArea'),
        customScrollbar: $('customScrollbar'),
        scrollbarThumb: $('scrollbarThumb'),
        selectModeBtn: $('selectModeBtn'),
        selectionRemote: $('selectionRemote'),
        cancelSelectBtn: $('cancelSelectBtn'),
        selectAllBtn: $('selectAllBtn'),
        exportSelectedBtn: $('exportSelectedBtn'),
        selectedCount: $('selectedCount'),
        modalPreviewAnimated: $('modalPreviewAnimated'),
        bgColorPicker: $('bgColorPicker'),
        // 불러오기 확인 모달
        importChoiceModal: $('importChoiceModal'),
        importMergeBtn: $('importMergeBtn'),
        importResetBtn: $('importResetBtn'),
        cancelImportBtn: $('cancelImportBtn'),
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

/** 카드 객체의 Blob URL 갱신 및 관리 (GIF/PNG MIME 타입 분기) */
function updateCardBlobUrl(card) {
    if (card.blobUrl) {
        URL.revokeObjectURL(card.blobUrl);
        card.blobUrl = null;
    }
    if (card.png_base64) {
        const mimeType = card.art_mime || (card.artType === 'gif' ? 'image/gif' : 'image/png');
        const blob = base64ToBlob(card.png_base64, mimeType);
        if (blob) card.blobUrl = URL.createObjectURL(blob);
    }
}

// ================================================================
// 카드 렌더링
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
    const name = card.name_kr || card.name_en;
    const typeKo = CARD_TYPE_KO[card.cardType] || card.cardType;
    return `
        <div class="layer layer-text">
            <div class="card-name-overlay" data-text="${name}">${name}</div>
        </div>
        <div class="layer layer-text">
            <div class="card-type-overlay">${typeKo}</div>
        </div>
    `;
}

// ================================================================
// 초기화 프로세스
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
            source_png_base64: '',
            adjust_zoom: 1.0,
            adjust_offset_x: 0.0,
            adjust_offset_y: 0.0,
            background_color: 'transparent',
            display_mode: 'default',
            blobUrl: null,
        };
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initDom();
    bindEvents();
    lucide.createIcons();

    dom.appLoading.classList.remove('hidden');
    showLoading(true, '초기 에셋을 로딩 중입니다...');

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
                    target.source_png_base64 = savedCard.source_png_base64 || savedCard.png_base64;
                    target.adjust_zoom = savedCard.adjust_zoom ?? 1.0;
                    target.adjust_offset_x = savedCard.adjust_offset_x ?? 0.0;
                    target.adjust_offset_y = savedCard.adjust_offset_y ?? 0.0;
                    target.background_color = savedCard.background_color || 'transparent';
                    target.display_mode = savedCard.display_mode || 'default';
                    target.updated_at = savedCard.updated_at;
                    target.artType = savedCard.artType || 'static';
                    target.art_mime = savedCard.art_mime || (target.artType === 'gif' ? 'image/gif' : 'image/png');
                    target.gif_frames = savedCard.gif_frames || null;
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
    dom.exportBtn.onclick = () => exportJSON(false);
    dom.selectModeBtn.onclick = toggleSelectMode;
    dom.cancelSelectBtn.onclick = cancelSelectMode;
    dom.selectAllBtn.onclick = selectAllVisibleCards;
    dom.exportSelectedBtn.onclick = () => exportJSON(true);
    dom.importMergeBtn.onclick = () => {
        if (state.pendingImportData) processImport(state.pendingImportData, true);
        hideImportChoiceModal();
    };
    dom.importResetBtn.onclick = async () => {
        if (state.pendingImportData) {
            await resetToCleanState();
            processImport(state.pendingImportData, false);
        }
        hideImportChoiceModal();
    };
    dom.cancelImportBtn.onclick = hideImportChoiceModal;

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
    dom.resetAdjustBtn.onclick = resetAdjustValues;

    // 배경색 이벤트
    document.querySelectorAll('.color-chip').forEach(chip => {
        chip.onclick = () => {
            const color = chip.dataset.color;
            updateBackgroundColor(color);
            document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        };
    });
    dom.bgColorPicker.oninput = (e) => {
        updateBackgroundColor(e.target.value);
        document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
    };

    [dom.zoomSlider, dom.offsetXSlider, dom.offsetYSlider].forEach(s =>
        s.addEventListener('input', updateModalPreviewTransform)
    );

    window.addEventListener('beforeunload', e => {
        if (state.isDirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // 커스텀 스크롤바 이벤트
    dom.contentArea.addEventListener('scroll', () => {
        if (!state.isScrollUpdating) {
            state.isScrollUpdating = true;
            requestAnimationFrame(updateCustomScrollbar);
        }
    });
    window.addEventListener('resize', updateCustomScrollbar);
    dom.scrollbarThumb.addEventListener('mousedown', startScrollbarDrag);

    // 글로벌 마우스업 (범위 선택 및 스크롤바 드래그 공용)
    window.addEventListener('mouseup', () => {
        if (state.isDraggingSelection) stopDragSelection();
        if (state.isDraggingScrollbar) stopScrollbarDrag();
    });
}

// ================================================================
// 파일 처리
// ================================================================
async function handleFileUpload(file) {
    showLoading(true, '아트팩 데이터를 처리 중입니다...');
    try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        if (data.format !== 'card_art_bundle') {
            alert('올바른 STS2 아트팩 형식이 아닙니다. (format: card_art_bundle 필요)');
            return;
        }

        // 수정된 카드가 있는지 확인
        const hasModified = state.cards.some(c => c.png_base64);
        if (hasModified) {
            state.pendingImportData = data;
            showImportChoiceModal();
        } else {
            processImport(data);
        }
    } catch (err) {
        console.error('파일 업로드 오류:', err);
        alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    } finally {
        showLoading(false);
    }
}

/** 실제 데이터 적용 로직 */
async function processImport(data, isMerge = true) {
    showLoading(true, '데이터를 적용 중입니다...');
    try {
        state.originalData = data;
        (data.overrides || []).forEach(ov => {
            const fileCard = enrichCard(ov);
            let target = state.cards.find(c => c.source_path === fileCard.source_path);
            if (!target && fileCard.name_en) {
                target = state.cards.find(c => c.name_en === fileCard.name_en);
            }
            if (target) {
                // 덮어씌우기 모드이거나 기존에 수정본이 없으면 적용
                if (isMerge || !target.png_base64) {
                    target.png_base64 = fileCard.png_base64;
                    target.source_png_base64 = fileCard.source_png_base64 || fileCard.png_base64;
                    target.adjust_zoom = fileCard.adjust_zoom ?? 1.0;
                    target.adjust_offset_x = fileCard.adjust_offset_x ?? 0.0;
                    target.adjust_offset_y = fileCard.adjust_offset_y ?? 0.0;
                    target.display_mode = fileCard.display_mode || 'default';
                    target.updated_at = fileCard.updated_at;
                    target.artType = fileCard.artType;
                    target.art_mime = fileCard.art_mime || (fileCard.artType === 'gif' ? 'image/gif' : 'image/png');
                    target.gif_frames = fileCard.gif_frames || null;
                    updateCardBlobUrl(target);
                }
            }
        });

        state.isDirty = false;
        await saveToDB({ originalData: state.originalData, cards: state.cards });
        dom.cardGrid.innerHTML = '';
        renderUI();
    } catch (err) {
        console.error('불러오기 처리 중 오류:', err);
    } finally {
        showLoading(false);
        state.pendingImportData = null;
    }
}

function showImportChoiceModal() {
    dom.importChoiceModal.classList.remove('hidden');
    lucide.createIcons();
}

function hideImportChoiceModal() {
    dom.importChoiceModal.classList.add('hidden');
    state.pendingImportData = null;
}

/** 현재 모든 수정 내용을 버리고 깨끗한 상태로 준비 */
async function resetToCleanState() {
    state.cards.forEach(c => {
        if (c.blobUrl) URL.revokeObjectURL(c.blobUrl);
        c.blobUrl = null;
    });
    initAllCards();
    const db = await openDB();
    const tx = db.transaction('AppData', 'readwrite');
    tx.objectStore('AppData').delete('currentState');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

/** artpack 카드 객체에 DB 메타데이터를 병합 */
function enrichCard(raw) {
    const meta = findCardMeta(raw.source_path || '');
    const isAncient = meta?.rarity === 'Ancient';
    const detectedArtType = raw.type || 'static';
    const hasGifFrames = raw.frames && raw.frames.length > 0;
    // GIF 번들: frames 배열의 첫 번째 PNG를 표시용으로, frames 전체를 재추출용으로 보존
    const displayPng = hasGifFrames ? raw.frames[0].png_base64 : raw.png_base64;
    return {
        ...raw,
        artType: detectedArtType,
        art_mime: hasGifFrames ? 'image/gif' : 'image/png',
        gif_frames: hasGifFrames ? raw.frames : null,
        no: meta?.no ?? 9999,
        name_kr: meta?.name_kr ?? extractFallbackName(raw.source_path),
        name_en: meta?.name_en ?? '',
        character: meta?.character ?? inferCharacterFromPath(raw.source_path),
        cardType: meta?.cardType ?? inferTypeFromPath(raw.source_path),
        rarity: meta?.rarity ?? 'Common',
        width: raw.width ?? (isAncient ? 606 : 1000),
        height: raw.height ?? (isAncient ? 852 : 760),
        source_png_base64: raw.source_png_base64 || displayPng || '',
        png_base64: displayPng || '',
        adjust_zoom: raw.adjust_zoom ?? 1.0,
        adjust_offset_x: raw.adjust_offset_x ?? 0.0,
        adjust_offset_y: raw.adjust_offset_y ?? 0.0,
        display_mode: raw.display_mode || 'default',
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
    updateGlobalButtons();
    updateStats();
    renderCardGrid();
    lucide.createIcons();
    setTimeout(updateCustomScrollbar, 100);
}

/** 수정된 카드 수 업데이트 */
function updateStats() {
    const modifiedCount = state.cards.filter(c => c.png_base64).length;
    dom.cardCountEl.textContent = modifiedCount;
    updateGlobalButtons();
}

/** 버튼 활성화 상태를 현재 데이터 상태에 맞춰 업데이트 */
function updateGlobalButtons() {
    const hasModified = state.cards.some(c => c.png_base64);
    const hasArtpack = !!state.originalData;

    dom.exportBtn.disabled = !hasModified;
    dom.selectModeBtn.disabled = false;
    dom.unloadBtn.disabled = !hasArtpack && !hasModified;
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
    const index = state.cards.indexOf(card);
    div.className = 'card-item' + (state.selectedCards.has(index) ? ' selected' : '');

    // 단순 클릭(Click) 대신 마우스 이벤트를 조합하여 드래그 선택 구현
    div.addEventListener('mousedown', (e) => handleCardMouseDown(index, e));
    div.addEventListener('mouseenter', () => handleCardMouseEnter(index));
    div.addEventListener('click', (e) => {
        if (state.isSelectMode) {
            e.preventDefault();
            e.stopPropagation();
        } else {
            openEditor(index);
        }
    });

    const assets = getCardAssets(card.character, card.cardType, card.rarity);
    const artSrc = getCardArtSrc(card);
    const fallback = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';

    // 배경색 처리 (투명 보호)
    const bgColor = card.background_color && card.background_color !== 'transparent' ? card.background_color : '';

    const zoom = card.adjust_zoom || 1.0;
    const offX = card.adjust_offset_x || 0.0;
    const offY = card.adjust_offset_y || 0.0;

    const artStyle = `
        position: absolute;
        left: 50%;
        top: 50%;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: translate(-50%, -50%) translate(${offX * 50}%, ${offY * 50}%) scale(${zoom});
        transform-origin: center;
    `;

    const artContent = `
        <div class="layer-art-container" style="width:100%;height:100%;position:relative;background-color:${bgColor};overflow:hidden;">
            <img src="${artSrc}" alt="${card.name_en || card.name_kr}" 
                 style="${artStyle}"
                 onerror="this.onerror=null;this.src='${fallback}'">
        </div>
    `;
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

    // 필터링이 완료된 후 하단의 선택 버튼 상태 최신화
    if (state.isSelectMode) updateSelectionUI();
}

// ================================================================
// 아트팩 데이터 해제
// ================================================================
async function unloadArtPack() {
    const hasModified = state.cards.some(c => c.png_base64);
    const hasArtpack = !!state.originalData;

    let msg = '현재 로드된 아트팩을 해제하고 초기 상태로 되돌리시겠습니까?';
    if (!hasArtpack && hasModified) {
        msg = '모든 수정 내용을 초기화하고 처음 상태로 되돌리시겠습니까?';
    } else if (hasArtpack && hasModified) {
        msg = '로드된 아트팩과 모든 수정 내용을 삭제하고 초기화하시겠습니까?';
    }

    if (!confirm(msg)) return;

    showLoading(true, '초기 상태로 되돌리고 있습니다...');
    try {
        // 모든 Blob URL 해제
        state.cards.forEach(c => {
            if (c.blobUrl) URL.revokeObjectURL(c.blobUrl);
            c.blobUrl = null;
        });

        state.originalData = null;
        state.isDirty = false;

        // 초기 카드로 리셋 (png_base64 등 모든 수정 필드 클리어)
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
        console.error('초기화 오류:', err);
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

    // 소스 이미지: source_png_base64(원본 미조정 이미지) 우선 사용
    // GIF 카드의 경우 저장된 MIME 타입으로 올바른 data URL 재구성
    const sourceBase64 = card.source_png_base64 || card.png_base64;
    const artMime = card.art_mime || (card.artType === 'gif' ? 'image/gif' : 'image/png');
    const sourceSrc = sourceBase64 ? `data:${artMime};base64,${sourceBase64}` : defaultArtSrc;

    // adjustState 초기화: 카드에 저장된 조정값 복원
    state.adjustState = {
        zoom: card.adjust_zoom ?? 1.0,
        offsetX: card.adjust_offset_x ?? 0.0,
        offsetY: card.adjust_offset_y ?? 0.0,
        sourceDataUrl: sourceSrc,
        backgroundColor: card.background_color || 'transparent',
        isAnimated: card.artType === 'gif',
    };

    // UI 반영
    updateBackgroundColor(state.adjustState.backgroundColor, false);
    // ...나머지 기존 로직은 아래에서 계속

    const assets = getCardAssets(card.character, card.cardType, card.rarity);

    // 이미지 경로 업데이트 (src가 다를 때만 업데이트하여 캐시 활용 극대화)
    const updateSrc = (img, src) => {
        if (!src) { img.src = ''; return; }
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

    // 텍스트 업데이트
    const name = card.name_kr || card.name_en;
    dom.modalTextName.innerText = name;
    dom.modalTextName.setAttribute('data-text', name);
    dom.modalTextType.innerText = CARD_TYPE_KO[card.cardType] || card.cardType;

    dom.modalSize.textContent = `${card.width || 1000} × ${card.height || 760}`;
    dom.modalNameKr.textContent = card.name_kr ? `${card.name_kr} (${card.name_en || ''})` : (card.name_en || '');

    // 슬라이더: 저장된 조정값으로 초기화 (zoom: 1.0→100, offset: -1.0~1.0→-100~100)
    dom.zoomSlider.value = Math.round((card.adjust_zoom ?? 1.0) * 100);
    dom.offsetXSlider.value = Math.round((card.adjust_offset_x ?? 0.0) * 100);
    dom.offsetYSlider.value = Math.round((card.adjust_offset_y ?? 0.0) * 100);

    // 토글 버튼 초기 상태
    dom.modalPreview.classList.remove('hidden');
    dom.modalPreviewOriginal.classList.add('hidden');
    dom.toggleOriginalBtn.innerHTML = `${SVG_EYE} 원본(Original) 대상 보기`;

    // 희귀도 클래스 적용
    dom.cardLargePreview.querySelector('.sts2-card').className = `sts2-card ${card.rarity ? `rarity-${card.rarity.toLowerCase()}` : ''}`;

    requestAnimationFrame(async () => {
        dom.editModal.classList.remove('hidden');
        // 소스 이미지 로드 후 메모리에 캐싱하여 실시간 렌더링 시 점멸 방지
        try {
            state.adjustState.sourceDataUrl = sourceSrc;
            state.adjustState.sourceImage = await loadSourceImage(sourceSrc);
            updateModalPreviewTransform();
        } catch (err) {
            console.warn('소스 이미지 로드 실패, 기본 이미지 사용:', err);
            state.adjustState.sourceDataUrl = defaultArtSrc;
            state.adjustState.sourceImage = await loadSourceImage(defaultArtSrc);
            updateModalPreviewTransform();
        }
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
    reader.onload = async ev => {
        const dataUrl = ev.target.result;
        const isAnimated = file.type === 'image/gif' || file.type === 'image/webp' || file.name.toLowerCase().endsWith('.gif');

        // 새 이미지 업로드 시 조정값을 초기화하고 원본 소스를 메모리에 캐싱
        state.adjustState.sourceDataUrl = dataUrl;
        state.adjustState.isAnimated = isAnimated;
        state.adjustState.sourceImage = await loadSourceImage(dataUrl);
        state.adjustState.zoom = 1.0;
        state.adjustState.offsetX = 0.0;
        state.adjustState.offsetY = 0.0;
        dom.zoomSlider.value = 100;
        dom.offsetXSlider.value = 0;
        dom.offsetYSlider.value = 0;
        state.isDirty = true;
        // 캐싱된 이미지를 사용하여 즉시 미리보기 갱신
        updateModalPreviewTransform();
    };
    reader.readAsDataURL(file);
}

function updateBackgroundColor(color, markDirty = true) {
    state.adjustState.backgroundColor = color;
    const isTransparent = color === 'transparent';

    const layerArt = dom.cardLargePreview.querySelector('.layer-art');
    if (layerArt) {
        layerArt.style.backgroundColor = isTransparent ? '' : color;
        // 체커보드 패턴 (투명일 때만 노출)
        if (isTransparent) {
            layerArt.classList.add('checkerboard');
        } else {
            layerArt.classList.remove('checkerboard');
        }
    }

    if (markDirty) state.isDirty = true;

    // 만약 캔버스 모드라면 즉시 재렌더링
    if (!state.adjustState.isAnimated) {
        updateModalPreviewTransform();
    }
}

/**
 * 캐싱된 이미지를 사용하여 Canvas에 미세조정 결과를 즉시 렌더링 (점멸 방지)
 */
function updateModalPreviewTransform() {
    const zoomRaw = parseInt(dom.zoomSlider.value, 10);
    const offsetXRaw = parseInt(dom.offsetXSlider.value, 10);
    const offsetYRaw = parseInt(dom.offsetYSlider.value, 10);

    const zoom = zoomRaw / 100.0;
    const offsetX = offsetXRaw / 100.0;
    const offsetY = offsetYRaw / 100.0;

    state.adjustState.zoom = zoom;
    state.adjustState.offsetX = offsetX;
    state.adjustState.offsetY = offsetY;

    dom.zoomVal.setAttribute('data-value', `${zoomRaw}%`);
    dom.offsetXVal.setAttribute('data-value', `${offsetXRaw}`);
    dom.offsetYVal.setAttribute('data-value', `${offsetYRaw}`);

    const img = state.adjustState.sourceImage;
    if (!img) return;

    const card = state.cards[state.editingCardIndex];
    const targetW = card?.width || 1000;
    const targetH = card?.height || 760;

    // 1. 애니메이션 모드 (GIF 등)
    if (state.adjustState.isAnimated) {
        dom.modalPreview.classList.add('hidden');
        dom.modalPreviewAnimated.classList.remove('hidden');

        const animImg = dom.modalPreviewAnimated;
        animImg.src = state.adjustState.sourceDataUrl;

        // 그리드와 동일한 퍼센트 기반 수식으로 통일 (object-fit: cover 가 전제)
        // transform: translate(-50%, -50%) 가 기본 정렬이고, 추가 이동은 translate(X%, Y%)로 처리
        animImg.style.width = '100%';
        animImg.style.height = '100%';
        animImg.style.objectFit = 'cover';
        animImg.style.position = 'absolute';
        animImg.style.left = '50%';
        animImg.style.top = '50%';
        animImg.style.transform = `translate(-50%, -50%) translate(${offsetX * 50}%, ${offsetY * 50}%) scale(${zoom})`;
        animImg.style.transformOrigin = 'center';
        return;
    }

    // 2. 정적 이미지 모드 (Canvas)
    dom.modalPreviewAnimated.classList.add('hidden');
    dom.modalPreview.classList.remove('hidden');

    const canvas = dom.modalPreview;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: true });

    const scaleX = targetW / img.naturalWidth;
    const scaleY = targetH / img.naturalHeight;
    const scaleFactor = Math.max(scaleX, scaleY) * zoom;

    const resizedW = Math.round(img.naturalWidth * scaleFactor);
    const resizedH = Math.round(img.naturalHeight * scaleFactor);

    const extraW = resizedW - targetW;
    const extraH = resizedH - targetH;

    const clampedOffX = Math.max(-1.0, Math.min(1.0, offsetX));
    const clampedOffY = Math.max(-1.0, Math.min(1.0, offsetY));
    const cropX = Math.round(extraW * 0.5 + clampedOffX * extraW * 0.5);
    const cropY = Math.round(extraH * 0.5 + clampedOffY * extraH * 0.5);

    ctx.clearRect(0, 0, targetW, targetH);

    // 배경색 채우기
    if (state.adjustState.backgroundColor !== 'transparent') {
        ctx.fillStyle = state.adjustState.backgroundColor;
        ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.drawImage(img, -cropX, -cropY, resizedW, resizedH);
}

/**
 * 카드 아트(GIF 포함)를 캔버스에 렌더링하여 PNG base64로 변환
 * GIF 애니메이션은 현재(첫) 프레임을 캡처하여 모드 export용 PNG로 사용
 */
async function renderCardToPngBase64(card) {
    const mimeType = card.art_mime || (card.artType === 'gif' ? 'image/gif' : 'image/png');
    const dataUrl = `data:${mimeType};base64,${card.png_base64}`;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const targetW = card.width || 1000;
            const targetH = card.height || 760;
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d', { alpha: true });
            const zoom = card.adjust_zoom || 1.0;
            const offsetX = card.adjust_offset_x || 0.0;
            const offsetY = card.adjust_offset_y || 0.0;
            const scaleX = targetW / img.naturalWidth;
            const scaleY = targetH / img.naturalHeight;
            const scaleFactor = Math.max(scaleX, scaleY) * zoom;
            const resizedW = Math.round(img.naturalWidth * scaleFactor);
            const resizedH = Math.round(img.naturalHeight * scaleFactor);
            const extraW = resizedW - targetW;
            const extraH = resizedH - targetH;
            const clampedOffX = Math.max(-1.0, Math.min(1.0, offsetX));
            const clampedOffY = Math.max(-1.0, Math.min(1.0, offsetY));
            const cropX = Math.round(extraW * 0.5 + clampedOffX * extraW * 0.5);
            const cropY = Math.round(extraH * 0.5 + clampedOffY * extraH * 0.5);
            ctx.clearRect(0, 0, targetW, targetH);
            if (card.background_color && card.background_color !== 'transparent') {
                ctx.fillStyle = card.background_color;
                ctx.fillRect(0, 0, targetW, targetH);
            }
            ctx.drawImage(img, -cropX, -cropY, resizedW, resizedH);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => resolve('');
        img.src = dataUrl;
    });
}

async function saveChanges() {
    const card = state.cards[state.editingCardIndex];
    if (!card) return;

    // 저장 시점에 애니메이션 여부에 따라 처리 분기
    if (state.adjustState.isAnimated) {
        const sourceDataUrl = state.adjustState.sourceDataUrl;
        // MIME 타입 추출: data:[mime];base64,...
        const colonIdx = sourceDataUrl.indexOf(':');
        const semicolonIdx = sourceDataUrl.indexOf(';');
        const gifMime = (colonIdx !== -1 && semicolonIdx !== -1 && semicolonIdx > colonIdx)
            ? sourceDataUrl.slice(colonIdx + 1, semicolonIdx)
            : 'image/gif';
        card.png_base64 = sourceDataUrl.split(',')[1]; // GIF 원본 바이트
        card.art_mime = gifMime;
        card.artType = 'gif';
        // GIF의 현재(첫) 프레임을 PNG로 캡처하여 모드 export용 frames 배열에 저장
        try {
            const pngBase64 = await renderCardToPngBase64(card);
            card.gif_frames = pngBase64 ? [{ png_base64: pngBase64, delay: 0.1 }] : null;
        } catch (e) {
            console.warn('GIF 프레임 PNG 캡처 실패:', e);
            card.gif_frames = null;
        }
    } else {
        const src = dom.modalPreview.toDataURL('image/png');
        card.png_base64 = src.split(',')[1];
        card.artType = 'static';
        card.art_mime = 'image/png';
        card.gif_frames = null;
    }

    // 원본 소스 이미지 보존 (재조정 가능하도록) — MIME 타입 포함 유지
    if (state.adjustState.sourceDataUrl?.startsWith('data:image')) {
        card.source_png_base64 = state.adjustState.sourceDataUrl.split(',')[1];
    } else {
        card.source_png_base64 = card.png_base64;
    }

    // 조정값 저장
    card.adjust_zoom = state.adjustState.zoom;
    card.adjust_offset_x = state.adjustState.offsetX;
    card.adjust_offset_y = state.adjustState.offsetY;
    card.background_color = state.adjustState.backgroundColor;
    card.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    state.isDirty = true;

    updateCardBlobUrl(card);
    saveToDB({ originalData: state.originalData, cards: state.cards });
    replaceCardDOM(card);
    updateStats();
    closeModal();
}

function resetCurrentCard() {
    if (!confirm('이 카드의 커스텀 이미지를 제거하시겠습니까?')) return;
    const card = state.cards[state.editingCardIndex];
    if (!card) return;
    card.png_base64 = '';
    card.source_png_base64 = '';
    card.adjust_zoom = 1.0;
    card.adjust_offset_x = 0.0;
    card.adjust_offset_y = 0.0;
    updateCardBlobUrl(card);
    state.isDirty = true;
    saveToDB({ originalData: state.originalData, cards: state.cards });
    replaceCardDOM(card);
    updateStats();
    closeModal();
}

/** 조정 슬라이더를 기본값으로 리셋 (모드의 Reset 버튼과 동일) */
function resetAdjustValues() {
    dom.zoomSlider.value = 100;
    dom.offsetXSlider.value = 0;
    dom.offsetYSlider.value = 0;
    updateModalPreviewTransform();
}

// ================================================================
// 선택 모드 리모콘
// ================================================================
function toggleSelectMode() {
    state.isSelectMode = !state.isSelectMode;
    document.body.classList.toggle('select-mode', state.isSelectMode);

    if (state.isSelectMode) {
        dom.selectionRemote.classList.remove('hidden');
        updateSelectionUI(); // 진입 시 버튼 상태 초기화
    } else {
        cancelSelectMode();
    }
}

function cancelSelectMode() {
    state.isSelectMode = false;
    document.body.classList.remove('select-mode');
    dom.selectionRemote.classList.add('hidden');
    state.selectedCards.clear();
    updateSelectionUI();
}

function handleCardMouseDown(index, e) {
    if (!state.isSelectMode) return;

    // 마우스 왼쪽 버튼 클릭 시에만 활성화
    if (e.button !== 0) return;

    state.isDraggingSelection = true;
    state.dragStartIndex = index;
    state.dragInitialSelection = new Set(state.selectedCards);

    // 드래그 행동 결정: 이미 선택되어 있었다면 이번 드래그는 '해제' 모드
    if (state.selectedCards.has(index)) {
        state.dragAction = 'deselect';
        state.selectedCards.delete(index);
    } else {
        state.dragAction = 'select';
        state.selectedCards.add(index);
    }

    updateSelectionUI();

    // 드래그 중 텍스트 선택 방지
    e.preventDefault();
}

function handleCardMouseEnter(index) {
    if (!state.isSelectMode || !state.isDraggingSelection) return;

    updateSelectionRange(state.dragStartIndex, index);
}

function stopDragSelection() {
    state.isDraggingSelection = false;
    state.dragStartIndex = -1;
    state.dragInitialSelection.clear();
    state.dragAction = null;
}

/**
 * 시작 인덱스와 끝 인덱스 사이의 '보이는' 카드들을 모두 선택 상태로 업데이트
 * Shift-Click과 유사한 동작 수행
 */
function updateSelectionRange(startIdx, endIdx) {
    // 가시적인 모든 카드의 인덱스를 순서대로 추출
    const visibleCardIndices = state.cards
        .map((card, i) => ({ card, i }))
        .filter(item => item.card.domNode && item.card.domNode.style.display !== 'none')
        .map(item => item.i);

    const startPos = visibleCardIndices.indexOf(startIdx);
    const endPos = visibleCardIndices.indexOf(endIdx);

    if (startPos === -1 || endPos === -1) return;

    const [realStart, realEnd] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];

    // 이번 드래그에 해당하는 범위
    const currentRangeIndices = new Set(visibleCardIndices.slice(realStart, realEnd + 1));

    // 드래그 시작 전의 상태에서 현재 범위를 추가하거나 제거 (dragAction 에 따름)
    const newSelection = new Set(state.dragInitialSelection);

    currentRangeIndices.forEach(idx => {
        if (state.dragAction === 'deselect') {
            newSelection.delete(idx);
        } else {
            newSelection.add(idx);
        }
    });

    state.selectedCards = newSelection;
    updateSelectionUI();
}

function handleCardClick(index, div) {
    // mousedown/mouseenter 기반 로직으로 대체되었으므로 legacy 대응만 유지
    if (!state.isSelectMode) {
        openEditor(index);
    }
}

function selectAllVisibleCards() {
    const visibleIndices = state.cards
        .map((card, i) => ({ card, i }))
        .filter(item => item.card.domNode && item.card.domNode.style.display !== 'none')
        .map(item => item.i);

    const isAllSelected = visibleIndices.length > 0 && visibleIndices.every(idx => state.selectedCards.has(idx));

    if (isAllSelected) {
        // 이미 전체 선택된 상태라면 -> 전체 해제
        visibleIndices.forEach(idx => state.selectedCards.delete(idx));
    } else {
        // 아니면 -> 전체 선택
        visibleIndices.forEach(idx => state.selectedCards.add(idx));
    }

    updateSelectionUI();
}

function updateSelectionUI() {
    const count = state.selectedCards.size;
    dom.selectedCount.textContent = count;
    dom.exportSelectedBtn.disabled = count === 0;

    // 가시적인 모든 카드의 인덱스와 그 선택 상태 파악
    const visibleIndices = state.cards
        .map((card, i) => ({ card, i }))
        .filter(item => item.card.domNode && item.card.domNode.style.display !== 'none')
        .map(item => item.i);

    const isAllSelected = visibleIndices.length > 0 && visibleIndices.every(idx => state.selectedCards.has(idx));

    // 하단 버튼이 전체 선택인지 전체 선택 해제인지 동적 전환
    if (isAllSelected) {
        dom.selectAllBtn.innerHTML = `<i data-lucide="minus-square"></i> 현재 목록 전체 선택 해제`;
    } else {
        dom.selectAllBtn.innerHTML = `<i data-lucide="check-square"></i> 현재 목록 전체 선택`;
    }

    // Lucide 아이콘 재생성 (버튼 컨테이너의 아이콘만 재생성)
    if (window.lucide) lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        icons: undefined
    }, dom.selectAllBtn);

    // UI 동기화 방어 로직 (개별 카드 클래스 갱신)
    state.cards.forEach((card, index) => {
        if (card.domNode) {
            if (state.selectedCards.has(index)) {
                card.domNode.classList.add('selected');
            } else {
                card.domNode.classList.remove('selected');
            }
        }
    });
}

// ================================================================
// 내보내기
// ================================================================

/**
 * GIF 카드의 frames 배열을 구성:
 * 저장된 gif_frames가 있으면 사용, 없으면 png_base64에서 PNG 프레임 생성
 */
async function buildGifFrames(card) {
    if (card.gif_frames && card.gif_frames.length > 0) {
        return card.gif_frames;
    }
    // gif_frames가 없는 경우 (구 버전 저장 데이터 등) 실시간 캡처
    try {
        const pngBase64 = await renderCardToPngBase64(card);
        return pngBase64 ? [{ png_base64: pngBase64, delay: 0.1 }] : [];
    } catch (e) {
        console.warn('GIF 프레임 생성 실패:', e);
        return [];
    }
}

async function exportJSON(selectedOnly = false) {
    let targetCards = state.cards;

    if (selectedOnly) {
        targetCards = state.cards.filter((_, index) => state.selectedCards.has(index));
    }

    const modifiedCards = targetCards.filter(c => c.png_base64?.length > 0);

    if (modifiedCards.length === 0) {
        alert(selectedOnly ? '선택하신 카드 중 수정된 카드가 없습니다.' : '수정된 카드가 없습니다.');
        return;
    }

    // GIF 프레임 생성이 비동기이므로 Promise.all로 처리
    const overrides = await Promise.all(modifiedCards.map(async c => {
        const obj = {
            source_path: c.source_path,
            width: c.width,
            height: c.height,
            updated_at: c.updated_at || new Date().toISOString().slice(0, 19),
            type: c.artType || 'static',
            display_mode: c.display_mode || 'default',
        };

        if (c.artType === 'gif') {
            // GIF: 각 프레임을 PNG로 변환하여 frames 배열로 추출 (모드 호환 형식)
            const frames = await buildGifFrames(c);
            if (frames.length > 0) {
                obj.frames = frames;
            } else {
                // frames 생성 실패 시 정적으로 폴백
                obj.png_base64 = c.png_base64;
            }
        } else {
            // 정적 이미지: 모드는 최상위 png_base64만 사용 (frames 불필요)
            obj.png_base64 = c.png_base64;
        }

        // 에디터 재수정을 위한 커스텀 필드 (모드에서는 무시됨)
        if (c.source_png_base64) obj.source_png_base64 = c.source_png_base64;
        if (c.art_mime) obj.art_mime = c.art_mime;
        if (c.adjust_zoom !== undefined) obj.adjust_zoom = c.adjust_zoom;
        if (c.adjust_offset_x !== undefined) obj.adjust_offset_x = c.adjust_offset_x;
        if (c.adjust_offset_y !== undefined) obj.adjust_offset_y = c.adjust_offset_y;
        if (c.background_color && c.background_color !== 'transparent') {
            obj.background_color = c.background_color;
        }
        return obj;
    }));

    const baseData = state.originalData || { format: 'card_art_bundle', version: 1 };
    const exportData = {
        ...baseData,
        format: 'card_art_bundle',
        version: baseData.version || 1,
        exported_at: new Date().toISOString().slice(0, 19),
        count: overrides.length,
        overrides,
    };

    const now = new Date();
    const dateStr = now.getFullYear().toString() +
        (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0') +
        now.getHours().toString().padStart(2, '0') +
        now.getMinutes().toString().padStart(2, '0') +
        now.getSeconds().toString().padStart(2, '0');

    const blob = new Blob([JSON.stringify(exportData, null, '\t')], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artpack_${overrides.length}_${dateStr}.cardartpack.json`;
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
/** 로딩 레이어 표시 제어 (메시지 포함) */
function showLoading(show, message = '에셋 로딩 중...') {
    const textEl = document.getElementById('loadingText');
    if (textEl) textEl.textContent = message;
    dom.appLoading.classList.toggle('hidden', !show);
}

/** 이미지 URL로부터 Image 객체를 생성하여 Promise 반환 */
function loadSourceImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/** 커스텀 스크롤바 위치 업데이트 (rAF 내부에서 실행 권장) */
function updateCustomScrollbar() {
    const { contentArea, scrollbarThumb, customScrollbar } = dom;
    if (!contentArea || !scrollbarThumb || !customScrollbar) {
        state.isScrollUpdating = false;
        return;
    }

    const scrollHeight = contentArea.scrollHeight;
    const clientHeight = contentArea.clientHeight;
    const scrollTop = contentArea.scrollTop;

    if (scrollHeight <= clientHeight + 1) {
        customScrollbar.style.display = 'none';
        state.isScrollUpdating = false;
        return;
    }
    customScrollbar.style.display = 'flex';

    const trackHeight = customScrollbar.clientHeight;
    const thumbHeight = scrollbarThumb.clientHeight;
    const maxScroll = scrollHeight - clientHeight;
    const maxThumbMove = trackHeight - thumbHeight;

    const scrollRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));
    const thumbTop = scrollRatio * maxThumbMove;

    // GPU 가속을 위해 top 대신 transform: translate3d 사용
    scrollbarThumb.style.transform = `translate3d(-50%, ${thumbTop}px, 0)`;

    state.isScrollUpdating = false;
}

/** 스크롤바 드래그 시작 */
function startScrollbarDrag(e) {
    state.isDraggingScrollbar = true;
    state.startY = e.clientY;
    state.startScrollTop = dom.contentArea.scrollTop;

    document.body.classList.add('dragging');

    window.addEventListener('mousemove', handleScrollbarDrag);
    window.addEventListener('mouseup', stopScrollbarDrag);

    e.preventDefault(); // 텍스트 선택 방지
}

/** 스크롤바 드래그 진행 */
function handleScrollbarDrag(e) {
    if (!state.isDraggingScrollbar) return;

    const deltaY = e.clientY - state.startY;
    const { contentArea, customScrollbar, scrollbarThumb } = dom;

    const trackHeight = customScrollbar.clientHeight;
    const thumbHeight = scrollbarThumb.clientHeight;
    const maxThumbMove = trackHeight - thumbHeight;
    const maxScroll = contentArea.scrollHeight - contentArea.clientHeight;

    if (maxThumbMove <= 0 || maxScroll <= 0) return;

    const scrollDelta = (deltaY / maxThumbMove) * maxScroll;
    contentArea.scrollTop = state.startScrollTop + scrollDelta;
}

/** 스크롤바 드래그 종료 */
function stopScrollbarDrag() {
    state.isDraggingScrollbar = false;
    document.body.classList.remove('dragging');

    window.removeEventListener('mousemove', handleScrollbarDrag);
    window.removeEventListener('mouseup', stopScrollbarDrag);
}
