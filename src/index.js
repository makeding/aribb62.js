/*
 * ARIB-TTML subtitle parser/renderer for MMTS subtitle payloads.
 *
 * This renderer intentionally keeps the MMTS subtitle path native instead of
 * converting TTML back to ARIB B24. It accepts decoded TTML payloads from
 * MMTS_SUBTITLE_DATA_ARRIVED and renders positioned text into a DOM overlay.
 */

class B62TTMLRenderer {
    constructor(options) {
        options = options || {};
        this._overlay = options.overlayElement || null;
        this._mediaElement = options.mediaElement || null;
        this._isLive = !!options.isLive;
        this._maxCues = options.maxCues || 300;
        this._cues = [];
        this._lastCueKey = null;
        this._clockId = null;
        this._eventCount = 0;
        this._prepareOverlayElement();

        if (this._mediaElement) {
            this.attachMediaElement(this._mediaElement);
        }
    }

    attachMediaElement(mediaElement) {
        this.detachMediaElement();
        this._mediaElement = mediaElement;
        if (!mediaElement) {
            return;
        }

        this._boundRender = this._boundRender || this.render.bind(this);
        this._boundStartClock = this._boundStartClock || this.startClock.bind(this);
        this._boundStopClock = this._boundStopClock || this.stopClock.bind(this);
        mediaElement.addEventListener('timeupdate', this._boundRender);
        mediaElement.addEventListener('seeked', this._boundRender);
        mediaElement.addEventListener('resize', this._boundRender);
        mediaElement.addEventListener('play', this._boundStartClock);
        mediaElement.addEventListener('pause', this._boundStopClock);
        this.startClock();
    }

    detachMediaElement() {
        this.stopClock();
        if (!this._mediaElement) {
            return;
        }

        this._mediaElement.removeEventListener('timeupdate', this._boundRender);
        this._mediaElement.removeEventListener('seeked', this._boundRender);
        this._mediaElement.removeEventListener('resize', this._boundRender);
        this._mediaElement.removeEventListener('play', this._boundStartClock);
        this._mediaElement.removeEventListener('pause', this._boundStopClock);
        this._mediaElement = null;
    }

    setOverlayElement(overlayElement) {
        this._overlay = overlayElement || null;
        this._prepareOverlayElement();
        this.render();
    }

    setLive(isLive) {
        this._isLive = !!isLive;
    }

    startClock() {
        if (this._clockId !== null || typeof window === 'undefined' || !window.requestAnimationFrame) {
            return;
        }

        const tick = () => {
            this._clockId = window.requestAnimationFrame(tick);
            this.render();
        };
        this._clockId = window.requestAnimationFrame(tick);
    }

    stopClock() {
        if (this._clockId === null || typeof window === 'undefined' || !window.cancelAnimationFrame) {
            this._clockId = null;
            return;
        }

        window.cancelAnimationFrame(this._clockId);
        this._clockId = null;
    }

    destroy() {
        this.detachMediaElement();
        this.clear();
        this._overlay = null;
    }

    clear() {
        this._cues = [];
        this._lastCueKey = null;
        if (this._overlay) {
            this._overlay.innerHTML = '';
        }
    }

    reset() {
        this.clear();
        this._eventCount = 0;
    }

