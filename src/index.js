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
        this._resourceScopeKey = null;
        this._resourceUrls = {};
        this._resourceObjectUrls = [];
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
        this._clearResourceUrls();
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
        const resources = this._prepareResourceContext(data);

        if (!text) {
            return this._buildPushResult(data, '', [], null, null, false, resources);
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

        const cues = parseARIBTTML(text, effectiveBasePts, currentTime, arrivalAligned, {
            resourceResolver: resources
        });
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
        return this._buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned, resources);
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

    _buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned, resources) {
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
            resourceCount: resources ? resources.count : 0,
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

    _prepareResourceContext(data) {
        const scopeKey = data ?
            [data.packetId, data.mpuSequenceNumber].filter((value) => value !== undefined).join(':') :
            '';
        if (scopeKey !== this._resourceScopeKey) {
            this._clearResourceUrls();
            this._resourceScopeKey = scopeKey;
        }

        normalizeB62Resources(data).forEach((resource) => {
            const url = this._resourceToUrl(resource);
            if (url) {
                this._resourceUrls[String(resource.index)] = url;
            }
        });

        return {
            count: Object.keys(this._resourceUrls).length,
            resolve: (url) => this._resolveResourceUrl(url)
        };
    }

    _resourceToUrl(resource) {
        if (!resource) {
            return '';
        }
        if (resource.url) {
            return resource.url;
        }
        if (!resource.data || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
            return '';
        }

        const blob = new Blob([resource.data], { type: resource.mimeType || '' });
        const url = URL.createObjectURL(blob);
        this._resourceObjectUrls.push(url);
        return url;
    }

    _resolveResourceUrl(url) {
        if (!url) {
            return '';
        }
        const normalized = normalizeResourceReference(url);
        const match = normalized.match(/^subt:\/\/(\d+)$/);
        if (!match) {
            return normalized;
        }
        return this._resourceUrls[match[1]] || '';
    }

    _clearResourceUrls() {
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
            this._resourceObjectUrls.forEach((url) => {
                URL.revokeObjectURL(url);
            });
        }
        this._resourceObjectUrls = [];
        this._resourceUrls = {};
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

    if (cue.fontFaces && cue.fontFaces.length > 0) {
        overlay.appendChild(createFontFaceStyleElement(cue.fontFaces));
    }

    cue.blocks.forEach((block) => {
        const region = block.region || {};
        const origin = region.origin || [planeWidth * 0.1, planeHeight * 0.78];
        const extent = region.extent || [planeWidth * 0.8, planeHeight * 0.16];
        const writingMode = mapWritingMode(block.style.writingMode);
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
        if (block.style.backgroundImageUrl) {
            blockElement.style.backgroundImage = 'url("' + cssEscapeUrl(block.style.backgroundImageUrl) + '")';
            blockElement.style.backgroundRepeat = 'no-repeat';
            blockElement.style.backgroundSize = 'contain';
            blockElement.style.backgroundPosition = 'center';
        }
        if (writingMode.writingMode) {
            blockElement.style.writingMode = writingMode.writingMode;
        }
        if (writingMode.direction) {
            blockElement.style.direction = writingMode.direction;
        }
        if (block.style.direction) {
            blockElement.style.direction = block.style.direction;
        }

        const line = document.createElement('div');
        line.className = 'ttml-subtitle-line';
        line.style.boxSizing = 'border-box';
        line.style.width = '100%';
        line.style.tabSize = '1em';
        applyTTMLStyle(line, block.style, scale);
        block.spans.forEach((span) => {
            line.appendChild(renderTTMLSpanDOM(span, scale));
        });
        blockElement.appendChild(line);
        overlay.appendChild(blockElement);
    });
}

function renderTTMLSpanDOM(span, scale) {
    if (span.rubyText) {
        const rubyElement = document.createElement('ruby');
        const baseElement = document.createElement('span');
        const rubyTextElement = document.createElement('rt');
        baseElement.textContent = span.text;
        rubyTextElement.textContent = span.rubyText;
        rubyTextElement.style.fontSize = '50%';
        rubyTextElement.style.lineHeight = '1';
        applyTTMLStyle(rubyElement, span.style, scale);
        rubyElement.appendChild(baseElement);
        rubyElement.appendChild(rubyTextElement);
        return rubyElement;
    }

    const spanElement = document.createElement('span');
    spanElement.textContent = span.text;
    applyTTMLStyle(spanElement, span.style, scale);
    return spanElement;
}

function parseARIBTTML(text, basePts, currentTime, forceBaseAlignment, options) {
    options = options || {};
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
    const embeddedImages = collectTTMLEmbeddedImages(doc);
    const fontFaces = collectTTMLFontFaces(doc, options.resourceResolver);
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
        const blockStyle = Object.assign({}, region && region.style ? region.style : {}, collectInheritedTTMLStyle(pNode, styles));
        applyTTMLResourceStyle(blockStyle, embeddedImages, options.resourceResolver);
        const spans = parseTTMLSpans(pNode, styles, blockStyle);
        if (spans.length === 0 && !blockStyle.backgroundImageUrl) {
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
            fontFaces: fontFaces,
            blocks: [raw.block]
        };
    });
}

