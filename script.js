'use strict';

// ================================================================
// 상수
// ================================================================

// 카드 타입 한글 표기
const CARD_TYPE_KO = {
    Attack: '공격',
    Skill: '스킬',
    Power: '파워',
    Status: '상태이상',
    Curse: '저주',
};

// 카드 프레임 경로
const FRAME_PREFIX = 'source/img/card_frame/273px-StS2_';

// 특수 캐릭터 그룹
const SPECIAL_CHARACTERS = new Set(['Status', 'Curse', 'Event', 'Quest', 'Token']);

// 특수 카드 타입
const SPECIAL_TYPES = new Set(['Status', 'Curse', 'Quest']);

// 특수 희귀도
const SPECIAL_RARITIES = new Set(['Starter', 'Ancient', 'Misc']);

// 캐릭터 필터 비활성 조건
const RARITY_DISABLED_CHARS = new Set(['Ancient', 'special']);

// 모달 아이콘 SVG
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

/**
 * 문자열에서 특수문자를 제거하고 소문자로 변환하여 조회용 키를 생성합니다.
 * @param {string} str - 변환할 원본 문자열
 * @returns {string} 특수문자가 제거된 소문자 키 문자열
 */
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

/**
 * 문자열을 파일명으로 적합한 형식으로 변환합니다.
 * 공백은 언더바(_)로 변환하며, 영문 소문자로 처리합니다.
 * 원본 파일(Assets) 로딩을 위해 특수문자를 제거하지 않습니다.
 * @param {string} str - 변환할 원본 문자열
 * @returns {string} 변환된 파일명 호환 문자열
 */
function toFileName(str) {
    if (!str) return '';
    let result = '';
    const lower = str.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
        const c = lower[i];
        if (c === ' ') {
            result += '_';
        } else {
            result += c;
        }
    }
    return result;
}

/**
 * 문자열에서 특수문자를 제거하고 파일명으로 적합한 형식으로 변환합니다.
 * 영문자와 숫자만 남기고 공백은 언더바(_)로 변환하며, 정규표현식을 사용하지 않습니다.
 * 내보내기용(Mod, Web Export) 경로 생성을 위해 사용됩니다.
 * @param {string} str - 변환할 원본 문자열
 * @returns {string} 변환된 파일명 호환 문자열
 */
function toSanitizedFileName(str) {
    if (!str) return '';
    let result = '';
    const lower = str.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
        const c = lower[i];
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            result += c;
        } else if (c === ' ') {
            result += '_';
        }
    }
    return result;
}

/**
 * cards.csv 파일로부터 전체 카드 데이터베이스를 비동기로 로드하고 인덱싱합니다.
 * @returns {Promise<void>} 로드 완료 시점을 나타내는 Promise
 */
async function fetchCardDatabase() {
    try {
        const response = await fetch('cards.csv');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        CARDS_DB = parseCSV(text);
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

/**
 * CSV 텍스트를 파싱하여 카드 객체 배열로 변환합니다.
 * 쌍따옴표로 감싼 필드(쉼표 포함 가능)를 올바르게 처리합니다.
 * @param {string} text - CSV 원본 텍스트
 * @returns {object[]} 파싱된 카드 객체 배열
 */
function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const headers = splitCSVLine(lines[0]);
    const result = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = splitCSVLine(line);
        const obj = {};
        headers.forEach((header, index) => {
            const raw = values[index] ?? '';
            obj[header] = header === 'no' ? parseInt(raw, 10) : raw;
        });
        result.push(obj);
    }
    return result;
}

/**
 * CSV 한 줄을 필드 배열로 분리합니다. 쌍따옴표 내부의 쉼표는 구분자로 처리하지 않습니다.
 * @param {string} line - CSV 한 줄 문자열
 * @returns {string[]} 파싱된 필드 값 배열
 */
function splitCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

/**
 * 주어진 파일 경로 정보를 바탕으로 카드 메타데이터를 검색하여 반환합니다.
 * @param {string} sourcePath - 검색할 카드의 리소스 경로 (res://... 또는 실제 경로)
 * @returns {object|null} 일치하는 카드 메타데이터 객체 또는 없을 경우 null
 */
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
    dragAction: null,
    isDraggingModalScrollbar: false,
    isModalScrollUpdating: false,
    modalStartY: 0,
    modalStartScrollTop: 0,
    changelog: null,
    lastAction: null,
};

// ================================================================
// DOM 참조
// ================================================================
const $ = id => document.getElementById(id);
let dom = {};

/**
 * 애플리케이션에서 사용하는 주요 DOM 엘리먼트들을 조회하여 dom 객체에 바인딩합니다.
 * @returns {void}
 */
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
        importChoiceModal: $('importChoiceModal'),
        importMergeBtn: $('importMergeBtn'),
        importResetBtn: $('importResetBtn'),
        cancelImportBtn: $('cancelImportBtn'),
        downloadImageBtn: $('downloadImageBtn'),
        badgeToggle: $('badgeToggle'),
        onlyModifiedToggle: $('onlyModifiedToggle'),
        changelogBtn: $('changelogBtn'),
        changelogModal: $('changelogModal'),
        changelogContent: $('changelogContent'),
        closeChangelog: $('closeChangelog'),
        confirmChangelog: $('confirmChangelog'),
        modalScrollbar: $('modalScrollbar'),
        modalScrollbarThumb: $('modalScrollbarThumb'),
        dropOverlay: $('dropOverlay'),
        toast: $('toast'),
    };
}

// ================================================================
// 에셋 조회
// ================================================================

/**
 * 캐릭터, 카드 타입, 희귀도 정보를 조합하여 해당 카드에 필요한 이미지 에셋 경로들을 반환합니다.
 * @param {string} character - 캐릭터 명칭 (Ironclad, Silent 등)
 * @param {string} cardType - 카드 타입 (Attack, Skill, Power 등)
 * @param {string} rarity - 카드 희귀도 (Common, Uncommon, Rare 등)
 * @returns {object} 배경, 프레임, 배너, 오브, 타입 강조 이미지를 포함하는 경로 객체
 */
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

