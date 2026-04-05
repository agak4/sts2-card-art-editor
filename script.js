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
    filters: { character: 'Ironclad', type: 'all', rarity: 'all' },
    showModifiedBadge: true,
    showOnlyModified: false,
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
    isDraggingModalScrollbar: false,
    isModalScrollUpdating: false,
    modalStartY: 0,
    modalStartScrollTop: 0,
    patchnotes: null,
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
        exportImageBtn: $('exportImageBtn'),
        selectedCount: $('selectedCount'),
        modalPreviewAnimated: $('modalPreviewAnimated'),
        bgColorPicker: $('bgColorPicker'),
        // 불러오기 확인 모달
        importChoiceModal: $('importChoiceModal'),
        importMergeBtn: $('importMergeBtn'),
        importResetBtn: $('importResetBtn'),
        cancelImportBtn: $('cancelImportBtn'),
        downloadImageBtn: $('downloadImageBtn'),
        badgeToggle: $('badgeToggle'),
        onlyModifiedToggle: $('onlyModifiedToggle'),
        // 패치노트 전용
        patchnotesBtn: $('patchnotesBtn'),
        patchnotesModal: $('patchnotesModal'),
        patchnotesContent: $('patchnotesContent'),
        closePatchnotes: $('closePatchnotes'),
        confirmPatchnotes: $('confirmPatchnotes'),
        modalScrollbar: $('modalScrollbar'),
        modalScrollbarThumb: $('modalScrollbarThumb'),
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

/**
 * 캔버스 데이터를 고효율압축 PNG Base64로 추출 (Godot/libpng 급 압축)
 */
