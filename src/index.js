import {
    descendantsByLocalName,
    firstChildByLocalName,
    getARIBTTMLAttr,
    getTTMLAttr,
    getXMLId,
    hasAncestorByLocalName,
    localName,
    nearestTTMLAttr,
    nearestTimedNode
} from './utils/dom.js';
import {
    applyTTMLResourceStyle,
    blockTreeHasMarquee,
    collectTTMLAudioNode,
    collectTTMLAudios,
    collectTTMLEmbeddedImages,
    collectTTMLFontFaces,
    collectTTMLKeyframes,
    normalizeB62Resources,
    normalizeResourceReference,
    offsetTTMLAudios
} from './utils/resources.js';
import {
    applyARIBMarquee,
    applyTextStroke,
    applyTTMLBorder,
    createCueStyleElement,
    cssEscapeUrl,
    fontFaceFamilyStackForText,
    getTextStrokeWidth,
    mapARIBFontFamily,
    mapDisplayAlign,
    mapTextAlignItems,
    mapWritingMode,
    parseARIBAnimation,
    scaleTTMLShadow
} from './utils/style.js';
import {
    formatTextCodePoints,
    normalizeTTMLText,
    previewTTMLCues
} from './utils/text.js';
import {
    parseTTMLColor,
    parseTTMLLength,
    parseTTMLLengthPair,
    parseTTMLPlane,
    parseTTMLTime
} from './utils/ttml.js';

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
        this._liveTimingDelay = Number.isFinite(options.liveTimingDelay) ? options.liveTimingDelay : 0.7;
        this._styleOptions = {
            normalFont: options.normalFont || options.fontFamily || '',
            forceStrokeColor: options.forceStrokeColor,
            forceBackgroundColor: options.forceBackgroundColor || '',
            backgroundPadding: options.backgroundPadding || '0.33em 0.06em',
            lineBackground: !!options.lineBackground
        };
        this._cues = [];
        this._lastCueKey = null;
        this._lastLayoutKey = null;
        this._clockId = null;
        this._layoutRenderId = null;
        this._resizeObserver = null;
        this._windowResizeAttached = false;
        this._eventCount = 0;
        this._resourceScopeKey = null;
        this._resourceUrls = {};
        this._resourceMap = {};
        this._resourceObjectUrls = [];
        this._timelineOffsets = {};
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
        this._observeLayout();
        this.startClock();
    }

    detachMediaElement() {
        this.stopClock();
        this._disconnectLayoutObserver();
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
        this._observeLayout();
        this._queueLayoutRender();
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
        this._cancelLayoutRender();
        this.clear();
        this._timelineOffsets = {};
        this._clearResourceUrls();
        this._overlay = null;
    }

    clear() {
        this._cues = [];
        this._lastCueKey = null;
        this._lastLayoutKey = null;
        if (this._overlay) {
            this._overlay.innerHTML = '';
        }
    }

    reset() {
        this.clear();
        this._eventCount = 0;
        this._timelineOffsets = {};
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
        const effectiveBasePts = basePts;
        const arrivalAligned = false;
        const timelineOffset = this._resolveTimelineOffset(data, text, effectiveBasePts, this._timelineAnchor(data));

        const cues = parseARIBTTML(text, effectiveBasePts, currentTime, arrivalAligned, {
            resourceResolver: resources,
            timelineOffset: timelineOffset
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
        return this._buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned, resources, timelineOffset);
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
        const layoutKey = this._layoutKey(overlay, mediaElement);
        if (key === this._lastCueKey && layoutKey === this._lastLayoutKey) {
            return;
        }
        this._lastCueKey = key;
        this._lastLayoutKey = layoutKey;
        overlay.innerHTML = '';

        if (!cue || cue.clear) {
            return;
        }

        renderTTMLCueDOM(overlay, cue, this._styleOptions, mediaElement);
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

    _timelineAnchor(data) {
        if (data && Number.isFinite(data.videoMediaDts)) {
            return data.videoMediaDts / 1000;
        }
        if (data && Number.isFinite(data.videoMediaPts)) {
            return data.videoMediaPts / 1000;
        }
        return 0;
    }

    _resolveTimelineOffset(data, text, basePts, fallbackAnchor) {
        const minStart = findTTMLMinStart(text);
        if (data &&
            data.subtitleTimingMode === 2 &&
            Number.isFinite(data.subtitleReferenceStartMediaTime)) {
            const referenceOffset = data.subtitleReferenceStartMediaTime / 1000;
            if (this._isLive && minStart !== null && Number.isFinite(data.videoMediaDts)) {
                const key = 'live-reference:' + this._timelineOffsetKey(data);
                if (!Number.isFinite(this._timelineOffsets[key])) {
                    const staleBy = (data.videoMediaDts / 1000) - (minStart + referenceOffset);
                    this._timelineOffsets[key] = Math.max(this._liveTimingDelay, staleBy > 1 ? staleBy - 0.3 : 0);
                }
                return referenceOffset + this._timelineOffsets[key];
            }
            return referenceOffset;
        }
        if (data &&
            data.subtitleTimingMode === 3 &&
            basePts !== null) {
            return basePts;
        }

        if (minStart === null) {
            return null;
        }

        const key = this._timelineOffsetKey(data);
        if (!Number.isFinite(this._timelineOffsets[key])) {
            this._timelineOffsets[key] = (basePts !== null ? basePts : fallbackAnchor) - minStart;
        }
        return this._timelineOffsets[key];
    }

    _timelineOffsetKey(data) {
        if (data && data.packetId !== undefined) {
            return 'packet:' + data.packetId;
        }
        return 'default';
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

    _buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned, resources, timelineOffset) {
        const audios = [];
        cues.forEach((cue) => {
            if (cue.audios && cue.audios.length > 0) {
                cue.audios.forEach((audio) => audios.push(audio));
            }
        });
        const fontFaces = collectPushResultFontFaces(cues, this._eventCount);
        const preview = previewTTMLCues(cues, text);
        return {
            eventCount: this._eventCount,
            packetId: data && data.packetId,
            cueCount: cues.length,
            cues: cues,
            audioCount: audios.length,
            audios: audios,
            text: text,
            pts: data && data.pts,
            basePts: basePts,
            effectiveBasePts: effectiveBasePts,
            arrivalAligned: arrivalAligned,
            timelineOffset: timelineOffset,
            len: (data && data.len) || (text ? text.length : 0),
            resourceCount: resources ? resources.count : 0,
            preview: preview,
            previewCodePoints: formatTextCodePoints(preview),
            fontFaceCount: fontFaces.length,
            fontFaces: fontFaces
        };
    }

    _prepareOverlayElement() {
        if (!this._overlay) {
            return;
        }
        this._overlay.style.pointerEvents = 'none';
        this._overlay.style.overflow = 'hidden';
        if (!this._overlay.style.fontFamily) {
            this._overlay.style.fontFamily = this._styleOptions.normalFont ||
                '"Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", "Meiryo", sans-serif';
        }
    }

    _observeLayout() {
        this._disconnectLayoutObserver();
        if (!this._overlay || !this._mediaElement || typeof window === 'undefined') {
            return;
        }

        this._boundLayoutChange = this._boundLayoutChange || this._queueLayoutRender.bind(this);
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(this._boundLayoutChange);
            this._resizeObserver.observe(this._overlay);
            if (isElementNode(this._mediaElement)) {
                this._resizeObserver.observe(this._mediaElement);
            }
        } else {
            window.addEventListener('resize', this._boundLayoutChange);
            this._windowResizeAttached = true;
        }
    }

    _disconnectLayoutObserver() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._windowResizeAttached && typeof window !== 'undefined' && this._boundLayoutChange) {
            window.removeEventListener('resize', this._boundLayoutChange);
        }
        this._windowResizeAttached = false;
    }

    _queueLayoutRender() {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            if (this._layoutRenderId !== null) {
                return;
            }
            this._layoutRenderId = window.requestAnimationFrame(() => {
                this._layoutRenderId = null;
                this._invalidateLayout();
                this.render();
            });
            return;
        }

        this._invalidateLayout();
        this.render();
    }

    _cancelLayoutRender() {
        if (this._layoutRenderId === null || typeof window === 'undefined' || !window.cancelAnimationFrame) {
            this._layoutRenderId = null;
            return;
        }
        window.cancelAnimationFrame(this._layoutRenderId);
        this._layoutRenderId = null;
    }

    _invalidateLayout() {
        this._lastLayoutKey = null;
    }

    _layoutKey(overlay, mediaElement) {
        const viewport = getMediaContentViewport(overlay, mediaElement);
        return [
            Math.round(viewport.left * 100),
            Math.round(viewport.top * 100),
            Math.round(viewport.width * 100),
            Math.round(viewport.height * 100),
            mediaElement.videoWidth || 0,
            mediaElement.videoHeight || 0
        ].join(':');
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
            this._resourceMap[String(resource.index)] = resource;
        });

        return {
            count: Object.keys(this._resourceUrls).length,
            resolve: (url) => this._resolveResourceUrl(url),
            resource: (url) => this._resolveResource(url)
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

    _resolveResource(url) {
        if (!url) {
            return null;
        }
        const normalized = normalizeResourceReference(url);
        const match = normalized.match(/^subt:\/\/(\d+)$/);
        if (!match) {
            return null;
        }
        return this._resourceMap[match[1]] || null;
    }

    _clearResourceUrls() {
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
            this._resourceObjectUrls.forEach((url) => {
                URL.revokeObjectURL(url);
            });
        }
        this._resourceObjectUrls = [];
        this._resourceUrls = {};
        this._resourceMap = {};
    }
}

