const TELEGRAM_MAX_LENGTH = 4000;

/**
 * 텍스트를 Telegram 전송에 안전한 크기로 분할한다.
 * 코드 블록(```)이 잘리는 경우 자동으로 닫고 다음 메시지에서 다시 열어 서식을 유지한다.
 * @param {string} text
 * @param {number} maxLength
 * @returns {Array<string>}
 */
export function splitMessage(text, maxLength = TELEGRAM_MAX_LENGTH) {
  if (!text) return [''];
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeBlockLang = '';

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }

    let chunkText = remaining.substring(0, splitIndex).trim();
    remaining = remaining.substring(splitIndex).trim();

    // 코드 블록 상태 추적 (```)
    const codeBlockMatches = chunkText.match(/```(\w*)/g) || [];
    for (const match of codeBlockMatches) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = match.replace('```', '');
      } else {
        inCodeBlock = false;
        codeBlockLang = '';
      }
    }

    // 청크가 코드 블록 중간에 끊긴 경우 닫아줌
    if (inCodeBlock) {
      chunkText += '\n```';
    }

    chunks.push(chunkText);

    // 다음 청크 시작 시 코드 블록 다시 열어줌
    if (inCodeBlock) {
      remaining = `\`\`\`${codeBlockLang}\n` + remaining;
    }
  }

  return chunks;
}
