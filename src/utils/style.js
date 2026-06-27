/*
 * CSS and TTML style helpers for subtitle rendering.
 */

import { parseTTMLColor, parseTTMLLength, parseTTMLLengthPair } from './ttml.js';

export function applyTTMLBorder(element, style, scale) {
    const borders = {
        border: style.border,
        borderTop: style.borderTop,
        borderBottom: style.borderBottom,
        borderLeft: style.borderLeft,
        borderRight: style.borderRight
    };
    Object.keys(borders).forEach((property) => {
        if (!borders[property]) {
            return;
        }
        const value = scaleTTMLBorder(borders[property], scale);
        if (value) {
            element.style[property] = value;
        }
    });
}

export function scaleTTMLBorder(value, scale) {
    const parts = splitStyleTokens(value);
    if (parts.length < 3) {
        return value;
    }
    const width = parseTTMLLength(parts[1], 3840);
    const scaledWidth = width === null ? parts[1] : Math.max(1, width * scale) + 'px';
    return parts[0] + ' ' + scaledWidth + ' ' + parseTTMLColor(parts.slice(2).join(' '));
}

export function scaleTTMLShadow(value, scale) {
    const parts = splitStyleTokens(value);
    if (parts.length < 4) {
        return value;
    }
    const x = parseTTMLLength(parts[0], 3840);
    const y = parseTTMLLength(parts[1], 2160);
    const blur = parseTTMLLength(parts[2], 3840);
    if (x === null || y === null || blur === null) {
        return value;
    }
    return [
        (x * scale) + 'px',
        (y * scale) + 'px',
        (blur * scale) + 'px',
        parseTTMLColor(parts.slice(3).join(' '))
    ].join(' ');
}

export function parseARIBAnimation(value) {
    const parts = splitStyleTokens(value);
    if (parts[2] && /^steps\(/.test(parts[2]) && !/\)$/.test(parts[2]) && parts[3]) {
        parts.splice(2, 2, (parts[2] + parts[3]).replace(/\s+/g, ''));
    }
    if (parts.length < 6 || !isSafeCssIdentifier(parts[0])) {
        return '';
    }
    return [
        parts[0],
        cssTime(parts[1]),
        cssTimingFunction(parts[2]),
        cssTime(parts[3]),
        parts[4],
        cssAnimationDirection(parts[5])
    ].join(' ');
}

export function applyARIBMarquee(element, value) {
    const parts = splitStyleTokens(value);
    if (parts.length < 4) {
        return;
    }
    const style = parts[0];
    const direction = parts[1] === 'reverse' ? 'reverse' : 'forward';
    const speed = parts[2];
    const count = parts[3] === 'infinite' ? 'infinite' : String(Math.max(1, Number(parts[3]) || 1));
    const duration = speed === 'slow' ? '16s' : (speed === 'fast' ? '6s' : '10s');
    element.style.display = element.style.display || 'inline-block';
    element.style.whiteSpace = 'pre';
    element.style.animationName = direction === 'reverse' ? 'aribb62-marquee-reverse' : 'aribb62-marquee-forward';
    element.style.animationDuration = duration;
    element.style.animationTimingFunction = 'linear';
    element.style.animationIterationCount = count;
    element.style.animationFillMode = style === 'scroll' ? 'none' : 'forwards';
    if (style === 'alternate') {
        element.style.animationDirection = 'alternate';
    }
}

export function mapDisplayAlign(value) {
    switch (value) {
        case 'center':
            return 'center';
        case 'after':
            return 'flex-end';
        case 'before':
        default:
            return 'flex-start';
    }
}

export function mapTextAlignItems(value) {
    switch (value) {
        case 'end':
        case 'right':
            return 'flex-end';
        case 'left':
        case 'start':
            return 'flex-start';
        default:
            return 'center';
    }
}

export function mapWritingMode(value) {
    switch (value) {
        case 'lrtb':
        case 'horizontal-tb':
            return { writingMode: 'horizontal-tb', direction: 'ltr' };
        case 'rltb':
            return { writingMode: 'horizontal-tb', direction: 'rtl' };
        case 'tblr':
        case 'vertical-lr':
            return { writingMode: 'vertical-lr', direction: '' };
        case 'tbrl':
        case 'vertical-rl':
            return { writingMode: 'vertical-rl', direction: '' };
        default:
            return { writingMode: '', direction: '' };
    }
}