function renderTTMLCueDOM(overlay, cue, styleOptions, mediaElement) {
    styleOptions = styleOptions || {};
    const viewport = getMediaContentViewport(overlay, mediaElement);
    const overlayWidth = viewport.width || 1;
    const overlayHeight = viewport.height || 1;
    const planeWidth = cue.plane[0] || 3840;
    const planeHeight = cue.plane[1] || 2160;
    const scale = Math.min(overlayWidth / planeWidth, overlayHeight / planeHeight);
    const contentWidth = planeWidth * scale;
    const contentHeight = planeHeight * scale;
    const marginX = viewport.left + (overlayWidth - contentWidth) / 2;
    const marginY = viewport.top + (overlayHeight - contentHeight) / 2;

    if ((cue.fontFaces && cue.fontFaces.length > 0) || (cue.keyframes && cue.keyframes.length > 0) || cue.hasMarquee) {
        overlay.appendChild(createCueStyleElement(cue, scale));
    }

    cue.blocks.forEach((block) => {
        const region = block.region || {};
        const origin = region.origin || [planeWidth * 0.1, planeHeight * 0.78];
        const extent = region.extent || [planeWidth * 0.8, planeHeight * 0.16];
        const blockLeft = marginX + origin[0] * scale;
        const blockTop = marginY + origin[1] * scale;
        const blockWidth = extent[0] * scale;
        const blockHeight = extent[1] * scale;
        const writingMode = mapWritingMode(block.style.writingMode);
        const isHorizontalWriting = !writingMode.writingMode || writingMode.writingMode === 'horizontal-tb';
        const blockElement = document.createElement('div');
        blockElement.className = 'ttml-subtitle-block';
        blockElement.style.position = 'absolute';
        blockElement.style.display = 'flex';
        blockElement.style.flexDirection = 'column';
        blockElement.style.boxSizing = 'border-box';
        blockElement.style.color = '#fff';
        applyTextStroke(blockElement, 2, '#000');
        blockElement.style.whiteSpace = 'pre-wrap';
        blockElement.style.overflow = 'visible';
        blockElement.style.fontSize = Math.max(14, 72 * scale) + 'px';
        blockElement.style.lineHeight = Math.max(16, 90 * scale) + 'px';
        blockElement.style.textAlign = block.style.textAlign || 'center';
        blockElement.style.alignItems = mapTextAlignItems(block.style.textAlign || 'center');
        blockElement.style.justifyContent = mapDisplayAlign(region.displayAlign);
        applyTTMLStyle(blockElement, block.style, scale);
        applyViewerStyle(blockElement, styleOptions);
        applyFontFaceStack(blockElement, cue.fontFaces, block.spans.map((span) => span.text || '').join(''));
        const strokePadding = Math.ceil(getTextStrokeWidth(blockElement));
        blockElement.style.left = (blockLeft - strokePadding) + 'px';
        blockElement.style.top = (blockTop - strokePadding) + 'px';
        blockElement.style.width = (blockWidth + strokePadding * 2) + 'px';
        blockElement.style.height = (blockHeight + strokePadding * 2) + 'px';
        blockElement.style.padding = strokePadding + 'px';
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
        line.style.display = 'inline-block';
        line.style.width = 'auto';
        line.style.whiteSpace = isHorizontalWriting ? 'pre' : 'pre-wrap';
        line.style.tabSize = '1em';
        const lineBackgroundColor = resolveLineBackgroundColor(blockElement, block, styleOptions);
        block.spans.forEach((span) => {
            line.appendChild(renderTTMLSpanDOM(span, scale, styleOptions, cue.fontFaces));
        });
        if (lineBackgroundColor) {
            blockElement.style.backgroundColor = '';
            clearElementBackgrounds(line);
            line.style.backgroundColor = lineBackgroundColor;
            line.style.padding = normalizeLineBackgroundPadding(styleOptions.backgroundPadding);
        }
        blockElement.appendChild(line);
        overlay.appendChild(blockElement);
    });
}