/**
 * 카드 객체의 상태를 확인하여 적절한 아트 이미지의 소스 경로(URL 또는 Blob URL)를 반환합니다.
 * @param {object} card - 카드 데이터 객체
 * @returns {string} 이미지 소스로 사용할 수 있는 URL 문자열
 */
function getCardArtSrc(card) {
    if (card?.blobUrl) return card.blobUrl;
    if (card?.png_base64 && !card.blobUrl) {
        updateCardBlobUrl(card);
        if (card.blobUrl) return card.blobUrl;
    }
    const character = (card?.character || 'colorless').toLowerCase();
    const nameEn = toFileName(card?.name_en || '');
    if (character === 'ancient' && nameEn === 'apparition') {
        return 'source/img/card_images/silent_apparition.webp';
    }
    return `source/img/card_images/${character}_${nameEn}.webp`;
}

/**
 * 캔버스 엘리먼트의 내용을 UPNG.js와 pako를 사용하여 고효율 압축 PNG Base64 문자열로 변환합니다.
 * @param {HTMLCanvasElement} canvas - 변환할 원본 캔버스 엘리먼트
 * @returns {string} 압축된 PNG 데이터의 Base64 문자열 (헤더 제외)
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

/**
 * Base64로 인코딩된 이미지 데이터를 지정된 MIME 타입의 Blob 객체로 변환합니다.
 * @param {string} base64 - Base64 인코딩된 이미지 데이터
 * @param {string} [type='image/webp'] - 결과 Blob의 MIME 타입
 * @returns {Blob|null} 생성된 Blob 객체 또는 입력값이 없을 경우 null
 */
function base64ToBlob(base64, type = 'image/webp') {
    if (!base64) return null;
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    return new Blob([array], { type });
}

/**
 * 카드 객체에 포함된 이미지 데이터를 기반으로 브라우저의 Blob URL을 갱신합니다.
 * 기존 URL이 있을 경우 메모리 해제를 위해 해제(revoke) 작업을 먼저 수행합니다.
 * @param {object} card - 갱신할 카드 객체
 * @returns {void}
 */
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
 * 카드 프레임을 구성하는 각 레이어(배경, 프레임, 배너 등)의 HTML 문자열을 생성합니다.
 * @param {object} assets - 각 레이어 이미지 경로를 담은 객체
 * @param {string} artContent - 카드 아트 영역에 들어갈 HTML 콘텐츠 (img 태그 등)
 * @returns {string} 구성된 HTML 문자열
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
 * 카드 위에 표시될 텍스트 레이어(이름, 타입)의 HTML 문자열을 생성합니다.
 * @param {object} card - 카드 데이터 객체
 * @returns {string} 구성된 HTML 문자열
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
// 초기화
// ================================================================

/**
 * 카드의 캐릭터 정보를 바탕으로 게임 내 기본 리소스 경로(res://)를 추론하여 반환합니다.
 * @param {object} card - 카드 객체
 * @returns {string} 추론된 리소스 경로 문자열
 */
function getBaseSourcePath(card) {
    let charDir = Object.keys(DIR_TO_CHARACTER).find(k => DIR_TO_CHARACTER[k] === card.itemSource) || 'colorless';
    const fileName = toSanitizedFileName(card.name_en || '');

    if (card.isBeta === 'true') {
        return `res://images/atlases/card_atlas.sprites/${charDir}/${fileName}.tres`;
    }
    return `res://images/packed/card_portraits/${charDir}/${fileName}.png`;
}

/**
 * 로드된 전체 카드 DB를 순회하며 편집용 초기 상태를 가진 카드 객체 배열을 생성합니다.
 * @returns {void}
 */
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
            itemSource: card.itemSource,
            isBeta: card.isBeta,
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

/**
 * 전역 애니메이션 루프를 시작합니다. 그리드와 모달 내의 GIF 카드 프레임을 일정 간격으로 갱신합니다.
 * @returns {void}
 */
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
    initChangelog();
});

/**
 * 현재 로드된 모든 카드의 기본 에셋과 현재 적용된 아트 이미지를 브라우저 캐시에 미리 로드합니다.
 * @returns {Promise<void>} 모든 이미지 로드(또는 실패) 완료 시점을 나타내는 Promise
 */
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
/**
 * 버튼 클릭, 입력 변경, 스크롤, 드래그 앤 드롭 등 애플리케이션의 모든 UI 이벤트를 바인딩합니다.
 * @returns {void}
 */
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

    // ChangeLog 관련
    dom.changelogBtn.onclick = () => {
        if (dom.changelogModal.classList.contains('hidden')) {
            openChangelogModal(false);
        } else {
            closeChangelogModal();
        }
    };
    dom.closeChangelog.onclick = closeChangelogModal;
    dom.confirmChangelog.onclick = closeChangelogModal;
    dom.changelogModal.querySelector('.modal-overlay').onclick = closeChangelogModal;

    dom.changelogContent.addEventListener('scroll', () => {
        if (!state.isModalScrollUpdating) {
            state.isModalScrollUpdating = true;
            requestAnimationFrame(updateChangelogScrollbar);
        }
    });
    dom.modalScrollbarThumb.addEventListener('mousedown', startChangelogScrollbarDrag);

    // 드래그 앤 드롭 이미지 업로드
    window.addEventListener('dragover', e => {
        e.preventDefault();
        if (state.editingCardIndex !== -1) {
            dom.dropOverlay.classList.add('active');
        }
    });

    window.addEventListener('dragleave', e => {
        // 브라우저 밖으로 나가거나 캔버스 영역을 벗어날 때만 오버레이 제거
        if (e.relatedTarget === null) {
            dom.dropOverlay.classList.remove('active');
        }
    });

    window.addEventListener('drop', e => {
        e.preventDefault();
        dom.dropOverlay.classList.remove('active');

        if (state.editingCardIndex !== -1 && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                processImageFile(file);
            }
        }
    });

    // 드롭 오버레이 드래그 이벤트 전파 방지
    dom.dropOverlay.addEventListener('dragenter', e => e.preventDefault());
}

