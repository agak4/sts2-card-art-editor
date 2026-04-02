'use strict';

// ================================================================
// 카드 데이터베이스 (cards.csv 임베드)
// [no, name_kr, name_en, character, type, rarity]
// ================================================================
// ================================================================
// 카드 DB 구축 및 조회 (cards.json 파일로부터 비동기 로드)
// ================================================================
let CARDS_DB = [];
const CHAR_NAME_MAP = new Map();
const NAME_MAP = new Map();

// 조회키: 특수문자 제거 후 소문자 (정규표현식 미사용)
function toKey(str) {
    if (!str) return '';
    let result = '';
    const lowerStr = str.toLowerCase();
    for (let i = 0; i < lowerStr.length; i++) {
        const char = lowerStr[i];
        if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
            result += char;
        }
    }
    return result;
}

/**
 * cards.json 파일로부터 카드 데이터베이스를 구축합니다.
 */
async function fetchCardDatabase() {
    try {
        if (typeof CARDS_DB_RAW === 'undefined') {
            throw new Error('cards.js가 로드되지 않았습니다.');
        }
        CARDS_DB = CARDS_DB_RAW;

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
    // res:// 제거 (문자열 리터럴 교체 사용)
    let path = sourcePath;
    if (path.indexOf('res://') === 0) {
        path = path.substring(6);
    }
    const segs = path.split('/');
    const fullFileName = segs.pop() || '';

    // 확장자 제거 (가장 마지막 . 기점으로 자름)
    const lastDotIdx = fullFileName.lastIndexOf('.');
    const fileName = lastDotIdx !== -1 ? fullFileName.substring(0, lastDotIdx) : fullFileName;

    const dirName = (segs.pop() || '').toLowerCase();
    const character = DIR_TO_CHARACTER[dirName] || '';
    const fileKey = toKey(fileName);

    // 1차: 캐릭터+파일명 조합
    const combinedKey = `${toKey(character)}:${fileKey}`;
    if (CHAR_NAME_MAP.has(combinedKey)) return CHAR_NAME_MAP.get(combinedKey);

    // 2차: 파일명만
    if (NAME_MAP.has(fileKey)) return NAME_MAP.get(fileKey);

    // 3차: 파일명 끝의 숫자 접미사 제거 후 재시도 (ex. anger_2 -> anger)
    let endIdx = fileKey.length;
    while (endIdx > 0 && fileKey[endIdx - 1] >= '0' && fileKey[endIdx - 1] <= '9') {
        endIdx--;
    }
    const trimmedKey = fileKey.substring(0, endIdx);

    if (trimmedKey && trimmedKey !== fileKey) {
        const combinedTrimmedKey = `${toKey(character)}:${trimmedKey}`;
        if (CHAR_NAME_MAP.has(combinedTrimmedKey)) return CHAR_NAME_MAP.get(combinedTrimmedKey);
        if (NAME_MAP.has(trimmedKey)) return NAME_MAP.get(trimmedKey);
    }

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
        cardLargePreview: $('cardLargePreview'),
        modalPath: $('modalPath'),
        modalSize: $('modalSize'),
        modalNameKr: $('modalNameKr'),
        zoomSlider: $('zoomSlider'),
        offsetXSlider: $('offsetXSlider'),
        offsetYSlider: $('offsetYSlider'),
        imageInput: $('imageInput'),
        toggleOriginalBtn: $('toggleOriginalBtn'),
    };
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
            width: 1000,
            height: 760,
            png_base64: ''
        };
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initDom();
    bindEvents();
    lucide.createIcons();
    
    // 로딩 화면 표시
    dom.appLoading.classList.remove('hidden');

    // 카드 DB 로드
    await fetchCardDatabase();

    initAllCards();

    const saved = await loadFromDB();
    if (saved) {
        state.originalData = saved.originalData;
        if (saved.cards) {
            saved.cards.forEach(savedCard => {
                const target = state.cards.find(c => c.source_path === savedCard.source_path);
                if (target && savedCard.png_base64) {
                    target.png_base64 = savedCard.png_base64;
                    target.updated_at = savedCard.updated_at;
                }
            });
        }
    }

    state.filteredCards = [...state.cards];
    
    // 이미지 전체 프리로드
    await preloadAllAssets();
    
    // 로딩 화면 숨김
    dom.appLoading.classList.add('hidden');

    renderUI();
});