function resolveLineBackgroundColor(blockElement, block, styleOptions) {
    if (styleOptions.forceBackgroundColor) {
        return styleOptions.forceBackgroundColor;
    }
    if (blockElement.style.backgroundColor) {
        return blockElement.style.backgroundColor;
    }

    const spans = block && block.spans ? block.spans : [];
    for (let i = 0; i < spans.length; i++) {
        if (spans[i].style && spans[i].style.backgroundColor) {
            return parseTTMLColor(spans[i].style.backgroundColor);
        }
    }
    return '';
}

function normalizeLineBackgroundPadding(value) {
    const text = String(value || '').trim();
    return text === '' || text === '0 0.08em' ? '0.33em 0.06em' : text;
}

function clearElementBackgrounds(element) {
    if (!element || !element.querySelectorAll) {
        return;
    }
    element.querySelectorAll('*').forEach((child) => {
        child.style.backgroundColor = '';
    });
}

function getMediaContentViewport(overlay, mediaElement) {
    const overlayWidth = overlay.clientWidth || 1;
    const overlayHeight = overlay.clientHeight || 1;
    if (!mediaElement || !mediaElement.videoWidth || !mediaElement.videoHeight || !overlay.getBoundingClientRect || !mediaElement.getBoundingClientRect) {
        return { left: 0, top: 0, width: overlayWidth, height: overlayHeight };
    }

    const overlayRect = overlay.getBoundingClientRect();
    const mediaRect = mediaElement.getBoundingClientRect();
    const mediaLeft = mediaRect.left - overlayRect.left;
    const mediaTop = mediaRect.top - overlayRect.top;
    const mediaWidth = mediaRect.width || overlayWidth;
    const mediaHeight = mediaRect.height || overlayHeight;
    const videoAspect = mediaElement.videoWidth / mediaElement.videoHeight;
    const elementAspect = mediaWidth / mediaHeight;
    let contentWidth = mediaWidth;
    let contentHeight = mediaHeight;
    let contentLeft = mediaLeft;
    let contentTop = mediaTop;

    if (elementAspect > videoAspect) {
        contentWidth = mediaHeight * videoAspect;
        contentLeft += (mediaWidth - contentWidth) / 2;
    } else if (elementAspect < videoAspect) {
        contentHeight = mediaWidth / videoAspect;
        contentTop += (mediaHeight - contentHeight) / 2;
    }

    return {
        left: contentLeft,
        top: contentTop,
        width: contentWidth,
        height: contentHeight
    };
}

