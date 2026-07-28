export function collectPushResultFontFaces(cues, eventCount) {
    const fontFaces = [];
    const seen = {};
    cues.forEach((cue) => {
        (cue.fontFaces || []).forEach((fontFace, index) => {
            const key = [
                fontFace.family || '',
                fontFace.url || '',
                fontFace.format || '',
                fontFace.unicodeRange || ''
            ].join('\n');
            if (seen[key]) {
                return;
            }
            seen[key] = true;
            const format = String(fontFace.format || '').toLowerCase();
            fontFaces.push({
                family: fontFace.family || '',
                url: fontFace.url || '',
                src: fontFace.src || '',
                resourceIndex: Number.isFinite(fontFace.resourceIndex) ? fontFace.resourceIndex : null,
                format: fontFace.format || '',
                unicodeRange: fontFace.unicodeRange || '',
                downloadName: buildFontFaceDownloadName(fontFace, eventCount, index, format)
            });
        });
    });
    return fontFaces;
}

export function buildFontFaceDownloadName(fontFace, eventCount, index, format) {
    const family = String(fontFace.family || 'font')
        .replace(/[^0-9A-Za-z._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'font';
    const extension = format === 'woff' ? 'woff' : (format === 'svg' ? 'svg' : 'bin');
    return 'aribb62-event-' + eventCount + '-font-' + index + '-' + family + '.' + extension;
}
