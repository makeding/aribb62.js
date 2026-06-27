/*
 * Text formatting helpers used by parser diagnostics and inline TTML text.
 */

export function previewTTMLCues(cues, text) {
    const parts = [];
    cues.forEach((cue) => {
        cue.blocks.forEach((block) => {
            block.spans.forEach((span) => {
                if (span.text) {
                    parts.push(span.text);
                }
            });
        });
    });
    let preview = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!preview && text) {
        preview = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
}

export function formatTextCodePoints(text) {
    return Array.from(String(text || '')).map((char) => {
        const code = char.codePointAt(0).toString(16).toUpperCase();
        return char + '=U+' + code.padStart(4, '0');
    }).join(' ');
}

export function normalizeTTMLText(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \f\v]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .trim();
}

export function formatNumber(value, digits) {
    return Number(value).toFixed(digits).replace(/\.?0+$/, '');
}