function isElementNode(value) {
    return typeof Element !== 'undefined' && value instanceof Element;
}

function renderTTMLSpanDOM(span, scale, styleOptions, fontFaces) {
    if (span.rubyText) {
        const rubyElement = document.createElement('ruby');
        const baseElement = document.createElement('span');
        const rubyTextElement = document.createElement('rt');
        rubyTextElement.style.fontSize = '50%';
        rubyTextElement.style.lineHeight = '1';
        applyTTMLStyle(rubyElement, span.style, scale);
        applyViewerStyle(rubyElement, styleOptions);
        applyFontFaceStack(rubyElement, fontFaces, (span.text || '') + (span.rubyText || ''));
        appendTTMLTextWithSVGGlyphs(baseElement, span.text, fontFaces);
        appendTTMLTextWithSVGGlyphs(rubyTextElement, span.rubyText, fontFaces);
        rubyElement.appendChild(baseElement);
        rubyElement.appendChild(rubyTextElement);
        return rubyElement;
    }

    const spanElement = document.createElement('span');
    applyTTMLStyle(spanElement, span.style, scale);
    applyViewerStyle(spanElement, styleOptions);
    applyFontFaceStack(spanElement, fontFaces, span.text);
    appendTTMLTextWithSVGGlyphs(spanElement, span.text, fontFaces);
    return spanElement;
}

