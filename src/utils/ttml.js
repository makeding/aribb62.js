/*
 * Scalar ARIB-TTML parsing helpers.
 */

import { getTTMLAttr } from './dom.js';
import { formatNumber } from './text.js';

export function parseTTMLPlane(ttNode) {
    const extent = getTTMLAttr(ttNode, 'extent');
    const parsed = parseTTMLLengthPair(extent, [3840, 2160]);
    return parsed || [3840, 2160];
}

export function parseTTMLLengthPair(value, plane) {
    if (!value) {
        return null;
    }
    const parts = value.trim().split(/\s+/);
    if (parts.length === 1) {
        const single = parseTTMLLength(parts[0], plane[1]);
        return single === null ? null : [single, single];
    }
    const x = parseTTMLLength(parts[0], plane[0]);
    const y = parseTTMLLength(parts[1], plane[1]);
    return x === null || y === null ? null : [x, y];
}

export function parseTTMLLength(value, base) {
    if (!value) {
        return null;
    }
    const text = String(value).trim();
    if (/%$/.test(text)) {
        return parseFloat(text) * base / 100;
    }
    if (/px$/.test(text)) {
        return parseFloat(text);
    }
    const parsed = parseFloat(text);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parseTTMLTime(value) {
    if (!value) {
        return null;
    }
    const text = String(value).trim();
    if (text === 'indefinite') {
        return Infinity;
    }
    const clock = text.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (clock) {
        return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + parseFraction(clock[4]);
    }
    const seconds = text.match(/^([0-9.]+)s$/);
    if (seconds) {
        return Number(seconds[1]);
    }
    const millis = text.match(/^([0-9.]+)ms$/);
    if (millis) {
        return Number(millis[1]) / 1000;
    }
    return null;
}

export function parseFraction(value) {
    if (!value) {
        return 0;
    }
    return Number('0.' + value);
}

export function parseTTMLColor(value) {
    const text = String(value || '').trim();
    const named = {
        black: '#000000',
        white: '#ffffff',
        red: '#ff0000',
        green: '#00ff00',
        blue: '#0000ff',
        yellow: '#ffff00',
        cyan: '#00ffff',
        magenta: '#ff00ff',
        transparent: 'rgba(0, 0, 0, 0)'
    };
    if (named[text.toLowerCase()]) {
        return named[text.toLowerCase()];
    }
    const hex = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (!hex) {
        return text;
    }
    if (!hex[2]) {
        return '#' + hex[1];
    }
    const r = parseInt(hex[1].slice(0, 2), 16);
    const g = parseInt(hex[1].slice(2, 4), 16);
    const b = parseInt(hex[1].slice(4, 6), 16);
    const a = parseInt(hex[2], 16) / 255;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + formatNumber(a, 3) + ')';
}