function parseTTMLSpans(pNode, styles, inheritedStyle) {
    const spans = [];
    appendTTMLInlineSpans(pNode, styles, inheritedStyle, spans);
    return resolveTTMLRubySpans(spans);
}

function appendTTMLInlineSpans(parentNode, styles, inheritedStyle, spans) {
    if (!parentNode || !parentNode.childNodes) {
        return;
    }

    for (let i = 0; i < parentNode.childNodes.length; i++) {
        const child = parentNode.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
            const text = normalizeTTMLText(child.nodeValue || '');
            if (text !== '') {
                spans.push({
                    text: text,
                    style: Object.assign({}, inheritedStyle)
                });
            }
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
            continue;
        }

        const name = localName(child);
        if (name === 'br') {
            spans.push({
                text: '\n',
                style: Object.assign({}, inheritedStyle)
            });
            continue;
        }
        if (name !== 'span') {
            appendTTMLInlineSpans(child, styles, inheritedStyle, spans);
            continue;
        }

        const style = mergeTTMLStyleRefs(child, styles, inheritedStyle);
        const beforeLength = spans.length;
        appendTTMLInlineSpans(child, styles, style, spans);
        if (spans.length === beforeLength) {
            const text = normalizeTTMLText(child.textContent || '');
            if (text !== '') {
                spans.push({
                    text: text,
                    style: style
                });
            }
        }

        const id = getXMLId(child);
        const rubyTargetId = getARIBTTMLAttr(child, 'ruby');
        for (let j = beforeLength; j < spans.length; j++) {
            if (id && !spans[j].id) {
                spans[j].id = id;
            }
            if (rubyTargetId && !spans[j].rubyTargetId) {
                spans[j].rubyTargetId = rubyTargetId;
            }
        }
    }
}