    push(data) {
        const text = this._decodeText(data);
        this._eventCount++;

        if (!text) {
            return this._buildPushResult(data, '', [], null, null, false);
        }

        const currentTime = this._currentTime();
        const basePts = this._basePts(data);
        let effectiveBasePts = basePts;
        let arrivalAligned = false;
        const live = this._isLive || (this._mediaElement && this._mediaElement.duration === Infinity);

        if (effectiveBasePts !== null && live && Math.abs(effectiveBasePts - currentTime) > 10) {
            effectiveBasePts = currentTime;
        }
        if (effectiveBasePts === null && live) {
            effectiveBasePts = currentTime;
            arrivalAligned = true;
        }

        const cues = parseARIBTTML(text, effectiveBasePts, currentTime, arrivalAligned);
        if (cues.length === 0) {
            const start = effectiveBasePts !== null ? effectiveBasePts : currentTime;
            this._addCue({
                key: 'clear:' + start + ':event:' + this._eventCount,
                start: start,
                end: start + 0.05,
                clear: true,
                plane: [3840, 2160],
                blocks: []
            });
        } else {
            cues.forEach((cue, index) => {
                cue.key += ':event:' + this._eventCount + ':' + index;
                this._addCue(cue);
            });
        }

        this._pruneCues(currentTime);
        this.render();
        return this._buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned);
    }

    get eventCount() {
        return this._eventCount;
    }

    render() {
        const overlay = this._overlay;
        const mediaElement = this._mediaElement;
        if (!overlay || !mediaElement) {
            return;
        }

        const currentTime = mediaElement.currentTime || 0;
        let cue = null;
        for (let i = this._cues.length - 1; i >= 0; i--) {
            const candidate = this._cues[i];
            if (candidate.start <= currentTime && currentTime < candidate.end) {
                cue = candidate;
                break;
            }
        }

        const key = cue ? cue.key : null;
        if (key === this._lastCueKey) {
            return;
        }
        this._lastCueKey = key;
        overlay.innerHTML = '';

        if (!cue || cue.clear) {
            return;
        }

        renderTTMLCueDOM(overlay, cue);
    }

    _decodeText(data) {
        if (data && data.text) {
            return data.text;
        }
        if (!data || !data.data || typeof TextDecoder === 'undefined') {
            return '';
        }

        try {
            return new TextDecoder('utf-8').decode(data.data);
        } catch (e) {
            return '';
        }
    }

    _basePts(data) {
        if (data && Number.isFinite(data.pts)) {
            return data.pts / 1000;
        }
        if (data && Number.isFinite(data.rawPts)) {
            return data.rawPts / 1000;
        }
        if (data && Number.isFinite(data.dts)) {
            return data.dts / 1000;
        }
        return null;
    }

    _currentTime() {
        return this._mediaElement ? (this._mediaElement.currentTime || 0) : 0;
    }

    _addCue(cue) {
        this._cues.push(cue);
        this._cues.sort((a, b) => a.start - b.start);
        if (this._cues.length > this._maxCues) {
            this._cues.splice(0, this._cues.length - this._maxCues);
        }
    }

    _pruneCues(currentTime) {
        const keepFrom = currentTime - 30;
        while (this._cues.length > 0 && this._cues[0].end < keepFrom) {
            this._cues.shift();
        }
    }

    _buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned) {
        return {
            eventCount: this._eventCount,
            packetId: data && data.packetId,
            cueCount: cues.length,
            cues: cues,
            text: text,
            pts: data && data.pts,
            basePts: basePts,
            effectiveBasePts: effectiveBasePts,
            arrivalAligned: arrivalAligned,
            len: (data && data.len) || (text ? text.length : 0),
            preview: previewTTMLCues(cues, text)
        };
    }

    _prepareOverlayElement() {
        if (!this._overlay) {
            return;
        }
        this._overlay.style.pointerEvents = 'none';
        this._overlay.style.overflow = 'hidden';
        if (!this._overlay.style.fontFamily) {
            this._overlay.style.fontFamily = '"Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", "Meiryo", sans-serif';
        }
    }
}

function renderTTMLCueDOM(overlay, cue) {
    const overlayWidth = overlay.clientWidth || 1;
    const overlayHeight = overlay.clientHeight || 1;
    const planeWidth = cue.plane[0] || 3840;
    const planeHeight = cue.plane[1] || 2160;
    const scale = Math.min(overlayWidth / planeWidth, overlayHeight / planeHeight);
    const contentWidth = planeWidth * scale;
    const contentHeight = planeHeight * scale;
    const marginX = (overlayWidth - contentWidth) / 2;
    const marginY = (overlayHeight - contentHeight) / 2;

    cue.blocks.forEach((block) => {
        const region = block.region || {};
        const origin = region.origin || [planeWidth * 0.1, planeHeight * 0.78];
        const extent = region.extent || [planeWidth * 0.8, planeHeight * 0.16];
        const blockElement = document.createElement('div');
        blockElement.className = 'ttml-subtitle-block';
        blockElement.style.position = 'absolute';
        blockElement.style.display = 'flex';
        blockElement.style.flexDirection = 'column';
        blockElement.style.boxSizing = 'border-box';
        blockElement.style.color = '#fff';
        blockElement.style.textShadow = '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 4px #000';
        blockElement.style.whiteSpace = 'pre-wrap';
        blockElement.style.left = (marginX + origin[0] * scale) + 'px';
        blockElement.style.top = (marginY + origin[1] * scale) + 'px';
        blockElement.style.width = (extent[0] * scale) + 'px';
        blockElement.style.minHeight = (extent[1] * scale) + 'px';
        blockElement.style.fontSize = Math.max(14, 72 * scale) + 'px';
        blockElement.style.lineHeight = Math.max(16, 90 * scale) + 'px';
        blockElement.style.textAlign = block.style.textAlign || 'center';
        blockElement.style.justifyContent = mapDisplayAlign(region.displayAlign);

        const line = document.createElement('div');
        line.className = 'ttml-subtitle-line';
        line.style.boxSizing = 'border-box';
        line.style.width = '100%';
        applyTTMLStyle(line, block.style, scale);
        block.spans.forEach((span) => {
            const spanElement = document.createElement('span');
            spanElement.textContent = span.text;
            applyTTMLStyle(spanElement, span.style, scale);
            line.appendChild(spanElement);
        });
        blockElement.appendChild(line);
        overlay.appendChild(blockElement);
    });
}

