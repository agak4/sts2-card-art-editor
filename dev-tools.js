/**
 * 개발자 전용 도구를 관리하는 스크립트입니다.
 * 개발 환경(localhost, 127.0.0.1, ?dev=true)에서만 활성화됩니다.
 */
(function () {
    'use strict';

    // 개발 모드 여부 확인
    const isDev = location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        new URLSearchParams(window.location.search).has('dev');

    if (!isDev) return;

    /**
     * 개발자 도구 UI를 사이드바에 추가합니다.
     */
    function initDevTools() {
        // 기존 뱃지 토글 그룹 찾기 (수정됨 뱃지 표시)
        const badgeToggleElement = document.getElementById('badgeToggle');
        if (!badgeToggleElement) return;

        const badgeToggleGroup = badgeToggleElement.closest('.badge-toggle-group');
        if (!badgeToggleGroup) return;

        // 개발자 도구 섹션 생성
        const devSection = document.createElement('div');
        devSection.className = 'filter-group dev-group';
        devSection.style.marginTop = '16px';
        devSection.style.paddingTop = '16px';
        devSection.style.borderTop = '1px dashed rgba(212, 175, 55, 0.3)';

        const devLabel = document.createElement('p');
        devLabel.className = 'filter-group-label';
        devLabel.style.fontSize = '14px';
        devLabel.style.color = 'var(--gold)';
        devLabel.style.marginBottom = '8px';
        devLabel.textContent = '개발자 도구 (Dev Only)';

        // 1px 투명 PNG 교체 버튼 생성
        const clearBtn = document.createElement('button');
        clearBtn.id = 'clearAllCardImagesBtn';
        clearBtn.className = 'btn btn-danger btn-full';
        clearBtn.style.padding = '10px';
        clearBtn.style.fontSize = '13px';
        clearBtn.innerHTML = '<i data-lucide="image-minus"></i> 모든 카드 1px 투명화';

        devSection.appendChild(devLabel);
        devSection.appendChild(clearBtn);

        // '수정됨 뱃지 표시' 그룹 뒤에 삽입
        if (badgeToggleGroup.parentNode) {
            badgeToggleGroup.parentNode.insertBefore(devSection, badgeToggleGroup.nextSibling);
        }

        // 버튼 클릭 이벤트 바인딩
        clearBtn.onclick = handleClearAllImages;

        // Lucide 아이콘 생성
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * 모든 카드의 이미지를 1px 투명 PNG로 교체합니다.
     */
    async function handleClearAllImages() {
        if (!confirm('정말로 모든 카드의 이미지를 1px 투명 PNG로 교체하시겠습니까?\n이 작업은 데이터베이스에 즉시 저장되며 되돌릴 수 없습니다.')) {
            return;
        }

        // 1x1 투명 PNG 동적 생성 (브라우저 Canvas 로직 활용)
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        
        let transparentPngBase64 = '';
        if (typeof compressCanvasToPngBase64 === 'function') {
            // script.js의 압축 로직 사용
            transparentPngBase64 = compressCanvasToPngBase64(canvas);
        } else {
            // 기본 브라우저 내장 로직 사용
            transparentPngBase64 = canvas.toDataURL('image/png').split(',')[1];
        }

        const TRANSPARENT_PNG_BASE64 = transparentPngBase64;

        try {
            // state.cards는 script.js의 전역 변수
            if (typeof state === 'undefined' || !state.cards) {
                alert('카드 데이터를 찾을 수 없습니다.');
                return;
            }

            state.cards.forEach(card => {
                // 이미 이미지가 있거나 수정된 상태로 간주하여 교체
                card.png_base64 = TRANSPARENT_PNG_BASE64;
                card.source_png_base64 = TRANSPARENT_PNG_BASE64;
                card.artType = 'static';
                card.art_mime = 'image/png';
                card.adjust_zoom = 1.0;
                card.adjust_offset_x = 0.0;
                card.adjust_offset_y = 0.0;
                card.background_color = 'transparent';
                card.updated_at = new Date().toISOString();

                // Blob URL 갱신 (script.js 함수)
                if (typeof updateCardBlobUrl === 'function') {
                    updateCardBlobUrl(card);
                }
            });

            // UI 갱신 (script.js 함수)
            if (typeof renderUI === 'function') {
                renderUI();
            }

            // DB 저장 (script.js 함수)
            if (typeof saveToDB === 'function') {
                await saveToDB();
            }

            // 알림 표시 (script.js 함수)
            if (typeof showToast === 'function') {
                showToast('모든 카드 이미지가 1px 투명 PNG로 교체되었습니다.');
            } else {
                alert('완료되었습니다.');
            }

        } catch (err) {
            console.error('이미지 교체 중 오류 발생:', err);
            alert('오류가 발생했습니다: ' + err.message);
        }
    }

    // 초기화 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDevTools);
    } else {
        initDevTools();
    }

})();