// ================================================================
// 파일 처리
// ================================================================
/**
 * 사용자가 업로드한 JSON 파일을 읽고 파싱하여 아트팩 형식(card_art_bundle)인지 검증합니다.
 * @param {File} file - 업로드된 JSON 파일 객체
 * @returns {Promise<void>} 파일 처리 완료 시점을 나타내는 Promise
 */
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

/**
 * 파싱된 아트팩 데이터를 현재 상태에 적용합니다. 병합(Merge) 또는 초기화 후 적용을 선택할 수 있습니다.
 * @param {object} data - 적용할 아트팩 데이터 객체
 * @param {boolean} [isMerge=true] - 기존 수정사항 유지 여부 (true: 병합, false: 덮어쓰기)
 * @returns {Promise<void>} 데이터 적용 및 UI 갱신 완료 시점을 나타내는 Promise
 */
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

/**
 * 아트팩 불러오기 시 기존 데이터와의 충돌을 해결하기 위한 선택 모달을 표시합니다.
 * @returns {void}
 */
function showImportChoiceModal() {
    dom.importChoiceModal.classList.remove('hidden');
    lucide.createIcons();
}

/**
 * 불러오기 선택 모달을 숨기고 대기 중인 데이터를 초기화합니다.
 * @returns {void}
 */
function hideImportChoiceModal() {
    dom.importChoiceModal.classList.add('hidden');
    state.pendingImportData = null;
}

/**
 * 모든 카드 객체의 상태를 초기화하고 IndexedDB 및 Blob URL을 포함한 모든 데이터를 삭제합니다.
 * @returns {Promise<void>} 초기화 완료 시점을 나타내는 Promise
 */
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

/**
 * 외부에서 가져온 로우(raw) 카드 데이터에 로컬 DB의 메타데이터를 결합하여 완전한 카드 객체를 생성합니다.
 * @param {object} raw - 외부 아트팩에서 추출한 개별 카드 데이터
 * @returns {object} 메타데이터가 보완된 카드 객체
 */
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

/**
 * 소스 경로에서 파일명을 추출하여 가독성 있는 기본 카드 이름으로 변환합니다. (폴백용)
 * @param {string} sourcePath - 리소스 경로
 * @returns {string} 변환된 이름 문자열
 */
function extractFallbackName(sourcePath) {
    if (!sourcePath) return 'Unknown';
    const file = sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'unknown';
    return file.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * 소스 경로의 디렉토리 정보를 바탕으로 카드의 캐릭터를 추론합니다.
 * @param {string} sourcePath - 리소스 경로
 * @returns {string} 추론된 캐릭터 명칭
 */
function inferCharacterFromPath(sourcePath) {
    const dir = (sourcePath || '').split('/').slice(-2, -1)[0]?.toLowerCase() || '';
    return DIR_TO_CHARACTER[dir] || 'Colorless';
}

/**
 * 소스 경로에 포함된 키워드를 바탕으로 카드 타입을 추론합니다.
 * @param {string} sourcePath - 리소스 경로
 * @returns {string} 추론된 카드 타입 (Attack, Power, Skill 중 하나)
 */
function inferTypeFromPath(sourcePath) {
    const path = (sourcePath || '').toLowerCase();
    if (path.includes('attack')) return 'Attack';
    if (path.includes('power')) return 'Power';
    return 'Skill';
}

/**
 * File 객체를 읽어 문자열 텍스트로 반환하는 Promise 기반의 유틸리티 함수입니다.
 * @param {File} file - 읽을 파일 객체
 * @returns {Promise<string>} 파일 내용 문자열을 담은 Promise
 */
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
/**
 * 전체 UI를 갱신합니다. 에디터 영역 표시, 버튼 상태, 통계, 그리드 렌더링 등을 아우릅니다.
 * @returns {void}
 */
function renderUI() {
    dom.editorSection.classList.remove('hidden');
    updateGlobalButtons();
    updateStats();
    renderCardGrid();
    lucide.createIcons();
    setTimeout(updateCustomScrollbar, 100);
}

/**
 * 현재 수정된 카드의 개수를 계산하여 화면에 표시하고 관련 버튼들의 전역 상태를 업데이트합니다.
 * @returns {void}
 */
function updateStats() {
    const modifiedCount = state.cards.filter(c => c.png_base64).length;
    dom.cardCountEl.textContent = modifiedCount;
    updateGlobalButtons();
}

/**
 * 현재 카드 데이터 상태(수정 여부, 아트팩 로드 여부 등)에 따라 상단 버튼들의 활성화 상태를 제어합니다.
 * @returns {void}
 */
function updateGlobalButtons() {
    const hasModified = state.cards.some(c => c.png_base64);
    const hasArtpack = !!state.originalData;

    dom.exportBtn.disabled = !hasModified;
    dom.selectModeBtn.disabled = false;
    dom.unloadBtn.disabled = !hasArtpack && !hasModified;
}

/**
 * 카드 그리드 영역을 데이터 기반으로 초기 렌더링하거나 필터링을 적용합니다.
 * @returns {void}
 */
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

/**
 * 특정 카드 객체의 개별 DOM 요소를 최신 상태로 재생성하여 교체합니다.
 * @param {object} card - 교체할 카드 객체
 * @returns {void}
 */
function replaceCardDOM(card) {
    if (!card.domNode) return;
    const isHidden = card.domNode.style.display === 'none';
    const newDom = createCardElement(card);
    newDom.style.display = isHidden ? 'none' : '';
    dom.cardGrid.replaceChild(newDom, card.domNode);
    card.domNode = newDom;
}

/**
 * 개별 카드 객체를 기반으로 그리드에 표시될 DOM 엘리먼트(카드 아이템)를 생성하고 이벤트를 바인딩합니다.
 * @param {object} card - 생성할 카드 객체
 * @returns {HTMLDivElement} 생성된 카드 아이템 DOM 엘리먼트
 */
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

    div.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!state.isSelectMode) {
            div.classList.add('drag-over');
        }
    });

    div.addEventListener('dragleave', (e) => {
        div.classList.remove('drag-over');
    });

    div.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        div.classList.remove('drag-over');

        if (!state.isSelectMode && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                processSilentImageDrop(file, index);
            }
        }
    });

    const assets = getCardAssets(card.character, card.cardType, card.rarity);
    const artSrc = getCardArtSrc(card);
    const fallback = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';

    const bgColor = card.background_color && card.background_color !== 'transparent' ? card.background_color : '';
    const zoom = card.adjust_zoom || 1.0;
    const offX = card.adjust_offset_x || 0.0;
    const offY = card.adjust_offset_y || 0.0;

    const isGif = card.artType === 'gif';
    let artStyle = `position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;`;

    if (isGif && card.source_width && card.source_height) {
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

    // 그리드용 드롭 오버레이 추가
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'drop-overlay';
    dropOverlay.innerHTML = `
        <div class="drop-overlay-content">
            <i data-lucide="image-plus"></i>
            <span>업로드</span>
        </div>
    `;
    div.appendChild(dropOverlay);

    div.appendChild(cardEl);

    // 오버레이 아이콘 생성 (새로 추가된 DOM에 대해서만)
    if (window.lucide) {
        lucide.createIcons({
            attrs: { class: 'lucide' },
            nameAttr: 'data-lucide',
            icons: undefined
        }, dropOverlay);
    }

    return div;
}