function parseARIBTTML(text, basePts, currentTime, forceBaseAlignment) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement || localName(doc.documentElement) !== 'tt') {
        return [];
    }

    const tt = doc.documentElement;
    if (!firstChildByLocalName(tt, 'body')) {
        return [];
    }

    const plane = parseTTMLPlane(tt);
    const styles = collectTTMLStyles(doc);
    const regions = collectTTMLRegions(doc, styles, plane);
    const body = firstChildByLocalName(tt, 'body');
    const pNodes = descendantsByLocalName(body, 'p');
    const rawCues = [];

    pNodes.forEach((pNode, index) => {
        const timingNode = nearestTimedNode(pNode);
        let rawStart = parseTTMLTime(getTTMLAttr(pNode, 'begin'));
        let rawEnd = parseTTMLTime(getTTMLAttr(pNode, 'end'));
        if (rawStart === null && timingNode) {
            rawStart = parseTTMLTime(getTTMLAttr(timingNode, 'begin'));
        }
        if (rawEnd === null && timingNode) {
            rawEnd = parseTTMLTime(getTTMLAttr(timingNode, 'end'));
        }

        const regionId = nearestTTMLAttr(pNode, 'region');
        const region = regions[regionId] || null;
        const blockStyle = collectInheritedTTMLStyle(pNode, styles);
        const spans = parseTTMLSpans(pNode, styles, blockStyle);
        if (spans.length === 0) {
            return;
        }

        rawCues.push({
            index: index,
            rawStart: rawStart,
            rawEnd: rawEnd,
            block: {
                region: region,
                style: blockStyle,
                spans: spans
            }
        });
    });

    if (rawCues.length === 0) {
        return [];
    }

    let minStart = null;
    rawCues.forEach((cue) => {
        if (cue.rawStart !== null && (minStart === null || cue.rawStart < minStart)) {
            minStart = cue.rawStart;
        }
    });

    let startOffset = 0;
    if (minStart !== null && basePts !== null && (forceBaseAlignment || Math.abs(minStart - basePts) > 10)) {
        startOffset = basePts - minStart;
    } else if (minStart !== null && basePts === null && minStart > currentTime + 10) {
        startOffset = currentTime - minStart;
    }

    return rawCues.map((raw) => {
        const start = raw.rawStart !== null ? raw.rawStart + startOffset : (basePts !== null ? basePts : currentTime);
        let end = raw.rawEnd !== null ? raw.rawEnd + startOffset : start + 5;
        if (end <= start) {
            end = start + 0.05;
        }
        return {
            key: 'ttml:' + start + ':' + end + ':' + raw.index,
            start: start,
            end: end,
            clear: false,
            plane: plane,
            blocks: [raw.block]
        };
    });
}

function parseTTMLSpans(pNode, styles, inheritedStyle) {
    const spans = [];
    const spanNodes = childElementsByLocalName(pNode, 'span');
    if (spanNodes.length === 0) {
        const text = normalizeTTMLText(pNode.textContent || '');
        if (text !== '') {
            spans.push({
                text: text,
                style: Object.assign({}, inheritedStyle)
            });
        }
        return spans;
    }

    spanNodes.forEach((spanNode) => {
        const text = normalizeTTMLText(spanNode.textContent || '');
        if (text === '') {
            return;
        }
        spans.push({
            text: text,
            style: mergeTTMLStyleRefs(spanNode, styles, inheritedStyle)
        });
    });
    return spans;
}

function collectTTMLStyles(doc) {
    const styles = {};
    descendantsByLocalName(doc.documentElement, 'style').forEach((styleNode) => {
        const id = getXMLId(styleNode);
        if (!id) {
            return;
        }
        styles[id] = mergeTTMLStyleRefs(styleNode, styles, {});
    });
    return styles;
}

function collectTTMLRegions(doc, styles, plane) {
    const regions = {};
    descendantsByLocalName(doc.documentElement, 'region').forEach((regionNode) => {
        const id = getXMLId(regionNode);
        if (!id) {
            return;
        }
        const style = mergeTTMLStyleRefs(regionNode, styles, {});
        regions[id] = {
            origin: parseTTMLLengthPair(getTTMLAttr(regionNode, 'origin'), plane),
            extent: parseTTMLLengthPair(getTTMLAttr(regionNode, 'extent'), plane),
            displayAlign: getTTMLAttr(regionNode, 'displayAlign') || style.displayAlign || 'before'
        };
    });
    return regions;
}

function collectInheritedTTMLStyle(node, styles) {
    const stack = [];
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE && localName(current) !== 'tt') {
        const name = localName(current);
        if (name === 'body' || name === 'div' || name === 'p' || name === 'span') {
            stack.unshift(current);
        }
        current = current.parentNode;
    }

    let result = {};
    stack.forEach((styleNode) => {
        result = mergeTTMLStyleRefs(styleNode, styles, result);
    });
    return result;
}

