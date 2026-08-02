import {
    normalizeB62Resources,
    normalizeResourceReference,
    sameB62Resource
} from './utils/resources.js';
import {
    DEFAULT_ARIB_FONT_STACK,
    mergeFontFamilyStacks
} from './utils/style.js';
import {subtitleMediaTimeSeconds} from './utils/cues.js';
import {findTTMLMinStart, parseARIBTTML, parseARIBTTMLDocument} from './parser.js';
import {renderTTMLCueDOM} from './renderer.js';
import {B62RendererStateMachine, B62StateKeys} from './utils/state.js';
import {collectPushResultFontFaces} from './utils/result.js';
import {getMediaContentViewport, isElementNode} from './utils/viewport.js';
import {
    formatTextCodePoints,
    previewTTMLCues
} from './utils/text.js';

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
        this._state = new B62RendererStateMachine({ maxCues: this._maxCues });
        this._liveTimingDelay = Number.isFinite(options.liveTimingDelay) ? options.liveTimingDelay : 0.7;
        this._styleOptions = {
            normalFont: mergeFontFamilyStacks(options.normalFont || options.fontFamily || '', DEFAULT_ARIB_FONT_STACK),
            forceStrokeColor: options.forceStrokeColor,
            fallbackStrokeColor: options.fallbackStrokeColor === undefined ? 'rgba(0, 0, 0, 0.86)' : options.fallbackStrokeColor,
            strokeWidth: Number.isFinite(options.strokeWidth) ? options.strokeWidth : 1.5,
            strokeWidthInPlane: Number.isFinite(options.strokeWidthInPlane) ? options.strokeWidthInPlane : null,
            forceBackgroundColor: options.forceBackgroundColor || '',
            backgroundPadding: options.backgroundPadding || '0.08em 0.08em',
            lineBackground: !!options.lineBackground
        };
        this._lastCueKey = null;
        this._lastLayoutKey = null;
        this._clockId = null;
        this._layoutRenderId = null;
        this._resizeObserver = null;
        this._windowResizeAttached = false;
        this._resourceScopeKey = null;
        this._resourceScopes = new Map();
        this._prepareOverlayElement();

        if (this._mediaElement) {
            this.attachMediaElement(this._mediaElement);
        }
    }

    attachMediaElement(mediaElement) {
        if (this._state.lifecycle === 'destroyed') {
            return;
        }
        this.detachMediaElement();
        this._mediaElement = mediaElement;
        if (!mediaElement) {
            return;
        }

        this._boundRender = this._boundRender || this.render.bind(this);
        this._boundStartClock = this._boundStartClock || (() => {
            this._state.play();
            this.startClock();
        });
        this._boundStopClock = this._boundStopClock || (() => {
            this._state.pause();
            this.stopClock();
        });
        mediaElement.addEventListener('timeupdate', this._boundRender);
        mediaElement.addEventListener('seeked', this._boundRender);
        mediaElement.addEventListener('resize', this._boundRender);
        mediaElement.addEventListener('play', this._boundStartClock);
        mediaElement.addEventListener('pause', this._boundStopClock);
        this._state.attachMedia(mediaElement.paused === true || mediaElement.ended === true);
        this._observeLayout();
        this.render();
        this.startClock();
    }

    detachMediaElement() {
        this.stopClock();
        this._disconnectLayoutObserver();
        if (!this._mediaElement) {
            this._state.detachMedia();
            return;
        }

        this._mediaElement.removeEventListener('timeupdate', this._boundRender);
        this._mediaElement.removeEventListener('seeked', this._boundRender);
        this._mediaElement.removeEventListener('resize', this._boundRender);
        this._mediaElement.removeEventListener('play', this._boundStartClock);
        this._mediaElement.removeEventListener('pause', this._boundStopClock);
        this._mediaElement = null;
        this._state.detachMedia();
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
        if (!this._state.canRunClock() ||
            this._clockId !== null ||
            typeof window === 'undefined' ||
            !window.requestAnimationFrame) {
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
        this._clearResourceUrls();
        this._overlay = null;
        this._state.destroy();
    }

    clear() {
        this._state.clearPresentations();
        this._releaseUnusedResourceScopes();
        this._lastCueKey = null;
        this._lastLayoutKey = null;
        if (this._overlay) {
            this._overlay.innerHTML = '';
        }
    }

    reset() {
        this.clear();
        this._state.reset();
        this._resourceScopeKey = null;
        this._clearResourceUrls();
    }

    push(data) {
        const transaction = this._state.beginPush(data);
        if (!transaction) {
            return this._buildPushResult(data, '', [], null, null, false, null, null);
        }
        const text = this._decodeText(data);
        const resources = this._prepareResourceContext(data, transaction.resourceScopeKey);

        if (!text) {
            this._releaseUnusedResourceScopes();
            return this._buildPushResult(data, '', [], null, null, false, resources);
        }

        const currentTime = this._currentTime();
        const basePts = this._basePts(data);
        const effectiveBasePts = basePts;
        const arrivalAligned = false;
        const timelineOffset = this._resolveTimelineOffset(data, text, effectiveBasePts, this._timelineAnchor(data));

        const parsedDocument = parseARIBTTMLDocument(text, effectiveBasePts, currentTime, arrivalAligned, {
            resourceResolver: resources,
            timelineOffset: timelineOffset
        });
        if (parsedDocument.kind === 'invalid') {
            this._releaseUnusedResourceScopes();
            return this._buildPushResult(data, text, [], basePts, effectiveBasePts, arrivalAligned, resources, timelineOffset, 'invalid');
        }

        const continuedCues = this._isLive ?
            this._state.resolveContinuations(transaction, parsedDocument.continuations) : [];
        const cues = parsedDocument.cues.concat(continuedCues);
        let presentationCues;
        if (parsedDocument.kind === 'clear' || cues.length === 0) {
            const start = effectiveBasePts !== null ? effectiveBasePts : currentTime;
            presentationCues = [{
                key: 'clear:' + start,
                start: start,
                end: start + 0.05,
                clear: true,
                plane: [3840, 2160],
                blocks: []
            }];
        } else {
            presentationCues = cues;
        }

        this._state.commitPresentation(transaction, presentationCues);
        this._pruneCues(currentTime);
        this._releaseUnusedResourceScopes();
        this.render();
        return this._buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned, resources, timelineOffset, parsedDocument.kind);
    }

    get eventCount() {
        return this._state.eventCount;
    }

    render() {
        const overlay = this._overlay;
        const mediaElement = this._mediaElement;
        if (!overlay || !mediaElement) {
            return;
        }

        const currentTime = mediaElement.currentTime || 0;
        const cues = this._state.activeCues(currentTime);
        const key = cues.map((cue) => cue.key).join('|') || null;
        const layoutKey = this._layoutKey(overlay, mediaElement);
        if (key === this._lastCueKey && layoutKey === this._lastLayoutKey) {
            return;
        }
        this._lastCueKey = key;
        this._lastLayoutKey = layoutKey;
        overlay.innerHTML = '';

        if (cues.length === 0) {
            return;
        }
        cues.forEach((cue) => {
            if (!cue.clear) {
                renderTTMLCueDOM(overlay, cue, this._styleOptions, mediaElement);
            }
        });
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
        return subtitleMediaTimeSeconds(data);
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
            if (this._isLive) {
                const key = this._state.timelineOffsetKey(data, 'live-reference');
                let liveOffset = this._state.getTimelineOffset(key);
                if (liveOffset === null && minStart !== null && Number.isFinite(data.videoMediaDts)) {
                    const staleBy = (data.videoMediaDts / 1000) - (minStart + referenceOffset);
                    liveOffset = Math.max(this._liveTimingDelay, staleBy > 1 ? staleBy - 0.3 : 0);
                    this._state.setTimelineOffset(key, liveOffset);
                }
                return referenceOffset + (liveOffset === null ? 0 : liveOffset);
            }
            return referenceOffset;
        }
        if (data &&
            data.subtitleTimingMode === 3 &&
            basePts !== null) {
            return basePts;
        }

        const key = this._state.timelineOffsetKey(data);
        let timelineOffset = this._state.getTimelineOffset(key);
        if (minStart === null) {
            return timelineOffset;
        }
        if (timelineOffset === null) {
            timelineOffset = (basePts !== null ? basePts : fallbackAnchor) - minStart;
            this._state.setTimelineOffset(key, timelineOffset);
        }
        return timelineOffset;
    }

    _currentTime() {
        return this._mediaElement ? (this._mediaElement.currentTime || 0) : 0;
    }

    _pruneCues(currentTime) {
        this._state.prune(currentTime);
    }

    _buildPushResult(data, text, cues, basePts, effectiveBasePts, arrivalAligned, resources, timelineOffset, documentKind) {
        const audios = [];
        cues.forEach((cue) => {
            if (cue.audios && cue.audios.length > 0) {
                cue.audios.forEach((audio) => audios.push(audio));
            }
        });
        const fontFaces = collectPushResultFontFaces(cues, this._state.eventCount);
        const preview = previewTTMLCues(cues, text);
        return {
            eventCount: this._state.eventCount,
            packetId: data && data.packetId,
            documentKind: documentKind || (text ? 'presentation' : 'none'),
            cueCount: cues.length,
            cues: cues,
            audioCount: audios.length,
            audios: audios,
            text: text,
            pts: data && data.pts,
            basePts: Number.isFinite(basePts) ? basePts : null,
            effectiveBasePts: Number.isFinite(effectiveBasePts) ? effectiveBasePts : null,
            arrivalAligned: arrivalAligned,
            timelineOffset: Number.isFinite(timelineOffset) ? timelineOffset : null,
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
            this._overlay.style.fontFamily = this._styleOptions.normalFont;
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

    _prepareResourceContext(data, scopeKey) {
        scopeKey = scopeKey || B62StateKeys.resourceScopeKey(data);
        this._resourceScopeKey = scopeKey;
        let scope = this._resourceScopes.get(scopeKey);
        if (!scope) {
            scope = {
                urls: {},
                resources: {},
                objectUrls: []
            };
            this._resourceScopes.set(scopeKey, scope);
        }

        normalizeB62Resources(data).forEach((resource) => {
            const index = String(resource.index);
            const previous = scope.resources[index];
            const url = sameB62Resource(previous, resource) ? scope.urls[index] : this._resourceToUrl(resource, scope);
            if (url) {
                scope.urls[index] = url;
            }
            scope.resources[index] = resource;
        });

        return {
            count: Object.keys(scope.urls).length,
            resolve: (url) => this._resolveResourceUrl(scope, url),
            resource: (url) => this._resolveResource(scope, url)
        };
    }

    _resourceToUrl(resource, scope) {
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
        scope.objectUrls.push(url);
        return url;
    }

    _resolveResourceUrl(scope, url) {
        if (!url) {
            return '';
        }
        const normalized = normalizeResourceReference(url);
        const match = normalized.match(/^subt:\/\/(\d+)$/);
        if (!match) {
            return normalized;
        }
        return scope.urls[match[1]] || '';
    }

    _resolveResource(scope, url) {
        if (!url) {
            return null;
        }
        const normalized = normalizeResourceReference(url);
        const match = normalized.match(/^subt:\/\/(\d+)$/);
        if (!match) {
            return null;
        }
        return scope.resources[match[1]] || null;
    }

    _releaseUnusedResourceScopes() {
        const referenced = this._state.referencedResourceScopes();
        if (this._resourceScopeKey !== null) {
            referenced.add(this._resourceScopeKey);
        }
        Array.from(this._resourceScopes.keys()).forEach((scopeKey) => {
            if (!referenced.has(scopeKey)) {
                this._clearResourceScope(scopeKey);
            }
        });
    }

    _clearResourceScope(scopeKey) {
        const scope = this._resourceScopes.get(scopeKey);
        if (!scope) {
            return;
        }
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
            scope.objectUrls.forEach((url) => URL.revokeObjectURL(url));
        }
        this._resourceScopes.delete(scopeKey);
    }

    _clearResourceUrls() {
        Array.from(this._resourceScopes.keys()).forEach((scopeKey) => this._clearResourceScope(scopeKey));
    }
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