// 모든 카드 소스 및 프레임 프리로드 함수
async function preloadAllAssets() {
    const uniqueUrls = new Set();
    state.cards.forEach(card => {
        const assets = getCardAssets(card.character, card.cardType, card.rarity);
        Object.values(assets).forEach(url => { if (url) uniqueUrls.add(url); });
        
        let charPrefix = (card.character || '').toLowerCase();
        let imgFileName = `${charPrefix}_${(card.name_en || '').toLowerCase().replace(/ /g, '_')}.webp`;
        let artSrc = card.png_base64 ? `data:image/png;base64,${card.png_base64}` : `source/img/card_images/${imgFileName}`;
        uniqueUrls.add(artSrc);
    });

    const promises = Array.from(uniqueUrls).map(url => {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = resolve; // 실패해도 진행
            img.src = url;
        });
    });
    await Promise.all(promises);
}

// ================================================================
// 이벤트 바인딩
// ================================================================
function bindEvents() {
    dom.fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); });

    // 헤더 버튼
    dom.importBtn.onclick = () => dom.fileInput.click();
    dom.addCardBtn.onclick = addNewCard;
    dom.exportBtn.onclick = exportJSON;

    // 검색
    dom.searchInput.addEventListener('input', () => { filterCards(); });

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
    document.querySelector('.modal-overlay').addEventListener('click', closeModal);
    $('saveEdit').onclick = saveChanges;
    $('resetCardBtn').onclick = resetCurrentCard;
    $('uploadImageBtn').onclick = () => dom.imageInput.click();
    dom.imageInput.addEventListener('change', handleImageUpload);

    // 원본 보기 토글 (완전히 교체 표시)
    dom.toggleOriginalBtn.onclick = () => {
        const isShowingOriginal = !dom.modalPreview.classList.contains('hidden');
        if (isShowingOriginal) {
            dom.modalPreview.classList.add('hidden');
            dom.modalPreviewOriginal.classList.remove('hidden');
            dom.toggleOriginalBtn.innerHTML = '<i data-lucide="image"></i> 커스텀 대상 보기';
        } else {
            dom.modalPreview.classList.remove('hidden');
            dom.modalPreviewOriginal.classList.add('hidden');
            dom.toggleOriginalBtn.innerHTML = '<i data-lucide="eye"></i> 원본(Original) 대상 보기';
        }
        lucide.createIcons();
    };

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
        // 기존 카드 리스트에 업로드된 정보를 덮어씌움
        const overrides = data.overrides || [];
        overrides.forEach(ov => {
            const fileCard = enrichCard(ov);
            const target = state.cards.find(c => c.source_path === fileCard.source_path);
            if (target) {
                target.png_base64 = fileCard.png_base64;
                target.updated_at = fileCard.updated_at;
                target.artType = fileCard.artType;
            } else {
                // 새로운 카드 경로라면 맨 끝에 추가
                state.cards.push(fileCard);
            }
        });

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
    if (dom.cardGrid.children.length === 0) {
        // 최초 1회만 DOM 생성 (no 기준 정렬 됨)
        state.cards.sort((a, b) => (a.no || 9999) - (b.no || 9999));
        const fragment = document.createDocumentFragment();
        state.cards.forEach(card => {
            if (!card.domNode) {
                card.domNode = createCardElement(card);
            }
            fragment.appendChild(card.domNode);
        });
        dom.cardGrid.appendChild(fragment);
    }
    
    // 실제 요소 표시는 filterCards()의 display 토글을 사용함
    filterCards();
}