// ================================================================
// 필터
// ================================================================
/**
 * 선택된 캐릭터에 따라 희귀도 필터의 활성화 여부를 동기화합니다.
 * 특정 캐릭터(Ancient 등)는 희귀도 필터가 비활성화됩니다.
 * @returns {void}
 */
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

/**
 * 현재 설정된 모든 필터(캐릭터, 타입, 희귀도, 검색어)를 기반으로 카드 목록을 필터링하여 표시 여부를 결정합니다.
 * @returns {void}
 */
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
// 데이터 해제
// ================================================================
/**
 * 현재 로드된 아트팩 데이터를 해제하고 앱을 초기 상태로 되돌립니다.
 * 사용자 확인 절차를 거치며 모든 수정 사항이 삭제됩니다.
 * @returns {Promise<void>} 해제 및 초기화 완료 시점을 나타내는 Promise
 */
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
        const tx = db.transaction(['AppData', 'CardOverrides'], 'readwrite');
        tx.objectStore('AppData').delete('originalData');
        tx.objectStore('CardOverrides').clear();

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

/**
 * 모달 내의 캔버스 및 애니메이션 프리뷰 영역을 초기화하고 숨깁니다.
 * @returns {void}
 */
function clearModalPreviews() {
    const canvas = dom.modalPreview;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width || 10, canvas.height || 10);
    }
    if (dom.modalPreviewAnimated) {
        dom.modalPreviewAnimated.src = '';
        dom.modalPreviewAnimated.classList.add('hidden');
    }
    if (dom.modalPreview) {
        dom.modalPreview.classList.add('hidden');
    }
}

/**
 * 특정 카드를 편집하기 위한 상세 에디터 모달을 엽니다.
 * @param {number} cardIndex - 편집할 카드의 전체 카드 보관함 내 인덱스
 * @returns {void}
 */
function openEditor(cardIndex) {
    const card = state.cards[cardIndex];
    if (!card) return;
    state.editingCardIndex = cardIndex;

    const fallbackSrc = 'source/img/card_frame/273px-StS2_AncientCardHighlight.png';
    const charPrefix = (card.character || '').toLowerCase();
    const defaultArtSrc = `source/img/card_images/${charPrefix}_${toFileName(card.name_en || '')}.webp`;

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

/**
 * 편집 모달을 닫고 관련 입력 상태를 초기화합니다.
 * @returns {void}
 */
function closeModal() {
    dom.editModal.classList.add('hidden');
    dom.imageInput.value = '';
    state.editingCardIndex = -1;
}

/**
 * 상세 에디터에서 사용자가 편집 중인 이미지와 원본 게임 이미지를 비교해 볼 수 있도록 표시를 토글합니다.
 * @returns {void}
 */
function toggleOriginalView() {
    const isShowingCustom = !dom.modalPreview.classList.contains('hidden');
    dom.modalPreview.classList.toggle('hidden', isShowingCustom);
    dom.modalPreviewOriginal.classList.toggle('hidden', !isShowingCustom);

    dom.toggleOriginalBtn.classList.toggle('is-original', isShowingCustom);
    dom.toggleOriginalBtn.querySelectorAll('.toggle-option').forEach(opt => {
        opt.classList.toggle('active');
    });
}

/**
 * 파일 선택 창을 통해 업로드된 이미지 파일을 처리하는 핸들러입니다.
 * @param {Event} e - 파일 입력 엘리먼트의 change 이벤트 객체
 * @returns {void}
 */
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) processImageFile(file);
}

/**
 * 화면 하단에 알림 메시지(토스트)를 표시합니다. 실행 취소 버튼을 포함할 수 있습니다.
 * @param {string} message - 표시할 메시지 내용
 * @param {boolean} [isUndoable=false] - 실행 취소 기능 제공 여부
 * @returns {void}
 */
function showToast(message, isUndoable = false) {
    const toast = dom.toast;
    if (!toast) return;

    let html = `<span>${message}</span>`;
    if (isUndoable && state.lastAction) {
        html += `<button class="toast-undo-btn" onclick="undoLastAction()">실행취소</button>`;
    }

    toast.innerHTML = html;
    toast.classList.add('show');

    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 8000);
}

