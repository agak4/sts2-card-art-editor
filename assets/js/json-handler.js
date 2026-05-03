'use strict';

// ================================================================
// 아트팩 JSON - 임포트
// ================================================================

/**
 * FileList를 받아 각 파일을 순차적으로 Worker로 처리하고 최종 결과를 알립니다.
 * @param {FileList} files - 업로드된 파일 목록
 * @returns {Promise<void>}
 */
async function handleFileUpload(files) {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // 수정된 카드가 있을 경우, 처리 전에 사용자에게 처리 방식을 묻습니다.
    const hasModified = state.cards.some(c => c.png_base64);
    if (hasModified) {
        const choice = await askImportChoice();
        if (choice === 'cancel') return;
        if (choice === 'reset') {
            await resetToCleanState();
            dom.cardGrid.innerHTML = '';
            renderCardGrid();
        }
    }

    let totalProcessed = 0;
    const totalSize = fileArray.reduce((acc, file) => acc + file.size, 0);
    let previousFilesLoadedBytes = 0;

    let globalTotalCards = 0;
    let globalProcessedCards = 0;

    for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const filePrefix = fileArray.length > 1 ? `[${i + 1}/${fileArray.length}] ` : '';
        console.log(`[파일 업로드 시작] ${file.name}`);

        let lastReportedPct = -1;

        const count = await streamImportWithWorker(file, {
            onProgress: (currentFileLoadedBytes) => {
                const currentTotalLoaded = previousFilesLoadedBytes + currentFileLoadedBytes;
                const overallPct = totalSize > 0 ? (currentTotalLoaded / totalSize) * 100 : 0;
                const steppedPct = Math.floor(overallPct / 5) * 5;

                if (steppedPct !== lastReportedPct) {
                    const countStr = globalTotalCards > 0 ? `\n[${globalProcessedCards} / ${globalTotalCards}]` : `\n[${globalProcessedCards}개 처리]`;
                    showLoading(true, `전체 진행 중... ${filePrefix}(${steppedPct}%)${countStr}`, steppedPct);

                    lastReportedPct = steppedPct;
                }
            },
            onFileCount: (c) => globalTotalCards += c,
            onItemParsed: () => globalProcessedCards++
        });

        totalProcessed += count;
        previousFilesLoadedBytes += file.size;

        // 파일 단위 작업 완료 시 강제 동기화
        const overallPct = totalSize > 0 ? (previousFilesLoadedBytes / totalSize) * 100 : 0;
        const steppedPct = i === fileArray.length - 1 ? 100 : Math.floor(overallPct / 5) * 5;
        const countStr = globalTotalCards > 0 ? `\n[${globalProcessedCards} / ${globalTotalCards}]` : `\n[${globalProcessedCards}개 처리]`;
        showLoading(true, `전체 진행 중... ${filePrefix}(${steppedPct}%)${countStr}`, steppedPct);
    }

    renderUI();

    // 100% 진행률과 애니메이션이 화면에 표시되도록 잠시 대기
    await new Promise(resolve => setTimeout(resolve, 150));

    showLoading(false);
}

/**
 * 임포트 선택 모달을 열고 사용자의 선택('merge', 'reset', 'cancel')을 Promise로 반환합니다.
 * @returns {Promise<'merge'|'reset'|'cancel'>}
 */
function askImportChoice() {
    return new Promise((resolve) => {
        showImportChoiceModal();

        const mergeBtn = dom.importMergeBtn;
        const resetBtn = dom.importResetBtn;
        const cancelBtn = dom.cancelImportBtn;
        const overlay = dom.importChoiceModal.querySelector('.modal-overlay');

        const onMerge = () => { cleanup(); resolve('merge'); };
        const onReset = () => { cleanup(); resolve('reset'); };
        const onCancel = () => { cleanup(); resolve('cancel'); };

        function cleanup() {
            hideImportChoiceModal();
            mergeBtn.removeEventListener('click', onMerge);
            resetBtn.removeEventListener('click', onReset);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onCancel);
        }

        mergeBtn.addEventListener('click', onMerge, { once: true });
        resetBtn.addEventListener('click', onReset, { once: true });
        cancelBtn.addEventListener('click', onCancel, { once: true });
        overlay.addEventListener('click', onCancel, { once: true });
    });
}


/**
 * 단일 파일을 ReadableStream으로 읽어 Worker에 청크 단위로 전달하고, 처리된 카드 개수를 반환합니다.
 * @param {File} file - 처리할 .cardartpack.json 파일
 * @param {object} [callbacks] - 각종 진행 상태를 받는 콜백 객체 {onProgress, onFileCount, onItemParsed}
 * @returns {Promise<number>} 처리된 카드(override) 개수
 */