function findTTMLMinStart(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement || localName(doc.documentElement) !== 'tt') {
        return null;
    }

    const body = firstChildByLocalName(doc.documentElement, 'body');
    if (!body) {
        return null;
    }

    let minStart = null;
    const collectStart = (node) => {
        const timingNode = nearestTimedNode(node);
        let start = parseTTMLTime(getTTMLAttr(node, 'begin'));
        if (start === null && timingNode) {
            start = parseTTMLTime(getTTMLAttr(timingNode, 'begin'));
        }
        if (start !== null && (minStart === null || start < minStart)) {
            minStart = start;
        }
    };

    descendantsByLocalName(body, 'p').forEach(collectStart);
    descendantsByLocalName(body, 'audio').forEach((audioNode) => {
        if (!hasAncestorByLocalName(audioNode, 'p')) {
            collectStart(audioNode);
        }
    });
    return minStart;
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
    const keyframes = collectTTMLKeyframes(doc);
    const body = firstChildByLocalName(tt, 'body');
    const pNodes = descendantsByLocalName(body, 'p');
    const rawCues = [];

    pNodes.forEach((pNode, index) => {
        const timingNode = nearestTimedNode(pNode);
        let rawStart = parseTTMLTime(getTTMLAttr(pNode, 'begin'));
        let rawEnd = parseTTMLTime(getTTMLAttr(pNode, 'end'));
        let rawDur = parseTTMLTime(getTTMLAttr(pNode, 'dur'));
        if (rawStart === null && timingNode) {
            rawStart = parseTTMLTime(getTTMLAttr(timingNode, 'begin'));
        }
        if (rawEnd === null && timingNode) {
            rawEnd = parseTTMLTime(getTTMLAttr(timingNode, 'end'));
        }
        if (rawDur === null && timingNode) {
            rawDur = parseTTMLTime(getTTMLAttr(timingNode, 'dur'));
        }
        if (rawEnd === null && rawDur !== null && rawStart !== null) {
            rawEnd = rawDur === Infinity ? Infinity : rawStart + rawDur;
        }

        const regionId = nearestTTMLAttr(pNode, 'region');
        const region = regions[regionId] || null;
        const blockStyle = Object.assign({}, region && region.style ? region.style : {}, collectInheritedTTMLStyle(pNode, styles));
        applyTTMLResourceStyle(blockStyle, embeddedImages, options.resourceResolver);
        const spans = parseTTMLSpans(pNode, styles, blockStyle);
        const audios = collectTTMLAudios(pNode, rawStart, rawEnd, rawDur, options.resourceResolver);
        const hasVisual = spans.length > 0 || !!blockStyle.backgroundImageUrl;
        if (!hasVisual && audios.length === 0) {
            return;
        }

        rawCues.push({
            index: index,
            rawStart: rawStart,
            rawEnd: rawEnd,
            block: hasVisual ? {
                region: region,
                style: blockStyle,
                spans: spans
            } : null,
            audios: audios
        });
    });

    descendantsByLocalName(body, 'audio').forEach((audioNode, index) => {
        if (hasAncestorByLocalName(audioNode, 'p')) {
            return;
        }
        const timingNode = nearestTimedNode(audioNode);
        let rawStart = timingNode ? parseTTMLTime(getTTMLAttr(timingNode, 'begin')) : null;
        let rawEnd = timingNode ? parseTTMLTime(getTTMLAttr(timingNode, 'end')) : null;
        const rawDur = timingNode ? parseTTMLTime(getTTMLAttr(timingNode, 'dur')) : null;
        if (rawEnd === null && rawDur !== null && rawStart !== null) {
            rawEnd = rawDur === Infinity ? Infinity : rawStart + rawDur;
        }

        const audio = collectTTMLAudioNode(audioNode, rawStart, rawEnd, rawDur, options.resourceResolver);
        if (!audio) {
            return;
        }
        rawCues.push({
            index: pNodes.length + index,
            rawStart: rawStart,
            rawEnd: rawEnd,
            block: null,
            audios: [audio]
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
    if (Number.isFinite(options.timelineOffset)) {
        startOffset = options.timelineOffset;
    } else if (minStart !== null && basePts !== null && (forceBaseAlignment || Math.abs(minStart - basePts) > 0.05)) {
        startOffset = basePts - minStart;
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
            keyframes: keyframes,
            hasMarquee: raw.block ? blockTreeHasMarquee(raw.block) : false,
            audios: offsetTTMLAudios(raw.audios, startOffset, start, end),
            blocks: raw.block ? [raw.block] : []
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
        'direction',
        'opacity'
    ];
    attrs.forEach((name) => {
        const value = getTTMLAttr(node, name);
        if (value) {
            result[name] = value;
        }
    });

    const aribAttrs = {
        animation: 'animation',
        border: 'border',
        'border-top': 'borderTop',
        'border-bottom': 'borderBottom',
        'border-left': 'borderLeft',
        'border-right': 'borderRight',
        'letter-spacing': 'letterSpacing',
        marquee: 'marquee',
        'text-shadow': 'textShadow'
    };
    Object.keys(aribAttrs).forEach((name) => {
        const value = getARIBTTMLAttr(node, name);
        if (value) {
            result[aribAttrs[name]] = value;
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
        element.style.textShadow = scaleTTMLShadow(style.textShadow, scale);
    }
    if (style.letterSpacing) {
        const spacing = parseTTMLLength(style.letterSpacing, 3840);
        if (spacing !== null) {
            element.style.letterSpacing = (spacing * scale) + 'px';
        }
    }
    if (style.opacity) {
        element.style.opacity = String(style.opacity);
    }
    applyTTMLBorder(element, style, scale);
    if (style.animation) {
        const animation = parseARIBAnimation(style.animation);
        if (animation) {
            element.style.animation = animation;
        }
    }
    if (style.marquee) {
        applyARIBMarquee(element, style.marquee);
    }
}

function applyViewerStyle(element, options) {
    if (!options) {
        return;
    }
    if (options.normalFont) {
        element.style.fontFamily = options.normalFont;
    }
    if (options.forceStrokeColor) {
        const color = typeof options.forceStrokeColor === 'string' ? options.forceStrokeColor : '#000';
        applyTextStroke(element, 2, color);
    }
}

function applyFontFaceStack(element, fontFaces, text) {
    const fontFaceStack = fontFaceFamilyStackForText(fontFaces, text);
    if (!fontFaceStack) {
        return;
    }

    element.style.fontFamily = element.style.fontFamily ?
        fontFaceStack + ', ' + element.style.fontFamily :
        fontFaceStack;
}

function appendTTMLTextWithSVGGlyphs(element, text, fontFaces) {
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

function findSVGGlyph(fontFaces, char) {
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

function createSVGGlyphElement(glyph) {
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

function collectPushResultFontFaces(cues, eventCount) {
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

function buildFontFaceDownloadName(fontFace, eventCount, index, format) {
    const family = String(fontFace.family || 'font').replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
    const extension = format === 'woff' ? 'woff' : (format === 'svg' ? 'svg' : 'bin');
    return 'aribb62-event-' + eventCount + '-font-' + index + '-' + family + '.' + extension;
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