/**
 * 가장 최근에 수행한 카드 이미지 변경 작업을 취소하고 이전 상태로 복구합니다.
 * @returns {Promise<void>} 복구 및 DB 저장 완료 시점을 나타내는 Promise
 */
window.undoLastAction = async function () {
    if (!state.lastAction) return;

    const { index, previousData } = state.lastAction;

    const currentDomNode = state.cards[index].domNode;
    state.cards[index] = {
        ...previousData,
        domNode: currentDomNode
    };

    updateCardBlobUrl(state.cards[index]);
    replaceCardDOM(state.cards[index]);
    updateStats();

    await saveToDB({ originalData: state.originalData, cards: state.cards });

    if (dom.toast) dom.toast.classList.remove('show');
    state.lastAction = null;
};

/**
 * 그리드에서 드래그 앤 드롭으로 파일을 드롭했을 때, 편집기를 열지 않고 즉시 이미지를 적용합니다.
 * @param {File} file - 드롭된 이미지 파일 객체
 * @param {number} cardIndex - 이미지를 적용할 카드의 인덱스
 * @returns {Promise<void>} 이미지 처리 및 적용 완료 시점을 나타내는 Promise
 */
async function processSilentImageDrop(file, cardIndex) {
    if (!file) return;
    const card = state.cards[cardIndex];
    if (!card) return;

    state.lastAction = {
        index: cardIndex,
        previousData: JSON.parse(JSON.stringify(card))
    };

    showLoading(true, '이미지를 적용하는 중...');

    const reader = new FileReader();
    reader.onload = async ev => {
        const dataUrl = ev.target.result;
        const isAnimated = file.type === 'image/gif' || file.type === 'image/webp' || file.name.toLowerCase().endsWith('.gif');

        try {
            const img = await loadSourceImage(dataUrl);
            card.artType = isAnimated ? 'gif' : 'static';
            card.art_mime = file.type || (isAnimated ? 'image/gif' : 'image/png');
            card.adjust_zoom = 1.0;
            card.adjust_offset_x = 0.0;
            card.adjust_offset_y = 0.0;
            card.background_color = 'transparent';
            card.gif_frames = null;

            if (isAnimated) {
                card.png_base64 = dataUrl.split(',')[1];
            } else {
                const targetW = card.width || 1000;
                const targetH = card.height || 760;
                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d', { alpha: true });

                const coverScale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
                const rW = img.naturalWidth * coverScale;
                const rH = img.naturalHeight * coverScale;
                ctx.drawImage(img, (targetW - rW) / 2, (targetH - rH) / 2, rW, rH);

                card.png_base64 = compressCanvasToPngBase64(canvas);
            }

            card.source_png_base64 = dataUrl.split(',')[1];
            card.source_width = img.naturalWidth;
            card.source_height = img.naturalHeight;
            card.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);

            await saveToDB({ singleCard: card });
            updateCardBlobUrl(card);
            replaceCardDOM(card);
            updateStats();
            showToast(`${card.name_kr || card.name_en} 이미지가 변경되었습니다.`, true);
        } catch (err) {
            console.error('Silent drop error:', err);
            alert('이미지 처리 중 오류가 발생했습니다.');
            state.lastAction = null;
        } finally {
            showLoading(false);
        }
    };
    reader.readAsDataURL(file);
}

/**
 * 업로드된 이미지 파일을 읽어 에디터의 상태로 설정하고 프리뷰를 갱신합니다.
 * @param {File} file - 읽을 이미지 파일 객체
 * @returns {void}
 */
function processImageFile(file) {
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

/**
 * 사용자가 새로 업로드한 커스텀 이미지의 원본 파일을 브라우저를 통해 다운로드합니다.
 * @returns {void}
 */
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

/**
 * 상세 에디터 프리뷰 영역의 배경색을 업데이트합니다. 투명(Checkerboard) 모드도 포함합니다.
 * @param {string} color - 설정할 배경색 문자열 (색상 코드 또는 'transparent')
 * @param {boolean} [markDirty=true] - 변경 사항을 Dirty 상태로 표시할지 여부
 * @returns {void}
 */
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

/**
 * 상세 에디터에서 슬라이더를 통해 변경된 줌(Zoom) 및 오프셋(Offset) 값을 기반으로 프리뷰 이미지를 실시간으로 변형(Transform)합니다.
 * @returns {void}
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

    if (state.adjustState.isAnimated) {
        dom.modalPreview.classList.add('hidden');
        dom.modalPreviewAnimated.classList.remove('hidden');

        const animImg = dom.modalPreviewAnimated;
        animImg.src = state.adjustState.sourceDataUrl;

        const coverScale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
        const totalScale = coverScale * zoom;
        const rW = img.naturalWidth * totalScale;
        const rH = img.naturalHeight * totalScale;

        const cx = targetW / 2 + offsetX * (targetW / 2);
        const cy = targetH / 2 + offsetY * (targetH / 2);

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

/**
 * 내부 카드 객체의 보정 데이터(줌, 오프셋, 배경색)를 반영하여 캔버스에 렌더링한 후 PNG Base64 문자열로 반환합니다.
 * @param {object} card - 렌더링할 정보를 가진 카드 객체
 * @returns {Promise<string>} 렌더링된 PNG의 Base64 문자열
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

/**
 * 현재 모달 에디터에서 변경된 모든 설정(이미지, 줌, 오프셋, 배경색 등)을 카드 객체에 반영하고 저장합니다.
 * @returns {Promise<void>} 데이터 반영 및 DB 저장 완료 시점을 나타내는 Promise
 */
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
    await saveToDB({ singleCard: card });
    updateCardBlobUrl(card);
    replaceCardDOM(card);
    updateStats();
    closeModal();
}

/**
 * 현재 편집 중인 카드의 커스텀 이미지와 모든 보정 데이터를 초기화합니다.
 * @returns {Promise<void>} 초기화 및 DB 저장 완료 시점을 나타내는 Promise
 */