export function mapARIBFontFamily(value) {
    const text = String(value || '').trim();
    const normalized = text.replace(/^['"]|['"]$/g, '');
    switch (normalized) {
        case '丸ゴシック':
            return '"Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic", "Meiryo", sans-serif';
        case '太丸ゴシック':
            return '"Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic", "Meiryo", sans-serif';
        case '角ゴシック':
            return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif';
        default:
            return text;
    }
}

export function createFontFaceStyleElement(fontFaces) {
    const styleElement = document.createElement('style');
    styleElement.textContent = fontFaces.map((fontFace) => {
        const parts = [
            'font-family: "' + cssEscapeString(fontFace.family) + '"',
            'src: url("' + cssEscapeUrl(fontFace.url) + '")' + (fontFace.format ? ' format("' + cssEscapeString(fontFace.format) + '")' : '')
        ];
        if (fontFace.unicodeRange) {
            parts.push('unicode-range: ' + fontFace.unicodeRange);
        }
        return '@font-face { ' + parts.join('; ') + '; }';
    }).join('\n');
    return styleElement;
}

export function createCueStyleElement(cue, scale) {
    const styleElement = document.createElement('style');
    const css = [];

    if (cue.fontFaces && cue.fontFaces.length > 0) {
        cue.fontFaces.forEach((fontFace) => {
            const parts = [
                'font-family: "' + cssEscapeString(fontFace.family) + '"',
                'src: url("' + cssEscapeUrl(fontFace.url) + '")' + (fontFace.format ? ' format("' + cssEscapeString(fontFace.format) + '")' : '')
            ];
            if (fontFace.unicodeRange) {
                parts.push('unicode-range: ' + fontFace.unicodeRange);
            }
            css.push('@font-face { ' + parts.join('; ') + '; }');
        });
    }

    if (cue.keyframes && cue.keyframes.length > 0) {
        cue.keyframes.forEach((keyframes) => {
            if (!keyframes.name || !isSafeCssIdentifier(keyframes.name) || keyframes.frames.length === 0) {
                return;
            }
            const frames = keyframes.frames.map((frame) => {
                const declarations = keyframeStyleToCSS(frame.style, scale);
                return frame.position + ' { ' + declarations.join('; ') + '; }';
            });
            css.push('@keyframes ' + keyframes.name + ' { ' + frames.join(' ') + ' }');
        });
    }

    if (cue.hasMarquee) {
        css.push('@keyframes aribb62-marquee-forward { from { transform: translateX(-100%); } to { transform: translateX(100%); } }');
        css.push('@keyframes aribb62-marquee-reverse { from { transform: translateX(100%); } to { transform: translateX(-100%); } }');
    }

    styleElement.textContent = css.join('\n');
    return styleElement;
}

export function keyframeStyleToCSS(style, scale) {
    const declarations = [];
    if (style.backgroundColor) {
        declarations.push('background-color: ' + parseTTMLColor(style.backgroundColor));
    }
    if (style.color) {
        declarations.push('color: ' + parseTTMLColor(style.color));
    }
    if (style.fontSize) {
        const pair = parseTTMLLengthPair(style.fontSize, [3840, 2160]);
        const height = pair ? pair[1] : parseTTMLLength(style.fontSize, 2160);
        if (height !== null) {
            declarations.push('font-size: ' + Math.max(10, height * scale) + 'px');
        }
    }
    if (style.extent) {
        const extent = parseTTMLLengthPair(style.extent, [3840, 2160]);
        if (extent) {
            declarations.push('width: ' + (extent[0] * scale) + 'px');
            declarations.push('height: ' + (extent[1] * scale) + 'px');
        }
    }
    if (style.opacity) {
        declarations.push('opacity: ' + style.opacity);
    }
    if (style.origin) {
        const origin = parseTTMLLengthPair(style.origin, [3840, 2160]);
        if (origin) {
            declarations.push('transform: translate(' + (origin[0] * scale) + 'px, ' + (origin[1] * scale) + 'px)');
        }
    }
    return declarations;
}

export function cssEscapeUrl(value) {
    return String(value || '').replace(/["\\\n\r]/g, '\\$&');
}

export function cssEscapeString(value) {
    return String(value || '').replace(/["\\\n\r]/g, '\\$&');
}

export function splitStyleTokens(value) {
    return String(value || '').trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

export function isSafeCssIdentifier(value) {
    return /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(String(value || ''));
}

export function cssTime(value) {
    return /^(?:[0-9.]+m?s|0)$/.test(String(value || '')) ? String(value) : '0ms';
}

export function cssTimingFunction(value) {
    const text = String(value || '');
    if (/^(ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(text)) {
        return text;
    }
    if (/^steps\([0-9]+,(?:start|end)\)$/.test(text.replace(/\s+/g, ''))) {
        return text.replace(/\s+/g, '');
    }
    return 'linear';
}

export function cssAnimationDirection(value) {
    return value === 'alternate' ? 'alternate' : 'normal';
}