async function streamImportWithWorker(file, callbacks = {}) {
    return new Promise((resolve) => {
        const worker = new Worker('assets/js/worker.js');
        const reader = file.stream().getReader();
        const decoder = new TextDecoder();

        let processed = 0;
        let loadedBytes = 0;

        worker.onmessage = async (e) => {
            try {
                const { type, data, bytesProcessed, count } = e.data;

                if (type === 'file_count') {
                    if (callbacks.onFileCount) callbacks.onFileCount(count);
                }

                if (type === 'progress') {
                    loadedBytes += bytesProcessed;
                    if (callbacks.onProgress && file.size > 0) {
                        callbacks.onProgress(loadedBytes);
                    }
                }

                if (type === 'item') {
                    applyOverrideStreaming(data);
                    processed++;
                    if (callbacks.onItemParsed) callbacks.onItemParsed();

                    if (processed % 50 === 0) {
                        updateStats();
                    }
                }

                if (type === 'done') {
                    await saveToDB({ originalData: { streamed: true }, cards: state.cards });
                    worker.terminate();
                    resolve(processed);
                }
            } catch (err) {
                console.error('[Worker onmessage Error]', err);
            }
        };

        (async () => {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                worker.postMessage({ type: 'chunk', chunk: text, byteLength: value.byteLength });
            }
            worker.postMessage({ type: 'end' });
        })();
    });
}

/**
 * Worker에서 파싱된 단일 override 객체를 상태(state)에 적용합니다.
 * @param {object} ov - Worker가 파싱한 raw override 객체
 * @returns {void}
 */
function applyOverrideStreaming(ov) {
    const fileCard = enrichCard(ov);
    let sPath = fileCard.source_path || '';
    if (sPath.startsWith('res://')) sPath = sPath.substring(6);

    let target = CARD_INDEX.get(sPath)
        || CARD_INDEX.get(fileCard.name_en);

    if (!target) return;

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
    replaceCardDOM(target);
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

// ================================================================
// 아트팩 JSON - 카드 데이터 보강(Enrich)
// ================================================================

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

// ================================================================
// 아트팩 JSON - 익스포트
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

    const targetW = card.width || 1000;
    const targetH = card.height || 760;
    const zoom = card.adjust_zoom || 1.0;
    const offsetX = card.adjust_offset_x || 0.0;
    const offsetY = card.adjust_offset_y || 0.0;

    try {
        if ('ImageDecoder' in window && card.png_base64) {
            const artMime = card.art_mime || (card.png_base64.startsWith('R0lGOD') ? 'image/gif' : 'image/webp');
            const binary = atob(card.png_base64);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);

            const decoder = new ImageDecoder({ data: array.buffer, type: artMime });
            await decoder.tracks.ready;
            const track = decoder.tracks.selectedTrack;

            if (track.animated) {
                const outCanvas = document.createElement('canvas');
                outCanvas.width = targetW;
                outCanvas.height = targetH;
                const outCtx = outCanvas.getContext('2d', { alpha: true });

                const resultFrames = [];
                for (let i = 0; i < track.frameCount; i++) {
                    const result = await decoder.decode({ frameIndex: i });
                    const image = result.image;

                    const coverScale = Math.max(targetW / image.displayWidth, targetH / image.displayHeight);
                    const totalScale = coverScale * zoom;
                    const rW = image.displayWidth * totalScale;
                    const rH = image.displayHeight * totalScale;
                    const cx = targetW / 2 + offsetX * (targetW / 2);
                    const cy = targetH / 2 + offsetY * (targetH / 2);

                    outCtx.clearRect(0, 0, targetW, targetH);
                    if (card.background_color && card.background_color !== 'transparent') {
                        outCtx.fillStyle = card.background_color;
                        outCtx.fillRect(0, 0, targetW, targetH);
                    }
                    outCtx.drawImage(image, cx - rW / 2, cy - rH / 2, rW, rH);

                    const pngBase64 = compressCanvasToPngBase64(outCanvas);
                    const delaySec = image.duration ? image.duration / 1000000 : 0.1;

                    const lastFrame = resultFrames[resultFrames.length - 1];
                    if (lastFrame && lastFrame.png_base64 === pngBase64) {
                        lastFrame.delay += delaySec;
                    } else {
                        resultFrames.push({
                            png_base64: pngBase64,
                            delay: delaySec
                        });
                    }
                    image.close();
                }

                if (resultFrames.length > 0) {
                    card.gif_frames = resultFrames;
                    return resultFrames;
                }
            }
        }

        if (card.gif_frames && card.gif_frames.length > 0) {
            const outCanvas = document.createElement('canvas');
            outCanvas.width = targetW;
            outCanvas.height = targetH;
            const outCtx = outCanvas.getContext('2d', { alpha: true });
            const resultFrames = [];

            for (const f of card.gif_frames) {
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

                const pngBase64 = compressCanvasToPngBase64(outCanvas);

                const lastFrame = resultFrames[resultFrames.length - 1];
                if (lastFrame && lastFrame.png_base64 === pngBase64) {
                    lastFrame.delay += f.delay;
                } else {
                    resultFrames.push({
                        png_base64: pngBase64,
                        delay: f.delay
                    });
                }
            }
            card.gif_frames = resultFrames;
            return resultFrames;
        }

        throw new Error("처리 가능한 애니메이션 데이터가 없습니다.");

    } catch (e) {
        console.warn('애니메이션 프레임 추출 실패, 정적 렌더링으로 폴백:', e);
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