async function resetCurrentCard() {
    if (!confirm('이 카드의 커스텀 이미지를 제거하시겠습니까?')) return;
    const card = state.cards[state.editingCardIndex];
    if (!card) return;

    card.png_base64 = '';
    card.source_png_base64 = '';
    card.adjust_zoom = 1.0;
    card.adjust_offset_x = 0.0;
    card.adjust_offset_y = 0.0;
    card.background_color = 'transparent';

    // 상태 초기화
    card.artType = 'static';
    card.art_mime = 'image/png';
    card.gif_frames = null;
    delete card.source_width;
    delete card.source_height;
    delete card.updated_at;

    await saveToDB({ singleCard: card });
    replaceCardDOM(card);
    updateStats();
    closeModal();
}

/**
 * 에디터 내의 슬라이더 값들(줌, 오프셋)을 기본값(100%, 0, 0)으로 초기화합니다.
 * @returns {void}
 */
function resetAdjustValues() {
    dom.zoomSlider.value = 100;
    dom.offsetXSlider.value = 0;
    dom.offsetYSlider.value = 0;
    updateModalPreviewTransform();
}

// ================================================================
// 선택 모드
// ================================================================
/**
 * 카드 다중 선택 모드를 켜거나 끕니다. 모드 전환에 맞춰 UI 레이아웃을 조정합니다.
 * @returns {void}
 */
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

/**
 * 카드 다중 선택 모드를 취소하고 선택된 카드 목록을 비웁니다.
 * @returns {void}
 */
function cancelSelectMode() {
    state.isSelectMode = false;
    document.body.classList.remove('select-mode');
    dom.selectionRemote.classList.add('hidden');
    state.selectedCards.clear();
    updateSelectionUI();
}

/**
 * 선택 모드에서 카드 위로 마우스 버튼을 눌렀을 때 드래그 선택을 시작합니다.
 * @param {number} index - 마우스 이벤트가 발생한 카드의 인덱스
 * @param {MouseEvent} e - 마우스 이벤트 객체
 * @returns {void}
 */
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

/**
 * 드래그 선택 중 마우스가 다른 카드 위로 진입했을 때 선택 범위를 확장/축소합니다.
 * @param {number} index - 마우스가 진입한 카드의 인덱스
 * @returns {void}
 */
function handleCardMouseEnter(index) {
    if (!state.isSelectMode || !state.isDraggingSelection) return;
    updateSelectionRange(state.dragStartIndex, index);
}

/**
 * 마우스 버튼을 떼었을 때 드래그 선택 작업을 종료합니다.
 * @returns {void}
 */
function stopDragSelection() {
    state.isDraggingSelection = false;
    state.dragStartIndex = -1;
    state.dragInitialSelection.clear();
    state.dragAction = null;
}

/**
 * 드래그의 시작점과 끝점 사이의 모든 가시적인 카드를 선택 상태로 업데이트합니다.
 * @param {number} startIdx - 드래그 시작 카드의 인덱스
 * @param {number} endIdx - 드래그 종료 카드의 인덱스
 * @returns {void}
 */
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

/**
 * 현재 화면에 보이고 있는 모든(필터링된) 카드를 한꺼번에 선택하거나 해제합니다.
 * @returns {void}
 */
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

/**
 * 현재 선택된 카드의 개수를 화면에 업데이트하고 카드 아이템의 선택 표시(시각적)를 갱신합니다.
 * @returns {void}
 */
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

/**
 * 카드 객체의 GIF 정보를 바탕으로 개별 애니메이션 프레임을 추출하거나 재생성합니다.
 * @param {object} card - 프레임을 추출할 카드 객체
 * @returns {Promise<array>} 추출된 프레임(Base64 및 딜레이) 데이터 배열
 */
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

/**
 * 현재 수정된 카드들을 STS2 아트팩 형식의 JSON 파일로 생성하여 다운로드합니다.
 * @param {boolean} [selectedOnly=false] - 선택된 카드만 내보낼지 여부
 * @returns {Promise<void>} 파일 생성 및 다운로드 완료 시점을 나타내는 Promise
 */
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
    const versionVal = baseData.version || 1;
    const exportedAt = new Date().toISOString().slice(0, 19);

    jsonParts.push(`{\n  "count": ${modifiedCards.length},\n  "exported_at": "${exportedAt}",\n  "format": "card_art_bundle",\n  "overrides": [\n`);

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
                width: c.width || 1000
            };

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

            const objStr = JSON.stringify(obj, null, 2);
            const lines = objStr.split('\n');
            let indentedObj = '';
            for (let j = 0; j < lines.length; j++) {
                indentedObj += '    ' + lines[j] + (j < lines.length - 1 ? '\n' : '');
            }
            jsonParts.push(indentedObj);

            if (i < modifiedCards.length - 1) {
                jsonParts.push(',\n');
            }

            obj.frames = null;
        }

        jsonParts.push(`\n  ],\n  "version": ${versionVal}\n}`);

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

/**
 * 선택된 카드들을 5열 그리드 형태의 하나의 이미지(PNG)로 합쳐서 내보냅니다.
 * html-to-image 라이브러리를 사용하여 렌더링합니다.
 * @returns {Promise<void>} 이미지 생성 및 다운로드 완료 시점을 나타내는 Promise
 */
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
// IndexedDB
// ================================================================
/**
 * IndexedDB를 열어 'STS2CardArtEditor' 데이터베이스와 'AppData' 저장소 인스턴스를 반환합니다.
 * @returns {Promise<IDBDatabase>} 로드된 텍스트 IDBDatabase 객체
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('STS2CardArtEditor', 2);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('AppData')) {
                db.createObjectStore('AppData');
            }
            if (!db.objectStoreNames.contains('CardOverrides')) {
                db.createObjectStore('CardOverrides', { keyPath: 'source_path' });
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = reject;
    });
}

/**
 * 현재 애플리케이션의 상태(원본 데이터 및 카드 목록)를 IndexedDB에 비동기로 저장합니다.
 * @param {object} value - 저장할 상태 데이터 객체
 * @returns {Promise<void>} 저장 완료 시점을 나타내는 Promise
 */