function resolveTTMLRubySpans(spans) {
    const byId = {};
    spans.forEach((span) => {
        if (span.id && !span.rubyTargetId && !byId[span.id]) {
            byId[span.id] = span;
        }
    });

    return spans.filter((span) => {
        if (!span.rubyTargetId) {
            return true;
        }
        const base = byId[span.rubyTargetId];
        if (!base) {
            return true;
        }
        base.rubyText = span.text;
        return false;
    });
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
            displayAlign: getTTMLAttr(regionNode, 'displayAlign') || style.displayAlign || 'before',
            style: style
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

    const attrs = [
        'fontSize',
        'lineHeight',
        'fontWeight',
        'fontStyle',
        'fontFamily',
        'color',
        'backgroundColor',
        'displayAlign',
        'textAlign',
        'textDecoration',
        'textShadow',
        'backgroundImage',
        'writingMode',
        'direction'
    ];
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
    if (style.fontFamily) {
        element.style.fontFamily = mapARIBFontFamily(style.fontFamily);
    }
    if (style.textDecoration) {
        element.style.textDecoration = style.textDecoration;
    }
    if (style.textShadow) {
        element.style.textShadow = style.textShadow;
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

function mapWritingMode(value) {
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

function mapARIBFontFamily(value) {
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

function createFontFaceStyleElement(fontFaces) {
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

function collectTTMLEmbeddedImages(doc) {
    const images = {};
    descendantsByLocalName(doc.documentElement, 'image').forEach((imageNode) => {
        const id = getXMLId(imageNode);
        if (!id) {
            return;
        }
        const encoding = (getTTMLAttr(imageNode, 'encoding') || '').toLowerCase();
        const imageType = (getTTMLAttr(imageNode, 'imageType') || 'png').toLowerCase();
        const payload = String(imageNode.textContent || '').replace(/\s+/g, '');
        if (!payload) {
            return;
        }
        if (encoding === 'base64' || encoding === '') {
            images[id] = 'data:' + imageTypeToMime(imageType) + ';base64,' + payload;
        }
    });
    return images;
}

function collectTTMLFontFaces(doc, resourceResolver) {
    const fontFaces = [];
    descendantsByLocalName(doc.documentElement, 'font-face').forEach((fontFaceNode) => {
        const family = getTTMLAttr(fontFaceNode, 'font-family') || getTTMLAttr(fontFaceNode, 'fontFamily');
        if (!family) {
            return;
        }
        const sourceNodes = childElementsByLocalName(fontFaceNode, 'src');
        sourceNodes.forEach((sourceNode) => {
            const url = getTTMLAttr(sourceNode, 'url');
            const resolvedUrl = resolveTTMLResourceReference(url, {}, resourceResolver);
            if (!resolvedUrl) {
                return;
            }
            fontFaces.push({
                family: stripQuotes(family),
                url: resolvedUrl,
                format: getTTMLAttr(sourceNode, 'format'),
                unicodeRange: getTTMLAttr(fontFaceNode, 'unicode-range') || getTTMLAttr(fontFaceNode, 'unicodeRange')
            });
        });
    });
    return fontFaces;
}

function applyTTMLResourceStyle(style, embeddedImages, resourceResolver) {
    if (!style || !style.backgroundImage) {
        return;
    }
    const resolvedUrl = resolveTTMLResourceReference(style.backgroundImage, embeddedImages, resourceResolver);
    if (resolvedUrl) {
        style.backgroundImageUrl = resolvedUrl;
    }
}

function resolveTTMLResourceReference(value, embeddedImages, resourceResolver) {
    const normalized = normalizeResourceReference(value);
    if (!normalized) {
        return '';
    }
    if (normalized.charAt(0) === '#') {
        return embeddedImages[normalized.slice(1)] || '';
    }
    if (resourceResolver && resourceResolver.resolve) {
        return resourceResolver.resolve(normalized);
    }
    return normalized;
}

function normalizeB62Resources(data) {
    const resources = [];
    if (!data) {
        return resources;
    }

    appendB62ResourceList(resources, data.resources);
    appendB62ResourceList(resources, data.subsamples);
    appendB62ResourceMap(resources, data.resourceMap);
    appendB62ResourceMap(resources, data.resourcesBySubsample);
    return resources;
}

function appendB62ResourceList(resources, list) {
    if (!Array.isArray(list)) {
        return;
    }
    list.forEach((item) => {
        const resource = normalizeB62Resource(item);
        if (resource) {
            resources.push(resource);
        }
    });
}

function appendB62ResourceMap(resources, map) {
    if (!map || typeof map !== 'object') {
        return;
    }
    Object.keys(map).forEach((key) => {
        const value = map[key];
        const resource = normalizeB62Resource(typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer) ?
            Object.assign({ index: Number(key) }, value) :
            { index: Number(key), data: value });
        if (resource) {
            resources.push(resource);
        }
    });
}

function normalizeB62Resource(item) {
    if (!item) {
        return null;
    }
    const index = firstFiniteNumber(
        item.index,
        item.subsampleIndex,
        item.subsampleNumber,
        item.subsample,
        item.id
    );
    if (!Number.isFinite(index)) {
        return null;
    }

    return {
        index: index,
        data: toUint8Array(item.data || item.payload || item.bytes),
        url: item.url || '',
        mimeType: item.mimeType || stringMimeType(item.type) || mimeFromB62Resource(item)
    };
}

function mimeFromB62Resource(resource) {
    if (resource.mimeType) {
        return resource.mimeType;
    }
    if (resource.format) {
        return formatToMime(resource.format);
    }
    const dataType = Number.isFinite(Number(resource.dataType)) ? Number(resource.dataType) : Number(resource.type);
    switch (dataType) {
        case 1:
            return 'image/png';
        case 2:
            return 'image/svg+xml';
        case 6:
            return 'image/svg+xml';
        case 7:
            return 'font/woff';
        default:
            return '';
    }
}

function stringMimeType(value) {
    return typeof value === 'string' && value.indexOf('/') >= 0 ? value : '';
}

function toUint8Array(data) {
    if (!data) {
        return null;
    }
    if (data instanceof Uint8Array) {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    if (Array.isArray(data)) {
        return new Uint8Array(data);
    }
    return null;
}

function firstFiniteNumber() {
    for (let i = 0; i < arguments.length; i++) {
        const value = Number(arguments[i]);
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return NaN;
}

function normalizeResourceReference(value) {
    let text = String(value || '').trim().replace(/\uFF03/g, '#');
    const url = text.match(/^url\((.*)\)$/);
    if (url) {
        text = url[1].trim();
    }
    return stripQuotes(text);
}

function imageTypeToMime(type) {
    switch (String(type || '').toLowerCase()) {
        case 'svg':
        case 'svg+xml':
            return 'image/svg+xml';
        case 'png':
        default:
            return 'image/png';
    }
}

function formatToMime(format) {
    switch (String(format || '').toLowerCase()) {
        case 'png':
            return 'image/png';
        case 'svg':
            return 'image/svg+xml';
        case 'woff':
            return 'font/woff';
        default:
            return '';
    }
}

function stripQuotes(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function cssEscapeUrl(value) {
    return String(value || '').replace(/["\\\n\r]/g, '\\$&');
}

function cssEscapeString(value) {
    return String(value || '').replace(/["\\\n\r]/g, '\\$&');
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

function getARIBTTMLAttr(node, local) {
    if (!node || !node.attributes) {
        return '';
    }
    const direct = node.getAttribute('arib-tt:' + local);
    if (direct) {
        return direct;
    }
    for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        if (attr.localName === local && /arib-ttml/.test(attr.namespaceURI || '')) {
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
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \f\v]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .trim();
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