function mergeTTMLStyleRefs(node, styles, base) {
    let result = Object.assign({}, base || {});
    const refs = (node.getAttribute('style') || '').split(/\s+/).filter(Boolean);
    refs.forEach((ref) => {
        if (styles[ref]) {
            result = Object.assign(result, styles[ref]);
        }
    });

    const attrs = ['fontSize', 'lineHeight', 'fontWeight', 'fontStyle', 'color', 'backgroundColor', 'displayAlign', 'textAlign'];
    attrs.forEach((name) => {
        const value = getTTMLAttr(node, name);
        if (value) {
            result[name] = value;
        }
    });
    return result;
}

function applyTTMLStyle(element, style, scale) {
    if (!style) {
        return;
    }
    if (style.fontSize) {
        const fontSize = parseTTMLLengthPair(style.fontSize, [3840, 2160]);
        const height = fontSize ? fontSize[1] : parseTTMLLength(style.fontSize, 2160);
        if (height) {
            element.style.fontSize = Math.max(10, height * scale) + 'px';
        }
    }
    if (style.lineHeight) {
        const lineHeight = parseTTMLLength(style.lineHeight, 2160);
        if (lineHeight) {
            element.style.lineHeight = Math.max(10, lineHeight * scale) + 'px';
        }
    }
    if (style.color) {
        element.style.color = parseTTMLColor(style.color);
    }
    if (style.backgroundColor) {
        element.style.backgroundColor = parseTTMLColor(style.backgroundColor);
    }
    if (style.fontWeight) {
        element.style.fontWeight = style.fontWeight;
    }
    if (style.fontStyle) {
        element.style.fontStyle = style.fontStyle;
    }
}

function parseTTMLPlane(ttNode) {
    const extent = getTTMLAttr(ttNode, 'extent');
    const parsed = parseTTMLLengthPair(extent, [3840, 2160]);
    return parsed || [3840, 2160];
}

function parseTTMLLengthPair(value, plane) {
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

function parseTTMLLength(value, base) {
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

function parseTTMLTime(value) {
    if (!value) {
        return null;
    }
    const text = String(value).trim();
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

function parseFraction(value) {
    if (!value) {
        return 0;
    }
    return Number('0.' + value);
}

function parseTTMLColor(value) {
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

function mapDisplayAlign(value) {
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

function previewTTMLCues(cues, text) {
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

function nearestTimedNode(node) {
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
        if (getTTMLAttr(current, 'begin') || getTTMLAttr(current, 'end')) {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

function getXMLId(node) {
    return node.getAttribute('xml:id') || node.getAttribute('id') || getTTMLAttr(node, 'id');
}

function nearestTTMLAttr(node, local) {
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE && localName(current) !== 'tt') {
        const value = current.getAttribute(local) || getTTMLAttr(current, local);
        if (value) {
            return value;
        }
        current = current.parentNode;
    }
    return '';
}

function getTTMLAttr(node, local) {
    if (!node || !node.attributes) {
        return '';
    }
    const direct = node.getAttribute(local) || node.getAttribute('tts:' + local) || node.getAttribute('ttp:' + local);
    if (direct) {
        return direct;
    }
    for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        if (attr.localName === local) {
            return attr.value;
        }
    }
    return '';
}

function localName(node) {
    return node.localName || node.nodeName.replace(/^.*:/, '');
}

function firstChildByLocalName(node, name) {
    const children = childElementsByLocalName(node, name);
    return children.length > 0 ? children[0] : null;
}

function childElementsByLocalName(node, name) {
    const result = [];
    if (!node || !node.childNodes) {
        return result;
    }
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child.nodeType === Node.ELEMENT_NODE && localName(child) === name) {
            result.push(child);
        }
    }
    return result;
}

function descendantsByLocalName(node, name) {
    const result = [];
    if (!node) {
        return result;
    }
    const all = node.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
        if (localName(all[i]) === name) {
            result.push(all[i]);
        }
    }
    return result;
}

function normalizeTTMLText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function formatNumber(value, digits) {
    return Number(value).toFixed(digits).replace(/\.?0+$/, '');
}

B62TTMLRenderer.parse = parseARIBTTML;
B62TTMLRenderer.renderCueDOM = renderTTMLCueDOM;
B62TTMLRenderer.previewCues = previewTTMLCues;

const TTMLRenderer = B62TTMLRenderer;
const aribb62js = {
    B62TTMLRenderer: B62TTMLRenderer,
    TTMLRenderer: TTMLRenderer
};

if (typeof window !== 'undefined') {
    window.aribb62js = aribb62js;
}

export { B62TTMLRenderer, TTMLRenderer };
export default aribb62js;