async function saveToDB(value) {
    try {
        const db = await openDB();

        // 1. 단일 카드만 저장하는 경우 (성능 최적화의 핵심)
        if (value.singleCard) {
            const tx = db.transaction('CardOverrides', 'readwrite');
            const { domNode, blobUrl, frameBlobUrls, ...saveData } = value.singleCard;
            tx.objectStore('CardOverrides').put(saveData);
            return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
        }

        // 2. 전체 상태 저장 (가급적 지양, 벌크 작업용)
        const tx = db.transaction(['AppData', 'CardOverrides'], 'readwrite');

        // 메타 데이터 및 원본 데이터 저장
        if (value.originalData !== undefined) {
            tx.objectStore('AppData').put(value.originalData, 'originalData');
        }

        // 전체 카드 오버라이드 저장
        if (value.cards) {
            const store = tx.objectStore('CardOverrides');
            value.cards.forEach(card => {
                if (card.png_base64) {
                    const { domNode, blobUrl, frameBlobUrls, ...saveData } = card;
                    store.put(saveData);
                }
            });
        }

        return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    } catch (e) {
        console.warn('IndexedDB 저장 실패:', e);
    }
}

/**
 * IndexedDB에 저장된 가장 최근의 애플리케이션 상태 데이터를 로드합니다.
 * @returns {Promise<object|null>} 로드된 상태 데이터 객체 또는 데이터가 없을 경우 null
 */
async function loadFromDB() {
    try {
        const db = await openDB();

        // 1. 구버전 데이터 확인 및 마이그레이션
        const oldTx = db.transaction('AppData', 'readwrite');
        const oldReq = oldTx.objectStore('AppData').get('currentState');
        const oldData = await new Promise(res => { oldReq.onsuccess = () => res(oldReq.result); });

        if (oldData) {
            console.log('구버전 데이터를 발견했습니다. 마이그레이션을 시작합니다...');
            const migTx = db.transaction(['AppData', 'CardOverrides'], 'readwrite');
            if (oldData.originalData) {
                migTx.objectStore('AppData').put(oldData.originalData, 'originalData');
            }
            if (oldData.cards) {
                const store = migTx.objectStore('CardOverrides');
                oldData.cards.forEach(card => {
                    if (card.png_base64) {
                        const { domNode, blobUrl, frameBlobUrls, ...saveData } = card;
                        store.put(saveData);
                    }
                });
            }
            migTx.objectStore('AppData').delete('currentState');
            await new Promise(res => { migTx.oncomplete = res; });
            console.log('마이그레이션 완료.');
        }

        // 2. 새로운 구조로 데이터 로드
        const tx = db.transaction(['AppData', 'CardOverrides'], 'readonly');
        const origReq = tx.objectStore('AppData').get('originalData');
        const overReq = tx.objectStore('CardOverrides').getAll();

        const [originalData, overrides] = await Promise.all([
            new Promise(res => { origReq.onsuccess = () => res(origReq.result); }),
            new Promise(res => { overReq.onsuccess = () => res(overReq.result); })
        ]);

        return { originalData, cards: overrides };
    } catch (e) {
        console.warn('IndexedDB 로드 실패:', e);
        return null;
    }
}

// ================================================================
// 유틸리티
// ================================================================
/**
 * 애플리케이션 상단이나 모달 위에 로딩 스피너와 메시지를 표시하거나 숨깁니다.
 * @param {boolean} show - 표시 여부 (true: 표시, false: 숨김)
 * @param {string} [message='에셋 로딩 중...'] - 표시할 로딩 메시지
 * @returns {void}
 */
function showLoading(show, message = '에셋 로딩 중...') {
    const textEl = document.getElementById('loadingText');
    if (textEl) textEl.textContent = message;
    dom.appLoading.classList.toggle('hidden', !show);
}

/**
 * 기본 콘텐츠 영역의 커스텀 스크롤바 드래그 작업을 종료합니다.
 * @returns {void}
 */
function stopScrollbarDrag() {
    state.isDraggingScrollbar = false;
    document.body.classList.remove('dragging');

    window.removeEventListener('mousemove', handleScrollbarDrag);
    window.removeEventListener('mouseup', stopScrollbarDrag);
}

// ================================================================
// 변경 내역
// ================================================================

/**
 * 외부 changelog.json 파일을 로드하여 변경 내역 데이터를 초기화하고, 새 버전이 있을 경우 모달을 자동으로 엽니다.
 * @returns {Promise<void>} 로딩 및 초기 설정 완료 시점을 나타내는 Promise
 */
async function initChangelog() {
    try {
        const response = await fetch('changelog.json');
        if (!response.ok) throw new Error('ChangeLog 로딩 실패');
        const changelogData = await response.json();
        if (Array.isArray(changelogData) && changelogData.length > 0) {
            state.changelog = changelogData;
            const latestVersion = state.changelog[0].version;
            const lastVersion = localStorage.getItem('sts2_last_changelog_version');
            if (lastVersion !== latestVersion) {
                openChangelogModal(true);
            }
        }
    } catch (err) {
        console.error('ChangeLog load failed:', err);
    }
}

/**
 * 변경 내역(ChangeLog) 모달을 엽니다.
 * @param {boolean} [isAuto=false] - 자동 팝업 여부 (true일 경우 로컬 스토리지에 확인 버전 기록)
 * @returns {void}
 */
function openChangelogModal(isAuto = false) {
    if (!state.changelog) return;
    renderChangelogContent();
    dom.changelogModal.classList.remove('hidden');
    lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        icons: undefined
    }, dom.changelogModal);
    setTimeout(updateChangelogScrollbar, 50);
    if (isAuto) {
        const latestVersion = state.changelog[0].version;
        localStorage.setItem('sts2_last_changelog_version', latestVersion);
    }
}

