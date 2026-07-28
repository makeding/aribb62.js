export function appendTTMLTextWithSVGGlyphs(element, text, fontFaces) {
    const chars = Array.from(String(text || ''));
    let textBuffer = '';
    chars.forEach((char) => {
        const glyph = findSVGGlyph(fontFaces, char);
        if (!glyph) {
            textBuffer += char;
            return;
        }
        if (textBuffer) {
            element.appendChild(document.createTextNode(textBuffer));
            textBuffer = '';
        }
        element.appendChild(createSVGGlyphElement(glyph));
    });
    if (textBuffer) {
        element.appendChild(document.createTextNode(textBuffer));
    }
}

export function findSVGGlyph(fontFaces, char) {
    if (!fontFaces || !char) {
        return null;
    }
    const codePoint = char.codePointAt(0);
    for (let i = 0; i < fontFaces.length; i++) {
        const fontFace = fontFaces[i];
        if (fontFace && fontFace.svgGlyphs && fontFace.svgGlyphs[codePoint]) {
            return fontFace.svgGlyphs[codePoint];
        }
    }
    return null;
}

export function createSVGGlyphElement(glyph) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    const path = document.createElementNS(namespace, 'path');
    const unitsPerEm = glyph.unitsPerEm || 360;
    const advance = glyph.horizAdvX || unitsPerEm;
    const ascent = glyph.ascent || unitsPerEm;
    const descent = glyph.descent || 0;
    const height = ascent + Math.abs(descent);

    svg.setAttribute('viewBox', '0 0 ' + advance + ' ' + height);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'inline-block';
    svg.style.width = (advance / unitsPerEm) + 'em';
    svg.style.height = '1em';
    svg.style.verticalAlign = '-0.08em';
    svg.style.overflow = 'visible';
    path.setAttribute('d', glyph.path);
    path.setAttribute('fill', 'currentColor');
    path.style.stroke = 'var(--aribb62-stroke-color, transparent)';
    path.style.strokeWidth = 'var(--aribb62-stroke-width, 0px)';
    path.style.strokeLinecap = 'round';
    path.style.strokeLinejoin = 'round';
    path.style.paintOrder = 'stroke fill';
    path.setAttribute('transform', 'translate(0 ' + ascent + ') scale(1 -1)');
    svg.appendChild(path);
    return svg;
}
