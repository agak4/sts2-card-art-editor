'use strict';

let buffer = '';
let inOverrides = false;
let braceCount = 0;
let start = null;
let lastIdx = 0; // 마지막으로 처리한 버퍼의 인덱스
let countFound = false;

self.onmessage = function (e) {
    const { type, chunk, byteLength } = e.data;

    if (type === 'chunk') processChunk(chunk, byteLength);
    if (type === 'end') self.postMessage({ type: 'done' });
};

function processChunk(text, byteLength) {
    buffer += text;

    if (!countFound) {
        const countMatch = buffer.match(/["']count["']\s*:\s*(\d+)/);
        if (countMatch) {
            countFound = true;
            self.postMessage({ type: 'file_count', count: parseInt(countMatch[1], 10) });
        }
    }

    if (!inOverrides) {
        // "overrides" 키를 찾습니다. 공백이나 따옴표 스타일 변동에 대비합니다.
        const keyIdx = buffer.indexOf('"overrides"');
        const altKeyIdx = buffer.indexOf("'overrides'");
        const targetIdx = keyIdx !== -1 ? keyIdx : altKeyIdx;

        if (targetIdx !== -1) {
            // 키 이후에 처음 나타나는 '[' 위치를 찾습니다.
            const startBracketIdx = buffer.indexOf('[', targetIdx);
            if (startBracketIdx !== -1) {
                buffer = buffer.slice(startBracketIdx + 1);
                inOverrides = true;
                lastIdx = 0; // 슬라이스했으므로 인덱스 초기화
            } else {
                // '['가 아직 도착하지 않았을 수 있으므로 대기
                return;
            }
        } else {
            // 키가 없으면 버퍼를 비우되, 키가 잘려 있을 가능성을 위해 끝부분만 남깁니다.
            if (buffer.length > 1000) {
                buffer = buffer.slice(-100);
                lastIdx = 0;
            }
            return;
        }
    }

    // 새로 추가된 부분부터 스캔을 시작합니다.
    for (let i = lastIdx; i < buffer.length; i++) {
        const ch = buffer[i];

        if (ch === '{') {
            if (braceCount === 0) start = i;
            braceCount++;
        } else if (ch === '}') {
            braceCount--;

            if (braceCount === 0 && start !== null) {
                const jsonStr = buffer.slice(start, i + 1);

                try {
                    const obj = JSON.parse(jsonStr);
                    self.postMessage({ type: 'item', data: obj });
                } catch (e) {
                    console.error('JSON Parse Error in Worker:', e);
                }

                // 처리된 부분을 버퍼에서 제거
                buffer = buffer.slice(i + 1);
                i = -1;
                start = null;
                lastIdx = 0;
            }
        }
    }

    // 다음 청크 처리를 위해 현재 인덱스를 저장합니다.
    // 객체 처리 중(braceCount > 0)이라면 start 이후부터 스캔을 재개해야 하므로 적절히 조정합니다.
    lastIdx = Math.max(0, buffer.length);

    // 버퍼가 너무 커지는 것을 방지하되, 현재 처리 중인 객체는 보존합니다.
    const MAX_BUFFER = 10_000_000; // 10MB
    if (braceCount === 0 && buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(-1000);
        lastIdx = 0;
    }

    // 워커가 이번 청크의 처리를 마쳤으므로, 원본 바이트 길이(byteLength)를 메인 스레드에 보고
    self.postMessage({ type: 'progress', bytesProcessed: byteLength || text.length });
}