function compressCanvasToPngBase64(canvas) {
    if (!window.UPNG || !window.pako) {
        return canvas.toDataURL('image/png').split(',')[1];
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pngBuffer = UPNG.encode([imgData.data.buffer], canvas.width, canvas.height, 0);
    const bytes = new Uint8Array(pngBuffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/** base64 문자열을 Blob 객체로 변환 */
function base64ToBlob(base64, type = 'image/webp') {
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
    if (card.frameBlobUrls) {
        card.frameBlobUrls.forEach(url => URL.revokeObjectURL(url));
        card.frameBlobUrls = null;
    }

    if (card.artType === 'gif' && card.gif_frames && card.gif_frames.length > 0) {
        card.frameBlobUrls = card.gif_frames.map(f => {
            const blob = base64ToBlob(f.png_base64, 'image/png');
            return URL.createObjectURL(blob);
        });
        card.blobUrl = card.frameBlobUrls[0];
    } else if (card.png_base64) {
        let actualMime = card.art_mime || 'image/png';
        if (card.png_base64.startsWith('iVBORw0KGgo')) actualMime = 'image/png';
        else if (card.png_base64.startsWith('UklGR')) actualMime = 'image/webp';
        else if (card.png_base64.startsWith('R0lGOD')) actualMime = 'image/gif';

        card.art_mime = actualMime;
        const blob = base64ToBlob(card.png_base64, actualMime);
        if (blob) card.blobUrl = URL.createObjectURL(blob);
    }
}

// ================================================================
// 카드 렌더링
// ================================================================

/**
 * 카드 프레임 레이어 HTML 생성 (그리드 카드 / 모달 공용)
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

const animationState = {
    lastTime: 0,
    cards: new Map(),
    rafId: null
};

function startGlobalAnimationLoop() {
    if (animationState.rafId) cancelAnimationFrame(animationState.rafId);
    animationState.lastTime = performance.now();

    function loop(time) {
        const delta = (time - animationState.lastTime) / 1000;
        animationState.lastTime = time;

        state.cards.forEach((card, index) => {
            if (card.artType === 'gif' && card.frameBlobUrls && card.frameBlobUrls.length > 1) {
                if (card.domNode && card.domNode.style.display !== 'none') {
                    let anim = animationState.cards.get(index);
                    if (!anim) {
                        anim = { currentFrame: 0, timeElapsed: 0 };
                        animationState.cards.set(index, anim);
                    }

                    anim.timeElapsed += delta;
                    const currentDelay = card.gif_frames[anim.currentFrame].delay || 0.1;

                    if (anim.timeElapsed >= currentDelay) {
                        anim.timeElapsed -= currentDelay;
                        anim.currentFrame = (anim.currentFrame + 1) % card.gif_frames.length;

                        const imgEl = document.getElementById(`art-img-${index}`);
                        if (imgEl && imgEl.src !== card.frameBlobUrls[anim.currentFrame]) {
                            imgEl.src = card.frameBlobUrls[anim.currentFrame];
                        }
                    }
                }
            }
        });

        if (state.editingCardIndex !== -1) {
            const card = state.cards[state.editingCardIndex];
            if (state.adjustState.isFrameBased && card.frameBlobUrls && card.frameBlobUrls.length > 1) {
                let anim = animationState.cards.get('modal');
                if (!anim) {
                    anim = { currentFrame: 0, timeElapsed: 0 };
                    animationState.cards.set('modal', anim);
                }

                anim.timeElapsed += delta;
                const currentDelay = card.gif_frames[anim.currentFrame].delay || 0.1;
                if (anim.timeElapsed >= currentDelay) {
                    anim.timeElapsed -= currentDelay;
                    anim.currentFrame = (anim.currentFrame + 1) % card.gif_frames.length;
                    if (dom.modalPreviewAnimated.src !== card.frameBlobUrls[anim.currentFrame]) {
                        dom.modalPreviewAnimated.src = card.frameBlobUrls[anim.currentFrame];
                    }
                }
            }
        }

        animationState.rafId = requestAnimationFrame(loop);
    }
    animationState.rafId = requestAnimationFrame(loop);
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

    await preloadAllAssets();

    dom.appLoading.classList.add('hidden');

    // 이전에 저장된 뱃지 표시 설정 불러오기
    const savedBadgeShow = localStorage.getItem('sts2_show_badge');
    if (savedBadgeShow !== null) {
        state.showModifiedBadge = savedBadgeShow === 'true';
        dom.badgeToggle.checked = state.showModifiedBadge;
        dom.cardGrid.classList.toggle('hide-badges', !state.showModifiedBadge);
    }
    const savedOnlyModified = localStorage.getItem('sts2_only_modified');
    if (savedOnlyModified !== null) {
        state.showOnlyModified = savedOnlyModified === 'true';
        dom.onlyModifiedToggle.checked = state.showOnlyModified;
    }

    renderUI();
    startGlobalAnimationLoop();
    initPatchnotes();
});

/** 모든 카드 에셋과 아트 이미지를 미리 로드 */
async function preloadAllAssets() {
    const uniqueUrls = new Set();
    state.cards.forEach(card => {
        const assets = getCardAssets(card.character, card.cardType, card.rarity);
        Object.values(assets).forEach(url => { if (url) uniqueUrls.add(url); });
        uniqueUrls.add(getCardArtSrc(card));
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
    dom.exportImageBtn.onclick = exportSelectedAsImage;
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
    dom.downloadImageBtn.onclick = downloadCustomImage;
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

    // 뱃지 표시 토글
    dom.badgeToggle.addEventListener('change', (e) => {
        state.showModifiedBadge = e.target.checked;
        dom.cardGrid.classList.toggle('hide-badges', !state.showModifiedBadge);

        // 설정 저장 (선택 사항)
        localStorage.setItem('sts2_show_badge', state.showModifiedBadge);
    });
    // 수정된 카드만 보기 토글
    dom.onlyModifiedToggle.addEventListener('change', (e) => {
        state.showOnlyModified = e.target.checked;
        filterCards();
        localStorage.setItem('sts2_only_modified', state.showOnlyModified);
    });

    // 그룹 영역 클릭 시 토글
    document.querySelectorAll('.badge-toggle-group').forEach(group => {
        group.addEventListener('click', (e) => {
            // input이나 slider 자체를 클릭한 경우는 기본 동작에 맡김 (중복 토글 방지)
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('slider')) return;

            const input = group.querySelector('input[type="checkbox"]');
            if (input) {
                input.checked = !input.checked;
                // change 이벤트를 수동으로 발생시켜 기존 리스너 작동 유도
                input.dispatchEvent(new Event('change'));
            }
        });
    });

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
        if (state.isDraggingModalScrollbar) stopModalScrollbarDrag();
    });

    // 패치노트 관련
    dom.patchnotesBtn.onclick = () => {
        if (dom.patchnotesModal.classList.contains('hidden')) {
            openPatchnotesModal(false);
        } else {
            closePatchnotesModal();
        }
    };
    dom.closePatchnotes.onclick = closePatchnotesModal;
    dom.confirmPatchnotes.onclick = closePatchnotesModal;
    dom.patchnotesModal.querySelector('.modal-overlay').onclick = closePatchnotesModal;

    dom.patchnotesContent.addEventListener('scroll', () => {
        if (!state.isModalScrollUpdating) {
            state.isModalScrollUpdating = true;
            requestAnimationFrame(updateModalScrollbar);
        }
    });
    dom.modalScrollbarThumb.addEventListener('mousedown', startModalScrollbarDrag);
}

// ================================================================
// 파일 처리
// ================================================================
async function handleFileUpload(file) {
    showLoading(true, '아트팩 데이터를 처리 중입니다...');

    let text;
    try {
        text = await readFileAsText(file);
    } catch (err) {
        console.error('파일 읽기 오류:', err);
        alert(`파일을 읽지 못했습니다: ${err.message}`);
        showLoading(false);
        return;
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.error('JSON 파싱 오류:', err);
        alert(`올바른 JSON 형식이 아닙니다: ${err.message}`);
        showLoading(false);
        return;
    }

    try {
        if (data.format !== 'card_art_bundle') {
            alert('올바른 STS2 아트팩 형식이 아닙니다. (format: card_art_bundle 필요)');
            return;
        }

        const hasModified = state.cards.some(c => c.png_base64);
        if (hasModified) {
            state.pendingImportData = data;
            showImportChoiceModal();
        } else {
            processImport(data);
        }
    } catch (err) {
        console.error('데이터 처리 오류:', err);
        alert(`데이터를 처리하는 중 오류가 발생했습니다: ${err.message}`);
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

    const hasGifFrames = raw.frames && raw.frames.length > 0;
    const detectedArtType = raw.type === 'gif' || hasGifFrames ? 'gif' : 'static';

    let restoredBase64 = raw.png_base64;
    if (!restoredBase64 && hasGifFrames) {
        restoredBase64 = raw.frames[0].png_base64;
    }

    return {
        ...raw,
        artType: detectedArtType,
        art_mime: 'image/png',
        gif_frames: hasGifFrames ? raw.frames : null,
        no: meta?.no ?? 9999,
        name_kr: meta?.name_kr ?? extractFallbackName(raw.source_path),
        name_en: meta?.name_en ?? '',
        character: meta?.character ?? inferCharacterFromPath(raw.source_path),
        cardType: meta?.cardType ?? inferTypeFromPath(raw.source_path),
        rarity: meta?.rarity ?? 'Common',
        width: raw.width ?? (isAncient ? 606 : 1000),
        height: raw.height ?? (isAncient ? 852 : 760),
        source_png_base64: raw.source_png_base64 || restoredBase64 || '',
        png_base64: restoredBase64 || '',
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

    const bgColor = card.background_color && card.background_color !== 'transparent' ? card.background_color : '';
    const zoom = card.adjust_zoom || 1.0;
    const offX = card.adjust_offset_x || 0.0;
    const offY = card.adjust_offset_y || 0.0;

    // 정적 이미지는 이미 구워진 캔버스 결과물(png_base64)이 반환되므로 이중 줌 방지
    // 단, GIF (애니메이션)는 원본이 반환되므로 정밀 퍼센트(%) 좌표형 렌더링으로 일치시킴
    const isGif = card.artType === 'gif';
    let artStyle = `position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;`;

    if (isGif && card.source_width && card.source_height) {
        // 모달과 수학적으로 완벽히 동일한 정밀 퍼센트(%) 좌표 계산
        const targetW = card.width || 1000;
        const targetH = card.height || 760;
        const coverScale = Math.max(targetW / card.source_width, targetH / card.source_height);
        const totalScale = coverScale * zoom;
        const rW = card.source_width * totalScale;
        const rH = card.source_height * totalScale;
        const cx = targetW / 2 + offX * (targetW / 2);
        const cy = targetH / 2 + offY * (targetH / 2);

        const leftPct = ((cx - rW / 2) / targetW) * 100;
        const topPct = ((cy - rH / 2) / targetH) * 100;
        const widthPct = (rW / targetW) * 100;
        const heightPct = (rH / targetH) * 100;

        artStyle = `
            position: absolute;
            left: ${leftPct}%;
            top: ${topPct}%;
            width: ${widthPct}%;
            height: ${heightPct}%;
            object-fit: fill;
        `;
    } else if (isGif) {
        // 해상도 정보가 없는 기존 GIF 데이터용 임시 폴백
        artStyle = `
            position: absolute;
            left: 50%;
            top: 50%;
            width: 100%;
            height: 100%;
            object-fit: cover;
            transform: translate(calc(-50% + ${offX * 50 / Math.max(0.1, zoom)}%), calc(-50% + ${offY * 50 / Math.max(0.1, zoom)}%)) scale(${zoom});
        `;
    }

    const artImgId = `art-img-${index}`;
    const artContent = `
        <div class="layer-art-container" style="width:100%;height:100%;position:relative;background-color:${bgColor};overflow:hidden;">
            <img id="${artImgId}" src="${artSrc}" alt="${card.name_en || card.name_kr}" 
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
        const matchChar = character === 'Ancient' ? card.rarity === 'Ancient'
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

        const matchModified = !state.showOnlyModified || !!card.png_base64;

        if (card.domNode) {
            card.domNode.style.display = (matchChar && matchType && matchRarity && matchSearch && matchModified) ? '' : 'none';
        }
    });

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
        state.cards.forEach(c => {
            if (c.blobUrl) URL.revokeObjectURL(c.blobUrl);
            c.blobUrl = null;
        });

        state.originalData = null;
        state.isDirty = false;

        initAllCards();

        const db = await openDB();
        const tx = db.transaction('AppData', 'readwrite');
        tx.objectStore('AppData').delete('currentState');

        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

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

function clearModalPreviews() {
    // 캔버스 초기화
    const canvas = dom.modalPreview;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width || 10, canvas.height || 10);
    }
    // 애니메이션 이미지 초기화
    if (dom.modalPreviewAnimated) {
        dom.modalPreviewAnimated.src = '';
        dom.modalPreviewAnimated.classList.add('hidden');
    }
    // 정적 캔버스 숨기기
    if (dom.modalPreview) {
        dom.modalPreview.classList.add('hidden');
    }
}

function openEditor(cardIndex) {
    const card = state.cards[cardIndex];
    if (!card) return;
    state.editingCardIndex = cardIndex;

    const fallbackSrc = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';
    const charPrefix = (card.character || '').toLowerCase();
    const defaultArtSrc = `source/img/card_images/${charPrefix}_${(card.name_en || '').toLowerCase().replace(/ /g, '_')}.webp`;

    const isFrameBased = card.artType === 'gif' && card.frameBlobUrls && card.frameBlobUrls.length > 0 && (!card.png_base64 || !card.png_base64.startsWith('R0lGOD'));
    const sourceBase64 = card.source_png_base64 || card.png_base64;
    const artMime = card.art_mime || 'image/png';

    let sourceSrc = sourceBase64 ? `data:${artMime};base64,${sourceBase64}` : defaultArtSrc;
    if (isFrameBased) {
        sourceSrc = card.frameBlobUrls[0];
    }

    state.adjustState = {
        zoom: card.adjust_zoom ?? 1.0,
        offsetX: card.adjust_offset_x ?? 0.0,
        offsetY: card.adjust_offset_y ?? 0.0,
        sourceDataUrl: sourceSrc,
        backgroundColor: card.background_color || 'transparent',
        isAnimated: card.artType === 'gif',
        isFrameBased: isFrameBased
    };

    updateBackgroundColor(state.adjustState.backgroundColor, false);

    const bgColor = state.adjustState.backgroundColor;
    document.querySelectorAll('.color-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.color === bgColor);
    });

    const assets = getCardAssets(card.character, card.cardType, card.rarity);

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

    const name = card.name_kr || card.name_en;
    dom.modalTextName.innerText = name;
    dom.modalTextName.setAttribute('data-text', name);
    dom.modalTextType.innerText = CARD_TYPE_KO[card.cardType] || card.cardType;

    dom.modalSize.textContent = `${card.width || 1000} × ${card.height || 760}`;
    dom.modalNameKr.textContent = card.name_kr ? `${card.name_kr} (${card.name_en || ''})` : (card.name_en || '');

    dom.zoomSlider.value = Math.round((card.adjust_zoom ?? 1.0) * 100);
    dom.offsetXSlider.value = Math.round((card.adjust_offset_x ?? 0.0) * 100);
    dom.offsetYSlider.value = Math.round((card.adjust_offset_y ?? 0.0) * 100);

    // 토글 스위치 초기화
    dom.toggleOriginalBtn.classList.remove('is-original');
    dom.toggleOriginalBtn.querySelectorAll('.toggle-option').forEach(opt => {
        opt.classList.toggle('active', opt.classList.contains('left'));
    });

    dom.cardLargePreview.querySelector('.sts2-card').className = `sts2-card ${card.rarity ? `rarity-${card.rarity.toLowerCase()}` : ''}`;

    clearModalPreviews();

    requestAnimationFrame(async () => {
        try {
            state.adjustState.sourceDataUrl = sourceSrc;
            state.adjustState.sourceImage = await loadSourceImage(sourceSrc);
            if (state.adjustState.sourceImage) {
                state.adjustState.sourceWidth = state.adjustState.sourceImage.naturalWidth;
                state.adjustState.sourceHeight = state.adjustState.sourceImage.naturalHeight;
            }
        } catch (err) {
            try {
                state.adjustState.sourceDataUrl = defaultArtSrc;
                state.adjustState.sourceImage = await loadSourceImage(defaultArtSrc);
            } catch (e2) {
                state.adjustState.sourceImage = null;
            }
        }

        dom.editModal.classList.remove('hidden');
        updateModalPreviewTransform();
    });
}

function closeModal() {
    dom.editModal.classList.add('hidden');
    dom.imageInput.value = '';
    state.editingCardIndex = -1;
}

function toggleOriginalView() {
    const isShowingCustom = !dom.modalPreview.classList.contains('hidden');
    dom.modalPreview.classList.toggle('hidden', isShowingCustom);
    dom.modalPreviewOriginal.classList.toggle('hidden', !isShowingCustom);

    dom.toggleOriginalBtn.classList.toggle('is-original', isShowingCustom);
    dom.toggleOriginalBtn.querySelectorAll('.toggle-option').forEach(opt => {
        opt.classList.toggle('active');
    });
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
        const dataUrl = ev.target.result;
        const isAnimated = file.type === 'image/gif' || file.type === 'image/webp' || file.name.toLowerCase().endsWith('.gif');

        state.adjustState.sourceDataUrl = dataUrl;
        state.adjustState.isAnimated = isAnimated;
        state.adjustState.isFrameBased = false;
        state.adjustState.sourceImage = await loadSourceImage(dataUrl);
        state.adjustState.sourceWidth = state.adjustState.sourceImage.naturalWidth;
        state.adjustState.sourceHeight = state.adjustState.sourceImage.naturalHeight;
        state.adjustState.zoom = 1.0;
        state.adjustState.offsetX = 0.0;
        state.adjustState.offsetY = 0.0;
        dom.zoomSlider.value = 100;
        dom.offsetXSlider.value = 0;
        dom.offsetYSlider.value = 0;
        state.isDirty = true;
        updateModalPreviewTransform();
    };
    reader.readAsDataURL(file);
}

/** 현재 편집된 이미지의 원본 소스를 다운로드 */
function downloadCustomImage() {
    const card = state.cards[state.editingCardIndex];
    if (!card) return;

    const dataUrl = state.adjustState.sourceDataUrl;
    if (!dataUrl) {
        alert('다운로드할 이미지 데이터가 없습니다.');
        return;
    }

    let ext = 'webp';
    if (dataUrl.includes('image/gif')) ext = 'gif';
    else if (dataUrl.includes('image/png')) ext = 'png';
    else if (dataUrl.includes('image/jpeg')) ext = 'jpg';
    else if (dataUrl.includes('image/webp')) ext = 'webp';

    const name = card.name_en || 'card';
    const filename = `${name.toLowerCase().replace(/ /g, '_')}_art.${ext}`;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function updateBackgroundColor(color, markDirty = true) {
    state.adjustState.backgroundColor = color;
    const isTransparent = color === 'transparent';

    const layerArt = dom.cardLargePreview.querySelector('.layer-art');
    if (layerArt) {
        layerArt.style.backgroundColor = isTransparent ? '' : color;
        if (isTransparent) {
            layerArt.classList.add('checkerboard');
        } else {
            layerArt.classList.remove('checkerboard');
        }
    }

    if (markDirty) state.isDirty = true;

    if (!state.adjustState.isAnimated && state.adjustState.sourceImage) {
        updateModalPreviewTransform();
    }
}

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

    // ── 애니메이션 모드 (GIF 등) ──
    // Canvas 렌더링과 단 1픽셀의 오차도 없이 시각적 일치를 위해
    // 부모 컨테이너(100%) 비율 기준 절대 퍼센트롤 계산하여 위치/크기를 고정합니다.
    if (state.adjustState.isAnimated) {
        dom.modalPreview.classList.add('hidden');
        dom.modalPreviewAnimated.classList.remove('hidden');

        const animImg = dom.modalPreviewAnimated;
        animImg.src = state.adjustState.sourceDataUrl;

        // 캔버스와 동일한 크기/좌표 렌더링 수학
        const coverScale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
        const totalScale = coverScale * zoom;
        const rW = img.naturalWidth * totalScale;
        const rH = img.naturalHeight * totalScale;

        const cx = targetW / 2 + offsetX * (targetW / 2);
        const cy = targetH / 2 + offsetY * (targetH / 2);

        // 컨테이너 단위 대비 상대 좌표(%)로 변환
        const leftPct = ((cx - rW / 2) / targetW) * 100;
        const topPct = ((cy - rH / 2) / targetH) * 100;
        const widthPct = (rW / targetW) * 100;
        const heightPct = (rH / targetH) * 100;

        animImg.style.position = 'absolute';
        animImg.style.left = `${leftPct}%`;
        animImg.style.top = `${topPct}%`;
        animImg.style.width = `${widthPct}%`;
        animImg.style.height = `${heightPct}%`;
        animImg.style.objectFit = 'fill';
        animImg.style.transform = 'none';
        return;
    }

    // ── 정적 이미지 모드 (Canvas) ──
    dom.modalPreviewAnimated.classList.add('hidden');
    dom.modalPreview.classList.remove('hidden');

    const canvas = dom.modalPreview;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: true });

    ctx.clearRect(0, 0, targetW, targetH);

    if (state.adjustState.backgroundColor !== 'transparent') {
        ctx.fillStyle = state.adjustState.backgroundColor;
        ctx.fillRect(0, 0, targetW, targetH);
    }

    const coverScale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
    const totalScale = coverScale * zoom;
    const rW = img.naturalWidth * totalScale;
    const rH = img.naturalHeight * totalScale;

    const cx = targetW / 2 + offsetX * (targetW / 2);
    const cy = targetH / 2 + offsetY * (targetH / 2);

    ctx.drawImage(img, cx - rW / 2, cy - rH / 2, rW, rH);
}

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

            ctx.clearRect(0, 0, targetW, targetH);
            if (card.background_color && card.background_color !== 'transparent') {
                ctx.fillStyle = card.background_color;
                ctx.fillRect(0, 0, targetW, targetH);
            }

            const coverScale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
            const totalScale = coverScale * zoom;
            const rW = img.naturalWidth * totalScale;
            const rH = img.naturalHeight * totalScale;
            const cx = targetW / 2 + offsetX * (targetW / 2);
            const cy = targetH / 2 + offsetY * (targetH / 2);

            ctx.drawImage(img, cx - rW / 2, cy - rH / 2, rW, rH);
            resolve(compressCanvasToPngBase64(canvas));
        };
        img.onerror = () => resolve('');
        img.src = dataUrl;
    });
}

async function saveChanges() {
    const card = state.cards[state.editingCardIndex];
    if (!card) return;

    if (state.adjustState.isAnimated) {
        if (!state.adjustState.isFrameBased || state.adjustState.sourceDataUrl.startsWith('data:')) {
            const sourceDataUrl = state.adjustState.sourceDataUrl;
            const colonIdx = sourceDataUrl.indexOf(':');
            const semicolonIdx = sourceDataUrl.indexOf(';');
            const gifMime = (colonIdx !== -1 && semicolonIdx !== -1 && semicolonIdx > colonIdx)
                ? sourceDataUrl.slice(colonIdx + 1, semicolonIdx)
                : 'image/gif';

            card.png_base64 = sourceDataUrl.split(',')[1];
            card.art_mime = gifMime;
            card.artType = 'gif';
            card.gif_frames = null;
        }
    } else {
        card.png_base64 = compressCanvasToPngBase64(dom.modalPreview);
        card.artType = 'static';
        card.art_mime = 'image/png';
        card.gif_frames = null;
    }

    if (state.adjustState.sourceDataUrl?.startsWith('data:image')) {
        card.source_png_base64 = state.adjustState.sourceDataUrl.split(',')[1];
    } else {
        card.source_png_base64 = card.png_base64;
    }

    card.adjust_zoom = state.adjustState.zoom;
    card.adjust_offset_x = state.adjustState.offsetX;
    card.adjust_offset_y = state.adjustState.offsetY;
    card.background_color = state.adjustState.backgroundColor;

    if (state.adjustState.sourceImage) {
        card.source_width = state.adjustState.sourceImage.naturalWidth;
        card.source_height = state.adjustState.sourceImage.naturalHeight;
    }

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
    card.background_color = 'transparent';

    // 추가 상태 필드 초기화
    card.artType = 'static';
    card.art_mime = 'image/png';
    card.gif_frames = null;
    delete card.source_width;
    delete card.source_height;
    delete card.updated_at;

    updateCardBlobUrl(card);
    state.isDirty = true;
    saveToDB({ originalData: state.originalData, cards: state.cards });
    replaceCardDOM(card);
    updateStats();
    closeModal();
}

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
        updateSelectionUI();
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
    if (e.button !== 0) return;

    state.isDraggingSelection = true;
    state.dragStartIndex = index;
    state.dragInitialSelection = new Set(state.selectedCards);

    if (state.selectedCards.has(index)) {
        state.dragAction = 'deselect';
        state.selectedCards.delete(index);
    } else {
        state.dragAction = 'select';
        state.selectedCards.add(index);
    }

    updateSelectionUI();
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

function updateSelectionRange(startIdx, endIdx) {
    const visibleCardIndices = state.cards
        .map((card, i) => ({ card, i }))
        .filter(item => item.card.domNode && item.card.domNode.style.display !== 'none')
        .map(item => item.i);

    const startPos = visibleCardIndices.indexOf(startIdx);
    const endPos = visibleCardIndices.indexOf(endIdx);

    if (startPos === -1 || endPos === -1) return;

    const [realStart, realEnd] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];
    const currentRangeIndices = new Set(visibleCardIndices.slice(realStart, realEnd + 1));

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

function selectAllVisibleCards() {
    const visibleIndices = state.cards
        .map((card, i) => ({ card, i }))
        .filter(item => item.card.domNode && item.card.domNode.style.display !== 'none')
        .map(item => item.i);

    const isAllSelected = visibleIndices.length > 0 && visibleIndices.every(idx => state.selectedCards.has(idx));

    if (isAllSelected) {
        visibleIndices.forEach(idx => state.selectedCards.delete(idx));
    } else {
        visibleIndices.forEach(idx => state.selectedCards.add(idx));
    }

    updateSelectionUI();
}

function updateSelectionUI() {
    const count = state.selectedCards.size;
    dom.selectedCount.textContent = count;
    dom.exportSelectedBtn.disabled = count === 0;
    dom.exportImageBtn.disabled = count === 0;

    const visibleIndices = state.cards
        .map((card, i) => ({ card, i }))
        .filter(item => item.card.domNode && item.card.domNode.style.display !== 'none')
        .map(item => item.i);

    const isAllSelected = visibleIndices.length > 0 && visibleIndices.every(idx => state.selectedCards.has(idx));

    if (isAllSelected) {
        dom.selectAllBtn.innerHTML = `<i data-lucide="minus-square"></i> 현재 목록 전체 선택 해제`;
    } else {
        dom.selectAllBtn.innerHTML = `<i data-lucide="check-square"></i> 현재 목록 전체 선택`;
    }

    if (window.lucide) lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        icons: undefined
    }, dom.selectAllBtn);

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

async function buildGifFrames(card) {
    if (card.gif_frames && card.gif_frames.length > 0 && !state.isDirty) {
        return card.gif_frames;
    }

    try {
        const isNativeGif = card.png_base64 && card.png_base64.startsWith('R0lGOD');
        const targetW = card.width || 1000;
        const targetH = card.height || 760;
        const zoom = card.adjust_zoom || 1.0;
        const offsetX = card.adjust_offset_x || 0.0;
        const offsetY = card.adjust_offset_y || 0.0;

        if (isNativeGif) {
            const safeParseGIF = window.parseGIF || window.gifuct?.parseGIF;
            const safeDecompressFrames = window.decompressFrames || window.gifuct?.decompressFrames;
            if (!safeParseGIF || !safeDecompressFrames) throw new Error("gifuct-js 라이브러리가 로드되지 않았습니다.");

            const binary = atob(card.png_base64);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);

            const gif = safeParseGIF(array.buffer);
            const frames = safeDecompressFrames(gif, true);

            if (!frames || frames.length === 0) throw new Error("추출된 프레임이 없습니다.");

            const gifW = frames[0].dims.width;
            const gifH = frames[0].dims.height;

            const rawCanvas = document.createElement('canvas');
            rawCanvas.width = gifW;
            rawCanvas.height = gifH;
            const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });

            const outCanvas = document.createElement('canvas');
            outCanvas.width = targetW;
            outCanvas.height = targetH;
            const outCtx = outCanvas.getContext('2d', { alpha: true });

            const coverScale = Math.max(targetW / gifW, targetH / gifH);
            const totalScale = coverScale * zoom;
            const rW = gifW * totalScale;
            const rH = gifH * totalScale;
            const cx = targetW / 2 + offsetX * (targetW / 2);
            const cy = targetH / 2 + offsetY * (targetH / 2);
            const drawX = cx - rW / 2;
            const drawY = cy - rH / 2;

            const resultFrames = [];
            let previousImageData = null;

            for (let i = 0; i < frames.length; i++) {
                const frame = frames[i];

                if (i > 0 && frames[i - 1].disposalType === 2) {
                    rawCtx.clearRect(
                        frames[i - 1].dims.left, frames[i - 1].dims.top,
                        frames[i - 1].dims.width, frames[i - 1].dims.height
                    );
                }
                if (i > 0 && frames[i - 1].disposalType === 3 && previousImageData) {
                    rawCtx.putImageData(previousImageData, 0, 0);
                } else {
                    previousImageData = rawCtx.getImageData(0, 0, gifW, gifH);
                }

                const patchImageData = new ImageData(
                    new Uint8ClampedArray(frame.patch),
                    frame.dims.width,
                    frame.dims.height
                );
                const patchCanvas = document.createElement('canvas');
                patchCanvas.width = frame.dims.width;
                patchCanvas.height = frame.dims.height;
                patchCanvas.getContext('2d').putImageData(patchImageData, 0, 0);

                rawCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

                outCtx.clearRect(0, 0, targetW, targetH);
                if (card.background_color && card.background_color !== 'transparent') {
                    outCtx.fillStyle = card.background_color;
                    outCtx.fillRect(0, 0, targetW, targetH);
                }

                outCtx.drawImage(rawCanvas, drawX, drawY, rW, rH);

                const pngBase64 = compressCanvasToPngBase64(outCanvas);
                const delaySec = Math.max(0.01, (frame.delay || 100) / 1000);

                resultFrames.push({ png_base64: pngBase64, delay: delaySec });
            }

            card.gif_frames = resultFrames;
            return resultFrames;

        } else if (card.gif_frames && card.gif_frames.length > 0) {
            const outCanvas = document.createElement('canvas');
            outCanvas.width = targetW;
            outCanvas.height = targetH;
            const outCtx = outCanvas.getContext('2d', { alpha: true });

            const resultFrames = [];

            for (let i = 0; i < card.gif_frames.length; i++) {
                const f = card.gif_frames[i];
                const img = await loadSourceImage(`data:image/png;base64,${f.png_base64}`);

                const coverScale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
                const totalScale = coverScale * zoom;
                const rW = img.naturalWidth * totalScale;
                const rH = img.naturalHeight * totalScale;
                const cx = targetW / 2 + offsetX * (targetW / 2);
                const cy = targetH / 2 + offsetY * (targetH / 2);

                outCtx.clearRect(0, 0, targetW, targetH);
                if (card.background_color && card.background_color !== 'transparent') {
                    outCtx.fillStyle = card.background_color;
                    outCtx.fillRect(0, 0, targetW, targetH);
                }
                outCtx.drawImage(img, cx - rW / 2, cy - rH / 2, rW, rH);

                resultFrames.push({
                    png_base64: compressCanvasToPngBase64(outCanvas),
                    delay: f.delay
                });
            }

            card.gif_frames = resultFrames;
            return resultFrames;
        } else {
            throw new Error("No GIF data or frames available.");
        }

    } catch (e) {
        try {
            const pngBase64 = await renderCardToPngBase64(card);
            return pngBase64 ? [{ png_base64: pngBase64, delay: 0.1 }] : [];
        } catch (errFallback) {
            return [];
        }
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

    showLoading(true, `아트팩을 생성하는 중입니다... (0/${modifiedCards.length})`);
    await new Promise(resolve => setTimeout(resolve, 50));

    const jsonParts = [];

    const baseData = { ...(state.originalData || { format: 'card_art_bundle', version: 1 }) };
    delete baseData.overrides;

    const headerObj = {
        ...baseData,
        format: 'card_art_bundle',
        version: baseData.version || 1,
        exported_at: new Date().toISOString().slice(0, 19),
        count: modifiedCards.length,
    };
    jsonParts.push(`${JSON.stringify(headerObj).slice(0, -1)},"overrides":[`);

    try {
        for (let i = 0; i < modifiedCards.length; i++) {
            const c = modifiedCards[i];
            showLoading(true, `아트팩을 생성하는 중입니다... (${i + 1}/${modifiedCards.length})`);

            if (i % 5 === 0) await new Promise(resolve => setTimeout(resolve, 10));

            const obj = {
                display_mode: c.display_mode || 'default',
                height: c.height || 760,
                source_path: c.source_path,
                type: c.artType === 'gif' ? 'animated_gif' : (c.artType || 'static'),
                updated_at: (c.updated_at || new Date().toISOString().slice(0, 19)).replace(' ', 'T'),
                width: c.width || 1000,
                adjust_zoom: parseFloat(c.adjust_zoom ?? 1.0),
                adjust_offset_x: parseFloat(c.adjust_offset_x ?? 0.0),
                adjust_offset_y: parseFloat(c.adjust_offset_y ?? 0.0),
            };

            if (c.source_png_base64 && c.source_png_base64 !== c.png_base64) {
                obj.source_png_base64 = c.source_png_base64;
            }

            if (c.artType === 'gif') {
                let frames = c.gif_frames;
                if (!frames || c.png_base64.startsWith('R0lGOD') || state.isDirty) {
                    frames = await buildGifFrames(c);
                }

                if (frames && frames.length > 0) {
                    obj.frames = frames;
                } else {
                    obj.png_base64 = c.png_base64;
                    obj.type = 'static';
                }
            } else {
                obj.png_base64 = c.png_base64;
            }

            jsonParts.push(JSON.stringify(obj));
            if (i < modifiedCards.length - 1) {
                jsonParts.push(',');
            }

            obj.frames = null;
        }

        jsonParts.push(']}');

        const now = new Date();
        const dateStr = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');

        const blob = new Blob(jsonParts, { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `artpack_${modifiedCards.length}_${dateStr}.cardartpack.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error('파일 저장 오류:', e);
        alert(`파일 다운로드 시도가 실패했습니다: ${e.message}`);
    } finally {
        showLoading(false);
        state.isDirty = false;
        saveToDB({ originalData: state.originalData, cards: state.cards });
        jsonParts.length = 0;
    }
}

async function exportSelectedAsImage() {
    const selectedIndices = Array.from(state.selectedCards).sort((a, b) => {
        const noA = state.cards[a].no || 9999;
        const noB = state.cards[b].no || 9999;
        return noA - noB;
    });

    if (selectedIndices.length === 0) return;

    showLoading(true, '이미지를 생성하는 중입니다...');

    const container = document.createElement('div');
    container.className = 'card-grid';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.zIndex = '-9999';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.background = 'transparent';
    container.style.padding = '40px';

    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(5, max-content)';
    container.style.gap = '0';
    container.style.width = 'fit-content';

    document.body.appendChild(container);

    selectedIndices.forEach(idx => {
        const card = state.cards[idx];
        const nodeClone = card.domNode.cloneNode(true);

        nodeClone.classList.remove('selected');
        const badge = nodeClone.querySelector('.badge');
        if (badge) badge.remove();

        nodeClone.style.display = 'flex';
        nodeClone.style.margin = '-20px -12px';

        container.appendChild(nodeClone);
    });

    try {
        if (!window.htmlToImage) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
    } catch (e) {
        console.error('라이브러리 로드 오류:', e);
        alert(`이미지 생성 라이브러리를 불러오지 못했습니다: ${e.message}`);
        if (document.body.contains(container)) document.body.removeChild(container);
        showLoading(false);
        return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    let dataUrl;
    try {
        dataUrl = await htmlToImage.toPng(container, {
            pixelRatio: 1,
            style: {
                opacity: '1'
            }
        });
    } catch (e) {
        console.error('렌더링 오류:', e);
        alert(`이미지 렌더링 과정에서 오류가 발생했습니다: ${e.message}`);
        if (document.body.contains(container)) document.body.removeChild(container);
        showLoading(false);
        return;
    }

    try {
        const a = document.createElement('a');
        a.href = dataUrl;

        const now = new Date();
        const dateStr = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');

        a.download = `selected_cards_${dateStr}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

    } catch (e) {
        console.error('이미지 저장 오류:', e);
        alert(`이미지 저장에 실패했습니다: ${e.message}`);
    } finally {
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
        showLoading(false);
    }
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
/** 로딩 레이어 표시 제어 */
function showLoading(show, message = '에셋 로딩 중...') {
    const textEl = document.getElementById('loadingText');
    if (textEl) textEl.textContent = message;
    dom.appLoading.classList.toggle('hidden', !show);
}

/** 스크롤바 드래그 종료 */
function stopScrollbarDrag() {
    state.isDraggingScrollbar = false;
    document.body.classList.remove('dragging');

    window.removeEventListener('mousemove', handleScrollbarDrag);
    window.removeEventListener('mouseup', stopScrollbarDrag);
}

// ================================================================
// 패치노트 시스템
// ================================================================

/** 패치노트 초기화 및 자동 팝업 체크 */
async function initPatchnotes() {
    try {
        const response = await fetch('patchnotes.json');
        if (!response.ok) throw new Error('패치노트 로딩 실패');
        const patchnotesData = await response.json();
        // 데이터가 유효한 배열인지 확인
        if (Array.isArray(patchnotesData) && patchnotesData.length > 0) {
            state.patchnotes = patchnotesData;

            const latestVersion = state.patchnotes[0].version;
            const lastVersion = localStorage.getItem('sts2_last_patchnote_version');
            if (lastVersion !== latestVersion) {
                openPatchnotesModal(true);
            }
        }
    } catch (err) {
        console.error('Patchnotes load failed:', err);
    }
}

/** 패치노트 모달 열기 */
function openPatchnotesModal(isAuto = false) {
    if (!state.patchnotes) return;

    renderPatchnotesContent();
    dom.patchnotesModal.classList.remove('hidden');
    lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        icons: undefined
    }, dom.patchnotesModal);

    // 열린 직후 스크롤바 상태 갱신
    setTimeout(updateModalScrollbar, 50);

    if (isAuto) {
        // 자동 팝업 시 최신 버전 저장 (한 번 닫으면 해당 버전은 안 뜸)
        const latestVersion = state.patchnotes[0].version;
        localStorage.setItem('sts2_last_patchnote_version', latestVersion);
    }
}

/** 패치노트 모달 닫기 */
function closePatchnotesModal() {
    dom.patchnotesModal.classList.add('hidden');
    // 버튼 클릭으로 열었을 때도 닫으면 최신 버전을 확인한 것으로 간주
    if (state.patchnotes && state.patchnotes.length > 0) {
        const latestVersion = state.patchnotes[0].version;
        localStorage.setItem('sts2_last_patchnote_version', latestVersion);
    }
}

/** 패치노트 내용 렌더링 */
function renderPatchnotesContent() {
    if (!state.patchnotes || state.patchnotes.length === 0) return;

    let html = state.patchnotes.map(group => {
        const { version, date, notes } = group;
        return `
            <div class="patchnote-group">
                <div class="patchnote-header">
                    <span class="patchnote-version">Ver ${version}</span>
                    <span class="patchnote-date">${date}</span>
                </div>
                ${notes.map(note => `
                    <div class="patchnote-section">
                        <div class="patchnote-title">${note.title}</div>
                        <ul class="patchnote-list">
                            ${note.items.map(item => `<li class="patchnote-item">${item}</li>`).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');

    dom.patchnotesContent.innerHTML = html;
}

/** 모달 전용 스크롤바 업데이트 */
function updateModalScrollbar() {
    const { patchnotesContent, modalScrollbarThumb, modalScrollbar } = dom;
    if (!patchnotesContent || !modalScrollbarThumb || !modalScrollbar) {
        state.isModalScrollUpdating = false;
        return;
    }

    const scrollHeight = patchnotesContent.scrollHeight;
    const clientHeight = patchnotesContent.clientHeight;
    const scrollTop = patchnotesContent.scrollTop;

    if (scrollHeight <= clientHeight + 1) {
        modalScrollbar.style.display = 'none';
        state.isModalScrollUpdating = false;
        return;
    }
    modalScrollbar.style.display = 'flex';

    const trackHeight = modalScrollbar.clientHeight;
    const thumbHeight = modalScrollbarThumb.clientHeight;
    const maxScroll = scrollHeight - clientHeight;
    const maxThumbMove = trackHeight - thumbHeight;

    const scrollRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));
    const thumbTop = scrollRatio * maxThumbMove;

    modalScrollbarThumb.style.transform = `translate3d(-50%, ${thumbTop}px, 0)`;
    state.isModalScrollUpdating = false;
}

/** 모달 스크롤바 드래그 시작 */
function startModalScrollbarDrag(e) {
    state.isDraggingModalScrollbar = true;
    state.modalStartY = e.clientY;
    state.modalStartScrollTop = dom.patchnotesContent.scrollTop;

    document.body.classList.add('dragging');

    window.addEventListener('mousemove', handleModalScrollbarDrag);
    window.addEventListener('mouseup', stopModalScrollbarDrag);

    e.preventDefault();
}

/** 모달 스크롤바 드래그 진행 */
function handleModalScrollbarDrag(e) {
    if (!state.isDraggingModalScrollbar) return;

    const deltaY = e.clientY - state.modalStartY;
    const { patchnotesContent, modalScrollbar, modalScrollbarThumb } = dom;

    const trackHeight = modalScrollbar.clientHeight;
    const thumbHeight = modalScrollbarThumb.clientHeight;
    const maxThumbMove = trackHeight - thumbHeight;
    const maxScroll = patchnotesContent.scrollHeight - patchnotesContent.clientHeight;

    if (maxThumbMove <= 0 || maxScroll <= 0) return;

    const scrollDelta = (deltaY / maxThumbMove) * maxScroll;
    patchnotesContent.scrollTop = state.modalStartScrollTop + scrollDelta;
}

/** 모달 스크롤바 드래그 종료 */
function stopModalScrollbarDrag() {
    state.isDraggingModalScrollbar = false;
    document.body.classList.remove('dragging');

    window.removeEventListener('mousemove', handleModalScrollbarDrag);
    window.removeEventListener('mouseup', stopModalScrollbarDrag);
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

/** 커스텀 스크롤바 위치 업데이트 */
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

    e.preventDefault();
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