function replaceCardDOM(card) {
    if (card.domNode) {
        // 기존 DOM 상태 저장
        const isHidden = card.domNode.style.display === 'none';
        const newDom = createCardElement(card);
        newDom.style.display = isHidden ? 'none' : '';
        dom.cardGrid.replaceChild(newDom, card.domNode);
        card.domNode = newDom;
    }
}

function createCardElement(card, index) {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.onclick = () => openEditor(state.cards.indexOf(card));

    const { character, cardType, rarity, name_kr, name_en, no } = card;
    const assets = getCardAssets(character, cardType, rarity);

    let charPrefix = (character || '').toLowerCase();
    let imgFileName = `${charPrefix}_${(name_en || '').toLowerCase().replace(/ /g, '_')}.webp`;
    let artSrc = card.png_base64
        ? `data:image/png;base64,${card.png_base64}`
        : `source/img/card_images/${imgFileName}`;

    const CARD_TYPE_KO = {
        'Attack': '공격',
        'Skill': '스킬',
        'Power': '파워',
        'Status': '상태이상',
        'Curse': '저주'
    };
    const cardTypeKo = CARD_TYPE_KO[cardType] || cardType;

    div.innerHTML = `
    <div class="sts2-card">
      <div class="layer layer-bg" style="background-image:url('${assets.bg}')"></div>
      <div class="layer layer-frame" style="background-image:url('${assets.frame}')"></div>
      <div class="layer layer-banner" style="background-image:url('${assets.banner}')"></div>
      <div class="layer layer-type" style="background-image:url('${assets.type}')"></div>
      ${assets.orb ? `<div class="layer layer-orb" style="background-image:url('${assets.orb}')"></div>` : ''}
      <div class="layer layer-art">
        <img src="${artSrc}" alt="${name_en || name_kr}"
             onerror="this.onerror=null;this.src='source/img/card_frame/273px-StS2_AncientCardHighlight.png'">
      </div>
      <div class="layer layer-text">
        <div class="card-name-overlay">${name_kr || name_en}</div>
      </div>
      <div class="layer layer-text">
        <div class="card-type-overlay">${cardTypeKo}</div>
      </div>
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
    const p = 'source/img/card_frame/273px-StS2_';
    const miscChars = MISC_CHARACTER;
    const isMisc = miscChars.has(character);

    const rarityMap = { Starter: 'Common', Common: 'Common', Uncommon: 'Uncommon', Rare: 'Rare', Ancient: 'Rare', Misc: 'Uncommon' };
    const r = rarityMap[rarity] || 'Common';

    if (isMisc) {
        const t = character === 'Status' ? 'Status' : character === 'Curse' ? 'Curse' : 'Quest';
        return { bg: `${p}Bg${t}.png`, frame: `${p}Frame${t}.png`, banner: `${p}Banner${t}.png`, orb: '', type: `${p}Type${r}.png` };
    }

    const c = character === 'Ancient' ? 'Colorless' : character;
    const t = ['Attack', 'Skill', 'Power'].includes(cardType) ? cardType : 'Skill';

    return {
        bg: `${p}Bg${t}${c}.png`,
        frame: `${p}Frame${t}${r}.png`,
        banner: `${p}Banner${r}.png`,
        orb: `${p}Card${c}Orb.png`,
        type: `${p}Type${r}.png`
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

    let visibleCount = 0;
    state.cards.forEach(card => {
        const c = card.character || '';
        const t = card.cardType || '';
        const r = card.rarity || '';

        // 캐릭터 필터
        const matchChar = character === 'all' ? true
            : character === 'misc' ? MISC_CHARACTER.has(c)
            : character === 'Ancient' ? r === 'Ancient'
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

        const isVisible = matchChar && matchType && matchRarity && matchSearch;
        
        if (card.domNode) {
            card.domNode.style.display = isVisible ? '' : 'none';
        }
        
        if (isVisible) visibleCount++;
    });

    state.filteredCards = state.cards; // 하위 호환성을 위해 유지
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
    
    // 새 카드의 DOM 생성 및 추가
    newCard.domNode = createCardElement(newCard);
    dom.cardGrid.appendChild(newCard.domNode);
    
    filterCards();
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

    let charPrefix = (card.character || '').toLowerCase();
    let imgFileName = `${charPrefix}_${(card.name_en || '').toLowerCase().replace(/ /g, '_')}.webp`;
    let fallbackSrc = `source/img/card_frame/273px-StS2_AncientCardHighlight.png`;
    let defaultArtSrc = `source/img/card_images/${imgFileName}`;

    const artSrc = card.png_base64
        ? `data:image/png;base64,${card.png_base64}`
        : defaultArtSrc;

    // 카드의 모든 프레임 요소를 모달용으로 렌더링
    const assets = getCardAssets(card.character, card.cardType, card.rarity);
    const CARD_TYPE_KO = { 'Attack': '공격', 'Skill': '스킬', 'Power': '파워', 'Status': '상태이상', 'Curse': '저주' };
    const cardTypeKo = CARD_TYPE_KO[card.cardType] || card.cardType;

    dom.cardLargePreview.innerHTML = `
      <div class="sts2-card">
        <div class="layer layer-bg" style="background-image:url('${assets.bg}')"></div>
        <div class="layer layer-frame" style="background-image:url('${assets.frame}')"></div>
        <div class="layer layer-banner" style="background-image:url('${assets.banner}')"></div>
        <div class="layer layer-type" style="background-image:url('${assets.type}')"></div>
        ${assets.orb ? `<div class="layer layer-orb" style="background-image:url('${assets.orb}')"></div>` : ''}
        <div class="layer layer-art">
          <img id="modalPreviewOriginal" class="hidden" src="${defaultArtSrc}" onerror="this.onerror=null;this.src='${fallbackSrc}'" style="position:absolute; width:100%; height:100%; object-fit:cover;">
          <img id="modalPreview" src="${artSrc}" onerror="this.onerror=null;this.src='${fallbackSrc}'" style="position:absolute; width:100%; height:100%; object-fit:cover;">
        </div>
        <div class="layer layer-text">
          <div class="card-name-overlay">${card.name_kr || card.name_en}</div>
        </div>
        <div class="layer layer-text">
          <div class="card-type-overlay">${cardTypeKo}</div>
        </div>
      </div>
    `;

    // DOM 참조 동적 갱신
    dom.modalPreviewOriginal = document.getElementById('modalPreviewOriginal');
    dom.modalPreview = document.getElementById('modalPreview');

    dom.modalPath.textContent = card.source_path || 'N/A';
    dom.modalSize.textContent = `${card.width || 1000} × ${card.height || 760}`;
    dom.modalNameKr.textContent = card.name_kr ? `${card.name_kr} (${card.name_en || ''})` : (card.name_en || '');

    dom.zoomSlider.value = 100;
    dom.offsetXSlider.value = 0;
    dom.offsetYSlider.value = 0;
    dom.modalPreview.style.transform = '';

    // Reset toggle state
    dom.modalPreview.classList.remove('hidden');
    dom.toggleOriginalBtn.innerHTML = '<i data-lucide="eye"></i> 원본(Original) 대상 보기';

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
        replaceCardDOM(card);
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
    replaceCardDOM(card);
    closeModal();
}

// ================================================================
// 내보내기
// ================================================================
function exportJSON() {
    // 수정된(커스텀 이미지가 있는) 카드만 내보내기
    const modifiedCards = state.cards.filter(c => c.png_base64 && c.png_base64.length > 0);

    // artType → type 으로 복원 (artpack 포맷 유지)
    const overrides = modifiedCards.map(card => {
        const { artType, no, name_kr, name_en, character, cardType, rarity, ...rest } = card;
        return { ...rest, type: artType };
    });

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