/**
 * 변경 내역 모달을 닫습니다.
 * @returns {void}
 */
function closeChangelogModal() {
    dom.changelogModal.classList.add('hidden');
    // 버튼 클릭으로 열었을 때도 닫으면 최신 버전을 확인한 것으로 간주
    if (state.changelog && state.changelog.length > 0) {
        const latestVersion = state.changelog[0].version;
        localStorage.setItem('sts2_last_changelog_version', latestVersion);
    }
}

/**
 * state.changelog에 저장된 데이터를 바탕으로 모달 내부의 HTML 콘텐츠를 생성하여 렌더링합니다.
 * @returns {void}
 */
function renderChangelogContent() {
    if (!state.changelog || state.changelog.length === 0) return;

    let html = state.changelog.map(group => {
        const { version, date, notes } = group;
        return `
            <div class="changelog-group">
                <div class="changelog-header">
                    <span class="changelog-version">Ver ${version}</span>
                    <span class="changelog-date">${date}</span>
                </div>
                ${(notes || []).map(note => `
                    <div class="changelog-section">
                        <div class="changelog-title">${note.title}</div>
                        ${note.items && note.items.length > 0 ? `
                        <ul class="changelog-list">
                            ${note.items.map(item => `<li class="changelog-item">${item}</li>`).join('')}
                        </ul>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');

    dom.changelogContent.innerHTML = html;
}

/**
 * 변경 내역 모달 내의 커스텀 스크롤바 위치와 표시 여부를 콘텐츠 높이에 맞춰 업데이트합니다.
 * @returns {void}
 */
function updateChangelogScrollbar() {
    const { changelogContent, modalScrollbarThumb, modalScrollbar } = dom;
    if (!changelogContent || !modalScrollbarThumb || !modalScrollbar) {
        state.isModalScrollUpdating = false;
        return;
    }

    const scrollHeight = changelogContent.scrollHeight;
    const clientHeight = changelogContent.clientHeight;
    const scrollTop = changelogContent.scrollTop;

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

/**
 * 변경 내역 모달의 스크롤바 썸(Thumb)을 마우스로 눌렀을 때 드래그 이동을 시작합니다.
 * @param {MouseEvent} e - 마우스 이벤트 객체
 * @returns {void}
 */
function startChangelogScrollbarDrag(e) {
    state.isDraggingModalScrollbar = true;
    state.modalStartY = e.clientY;
    state.modalStartScrollTop = dom.changelogContent.scrollTop;

    document.body.classList.add('dragging');

    window.addEventListener('mousemove', handleChangelogScrollbarDrag);
    window.addEventListener('mouseup', stopChangelogScrollbarDrag);

    e.preventDefault();
}

/**
 * 변경 내역 모달 스크롤바 드래그 중 마우스 이동에 따라 콘텐츠의 스크롤 위치를 계산하여 적용합니다.
 * @param {MouseEvent} e - 마우스 이벤트 객체
 * @returns {void}
 */
function handleChangelogScrollbarDrag(e) {
    if (!state.isDraggingModalScrollbar) return;

    const deltaY = e.clientY - state.modalStartY;
    const { changelogContent, modalScrollbar, modalScrollbarThumb } = dom;

    const trackHeight = modalScrollbar.clientHeight;
    const thumbHeight = modalScrollbarThumb.clientHeight;
    const maxThumbMove = trackHeight - thumbHeight;
    const maxScroll = changelogContent.scrollHeight - changelogContent.clientHeight;

    if (maxThumbMove <= 0 || maxScroll <= 0) return;

    const scrollDelta = (deltaY / maxThumbMove) * maxScroll;
    changelogContent.scrollTop = state.modalStartScrollTop + scrollDelta;
}

/**
 * 변경 내역 모달의 스크롤바 드래그 작업을 종료합니다.
 * @returns {void}
 */
function stopChangelogScrollbarDrag() {
    state.isDraggingModalScrollbar = false;
    document.body.classList.remove('dragging');

    window.removeEventListener('mousemove', handleChangelogScrollbarDrag);
    window.removeEventListener('mouseup', stopChangelogScrollbarDrag);
}

/**
 * 지정된 URL로부터 이미지를 로드하여 HTMLImageElement 객체를 반환하는 Promise 유틸리티입니다.
 * @param {string} url - 로드할 이미지의 URL
 * @returns {Promise<HTMLImageElement>} 로드된 이미지 객체를 담은 Promise
 */
function loadSourceImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * 메인 카드 그리드 영역의 커스텀 스크롤바 위치와 표시 여부를 현재 스크롤 상태에 맞춰 업데이트합니다.
 * @returns {void}
 */
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

/**
 * 메인 그리드 영역의 커스텀 스크롤바 썸(Thumb)을 마우스로 눌렀을 때 드래그 이동을 시작합니다.
 * @param {MouseEvent} e - 마우스 이벤트 객체
 * @returns {void}
 */
function startScrollbarDrag(e) {
    state.isDraggingScrollbar = true;
    state.startY = e.clientY;
    state.startScrollTop = dom.contentArea.scrollTop;

    document.body.classList.add('dragging');

    window.addEventListener('mousemove', handleScrollbarDrag);
    window.addEventListener('mouseup', stopScrollbarDrag);

    e.preventDefault();
}

/**
 * 메인 그리드 스크롤바 드래그 중 마우스 이동에 따라 콘텐츠의 스크롤 위치를 계산하여 적용합니다.
 * @param {MouseEvent} e - 마우스 이벤트 객체
 * @returns {void}
 */
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

/**
 * 기본 콘텐츠 영역의 커스텀 스크롤바 드래그 작업을 종료합니다.
 * @returns {void}
 */
function stopScrollbarDrag() {
    state.isDraggingScrollbar = false;
    document.body.classList.remove('dragging');

    window.removeEventListener('mousemove', handleScrollbarDrag);
    window.removeEventListener('mouseup', stopScrollbarDrag);
}