import {connectedRectPath, groupNearbyRects, uniformSpanStyleValue} from './utils/cues.js';
import {
    applyARIBMarquee,
    applyTextStroke,
    applyTTMLBorder,
    createCueStyleElement,
    cssEscapeUrl,
    fontFaceMatchesText,
    fontFaceFamilyStackForText,
    getTextStrokeWidth,
    mapARIBFontFamily,
    mapDisplayAlign,
    mapTextAlignItems,
    mapWritingMode,
    parseARIBAnimation,
    parseTTMLTextStroke,
    scaleTTMLShadow
} from './utils/style.js';
import {getMediaContentViewport} from './utils/viewport.js';
import {appendTTMLTextWithSVGGlyphs} from './utils/glyphs.js';
import {parseTTMLColor, parseTTMLLength, parseTTMLLengthPair} from './utils/ttml.js';

/**
 * Default B62 output backend.
 *
 * B62TTMLRenderer owns document parsing, timing and presentation state. This
 * class owns only the DOM paint step so a renderer for an incompatible output
 * model (Canvas, native/WASM bitmaps, etc.) can be supplied without forking the
 * B62 state machine.
 */
export class B62DOMRenderer {
    constructor() {
        this._fontLoads = new Map();
        this._activeFontKeys = new Set();
        this._requestLayout = null;
        this._destroyed = false;
    }

    clear(context) {
        const overlay = context && context.overlayElement;
        if (overlay) {
            overlay.innerHTML = '';
        }
        this._activeFontKeys.clear();
        this._pruneFontLoads();
    }

    renderScene(context) {
        context = context || {};
        const overlay = context.overlayElement;
        if (!overlay) {
            return;
        }
        overlay.innerHTML = '';
        (context.cues || []).forEach((cue) => {
            if (!cue.clear) {
                renderTTMLCueDOM(
                    overlay,
                    cue,
                    context.styleOptions || {},
                    context.mediaElement || null
                );
            }
        });
        this._watchFonts(context);
        this.syncTime(context);
    }

    destroy(context) {
        this.clear(context);
        this._destroyed = true;
        this._requestLayout = null;
        this._fontLoads.clear();
    }

    syncTime(context) {
        const overlay = context && context.overlayElement;
        const media = context && context.mediaElement;
        if (!overlay || !media || typeof overlay.getAnimations !== 'function') {
            return;
        }
        overlay.getAnimations({subtree: true}).forEach((animation) => {
            const target = animation.effect && animation.effect.target;
            const cueElement = target && target.closest ? target.closest('[data-aribb62-cue-start]') : null;
            if (!cueElement) {
                return;
            }
            const cueStart = Number(cueElement.getAttribute('data-aribb62-cue-start'));
            if (!Number.isFinite(cueStart)) {
                return;
            }
            animation.pause();
            animation.currentTime = Math.max(0, ((media.currentTime || 0) - cueStart) * 1000);
        });
    }

    _watchFonts(context) {
        const overlay = context && context.overlayElement;
        const ownerDocument = overlay && overlay.ownerDocument;
        const fontSet = ownerDocument && ownerDocument.fonts;
        this._requestLayout = context && context.requestLayout;
        this._activeFontKeys = new Set();
        if (!fontSet || typeof fontSet.load !== 'function') {
            this._pruneFontLoads();
            return;
        }

        const requests = new Map();
        (context.cues || []).forEach((cue) => {
            const text = cue.blocks.map((block) => block.spans.map((span) => span.text || '').join('')).join('');
            (cue.fontFaces || []).forEach((fontFace) => {
                if (!fontFace || !fontFace.family || !fontFace.url || fontFace.svgGlyphs ||
                    !fontFaceMatchesText(fontFace, text)) {
                    return;
                }
                const key = [fontFace.family, fontFace.url, fontFace.unicodeRange || ''].join('|');
                this._activeFontKeys.add(key);
                if (requests.has(key)) {
                    requests.get(key).text += text;
                } else {
                    requests.set(key, {fontFace: fontFace, text: text});
                }
            });
        });
        this._pruneFontLoads();

        requests.forEach((request, key) => {
            if (this._fontLoads.has(key)) {
                return;
            }
            const family = String(request.fontFace.family).replace(/["\\\n\r]/g, '\\$&');
            const record = {state: 'pending'};
            this._fontLoads.set(key, record);
            Promise.resolve(fontSet.load('16px "' + family + '"', request.text || ' ')).then(() => {
                record.state = 'loaded';
                if (!this._destroyed && this._activeFontKeys.has(key) && typeof this._requestLayout === 'function') {
                    this._requestLayout();
                } else if (!this._activeFontKeys.has(key)) {
                    this._fontLoads.delete(key);
                }
            }, () => {
                record.state = 'failed';
                if (!this._activeFontKeys.has(key)) {
                    this._fontLoads.delete(key);
                }
            });
        });
    }

    _pruneFontLoads() {
        this._fontLoads.forEach((record, key) => {
            if (!this._activeFontKeys.has(key) && record.state !== 'pending') {
                this._fontLoads.delete(key);
            }
        });
    }
}

export function renderTTMLCueDOM(overlay, cue, styleOptions, mediaElement) {
    styleOptions = styleOptions || {};
    const viewport = getMediaContentViewport(overlay, mediaElement);
    const overlayWidth = viewport.width || 1;
    const overlayHeight = viewport.height || 1;
    const planeWidth = cue.plane[0] || 3840;
    const planeHeight = cue.plane[1] || 2160;
    const baseScale = Math.min(overlayWidth / planeWidth, overlayHeight / planeHeight);
    const smallScreenScale = resolveSmallScreenScale(styleOptions, overlayHeight);
    const scale = baseScale * smallScreenScale;
    const baseContentWidth = planeWidth * baseScale;
    const baseContentHeight = planeHeight * baseScale;
    const baseMarginX = viewport.left + (overlayWidth - baseContentWidth) / 2;
    const baseMarginY = viewport.top + (overlayHeight - baseContentHeight) / 2;
    const horizontalAnchor = cueHorizontalScaleAnchor(cue, planeWidth, planeHeight);
    const marginX = baseMarginX + horizontalAnchor * (baseScale - scale);
    const marginY = smallScreenScale > 1 ?
        baseMarginY + planeHeight * (baseScale - scale) :
        baseMarginY;
    const mergedLineBackgrounds = [];
    const animationNames = cueAnimationNames(cue);

    if ((cue.fontFaces && cue.fontFaces.length > 0) || (cue.keyframes && cue.keyframes.length > 0) || cue.hasMarquee) {
        overlay.appendChild(createCueStyleElement(cue, scale, animationNames));
    }

    cue.blocks.forEach((block) => {
        const hasSpanRegion = block.spans.some((span) => !!span.region);
        const region = block.region || (hasSpanRegion ? {
            origin: [0, 0],
            extent: [planeWidth, planeHeight],
            displayAlign: 'before',
            style: {}
        } : {});
        const origin = region.origin || [planeWidth * 0.1, planeHeight * 0.78];
        const extent = region.extent || [planeWidth * 0.8, planeHeight * 0.16];
        const regionLeft = ttmlRegionLeft(region, origin, extent);
        const blockLeft = marginX + regionLeft * scale;
        const blockTop = marginY + origin[1] * scale;
        const blockWidth = extent[0] * scale;
        const blockHeight = extent[1] * scale;
        const writingMode = mapWritingMode(block.style.writingMode);
        const isHorizontalWriting = !writingMode.writingMode || writingMode.writingMode === 'horizontal-tb';
        const blockElement = document.createElement('div');
        blockElement.className = 'ttml-subtitle-block';
        blockElement.setAttribute('data-aribb62-cue-start', String(cue.start));
        blockElement.style.position = 'absolute';
        blockElement.style.display = 'flex';
        blockElement.style.flexDirection = 'column';
        blockElement.style.boxSizing = 'border-box';
        blockElement.style.color = '#fff';
        blockElement.style.whiteSpace = 'pre-wrap';
        const hasMarquee = !!block.style.marquee || block.spans.some((span) => span.style && span.style.marquee);
        blockElement.style.overflow = 'hidden';
        blockElement.style.fontSize = 72 * scale + 'px';
        blockElement.style.lineHeight = 90 * scale + 'px';
        blockElement.style.fontFamily = styleOptions.normalFont;
        blockElement.style.fontKerning = 'none';
        blockElement.style.fontVariantEastAsian = 'full-width';
        blockElement.style.fontFeatureSettings = '"palt" 0, "pkna" 0';
        // libaribcaption's B62 layout uses center as the paragraph default.
        // Explicitly positioned span regions are reset to start below because
        // their origin is an operation-position reference, not an alignment box.
        const textAlign = block.style.textAlign || 'center';
        blockElement.style.textAlign = textAlign;
        blockElement.style.alignItems = mapTextAlignItems(textAlign);
        blockElement.style.justifyContent = mapDisplayAlign(region.displayAlign);
        applyTTMLStyle(blockElement, block.style, scale, {
            skipAnimation: true,
            skipBorder: true,
            skipMarquee: true
        });
        applyViewerStyle(blockElement, styleOptions, scale);
        applyFallbackReadableTextStyle(blockElement, styleOptions, scale);
        applyFontFaceStack(blockElement, cue.fontFaces, block.spans.map((span) => span.text || '').join(''));
        blockElement.style.left = blockLeft + 'px';
        blockElement.style.top = blockTop + 'px';
        blockElement.style.width = blockWidth + 'px';
        blockElement.style.height = blockHeight + 'px';
        blockElement.style.padding = '0';
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
        applyTTMLRegionOriginVariables(line, region, scale);
        const lineStyle = Object.assign({}, block.contentStyle || {});
        if (!lineStyle.writingMode && block.style.writingMode) {
            lineStyle.writingMode = block.style.writingMode;
        }
        if (!lineStyle.animation && block.style.animation) {
            lineStyle.animation = block.style.animation;
        }
        applyTTMLStyle(line, lineStyle, scale, {animationNames: animationNames});
        const lineBackgroundColor = resolveLineBackgroundColor(blockElement, block, styleOptions);
        const renderedSpans = [];
        const renderedRegionGroups = new Set();
        for (let spanIndex = 0; spanIndex < block.spans.length;) {
            const span = block.spans[spanIndex];
            let element;
            if (span.regionGroupId) {
                spanIndex++;
                if (renderedRegionGroups.has(span.regionGroupId)) {
                    continue;
                }
                renderedRegionGroups.add(span.regionGroupId);
                const group = block.spans.filter((candidate) => candidate.regionGroupId === span.regionGroupId);
                element = renderTTMLSpanRegionGroupDOM(group, scale, styleOptions, cue.fontFaces, region, animationNames);
            } else {
                element = renderTTMLSpanDOM(span, scale, styleOptions, cue.fontFaces, region, animationNames);
                spanIndex++;
            }
            line.appendChild(element);
            renderedSpans.push({
                element: element,
                color: span.style && span.style.backgroundColor ?
                    parseTTMLColor(span.style.backgroundColor) : ''
            });
        }
        blockElement.appendChild(line);
        overlay.appendChild(blockElement);
        finalizeTTMLFontWidths(blockElement);
        if (lineBackgroundColor) {
            if (styleOptions.lineBackground) {
                blockElement.style.backgroundColor = '';
                clearElementBackgrounds(line);
                line.style.padding = normalizeLineBackgroundPadding(styleOptions.backgroundPadding);
                const logicalBackgrounds = resolveTTMLLogicalLineBackgrounds(
                    block, line, scale, blockLeft, blockTop, blockWidth,
                    writingMode.writingMode || 'horizontal-tb'
                );
                (logicalBackgrounds.length > 0 ? logicalBackgrounds : [null]).forEach((rect) => {
                    mergedLineBackgrounds.push({
                        rect: rect,
                        element: line,
                        color: lineBackgroundColor,
                        groupKey: block.groupKey || 'group:default',
                        writingMode: writingMode.writingMode || 'horizontal-tb',
                        top: blockTop,
                        height: resolveTTMLLineBoxHeight(block, scale)
                    });
                });
            } else if (styleOptions.forceBackgroundColor) {
                blockElement.style.backgroundColor = lineBackgroundColor;
            }
        } else if (styleOptions.lineBackground && renderedSpans.some((span) => span.color)) {
            blockElement.style.backgroundColor = '';
            renderedSpans.forEach((span) => {
                span.element.style.backgroundColor = '';
                if (!span.color) {
                    return;
                }
                mergedLineBackgrounds.push({
                    element: span.element,
                    color: span.color,
                    groupKey: block.groupKey || 'group:default',
                    writingMode: writingMode.writingMode || 'horizontal-tb',
                    top: blockTop,
                    height: resolveTTMLLineBoxHeight(block, scale)
                });
            });
        }
    });
    appendMergedLineBackgroundLayer(overlay, mergedLineBackgrounds);
}

function resolveSmallScreenScale(styleOptions, viewportHeight) {
    const option = styleOptions && styleOptions.smallScreenScale;
    if (option === false) {
        return 1;
    }
    if (Number.isFinite(option)) {
        return Math.max(1, Math.min(2, option));
    }
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
        return 1;
    }
    // Zoom the complete caption plane instead of clamping individual font
    // sizes so separately positioned readings keep their registration.
    return Math.max(1, Math.min(2, 640 / viewportHeight));
}

function cueHorizontalScaleAnchor(cue, planeWidth, planeHeight) {
    let left = Infinity;
    let right = -Infinity;
    const include = (region) => {
        if (!region) {
            return;
        }
        const origin = region.origin || [planeWidth * 0.1, planeHeight * 0.78];
        const extent = region.extent || [planeWidth * 0.8, planeHeight * 0.16];
        const regionLeft = ttmlRegionLeft(region, origin, extent);
        left = Math.min(left, regionLeft);
        right = Math.max(right, regionLeft + extent[0]);
    };
    (cue.blocks || []).forEach((block) => {
        include(block.region);
        (block.spans || []).forEach((span) => include(span.region));
    });
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return planeWidth / 2;
    }
    return (left + right) / 2 <= planeWidth / 2 ? left : right;
}

function appendMergedLineBackgroundLayer(overlay, backgrounds) {
    if (!overlay || backgrounds.length === 0 || !overlay.getBoundingClientRect) {
        return;
    }
    const overlayRect = overlay.getBoundingClientRect();
    const groups = new Map();
    backgrounds.forEach((background) => {
        const measured = background.rect || (() => {
            const elementRect = background.element.getBoundingClientRect();
            return {
                left: elementRect.left - overlayRect.left,
                top: Number.isFinite(background.top) ? background.top : elementRect.top - overlayRect.top,
                right: elementRect.right - overlayRect.left,
                bottom: Number.isFinite(background.top) && Number.isFinite(background.height) ?
                    background.top + background.height : elementRect.bottom - overlayRect.top
            };
        })();
        if (measured.right <= measured.left || measured.bottom <= measured.top) {
            return;
        }
        const groupKey = [
            background.groupKey || 'group:default',
            background.writingMode,
            background.color
        ].join('|');
        if (!groups.has(groupKey)) {
            groups.set(groupKey, {color: background.color, rects: []});
        }
        groups.get(groupKey).rects.push({
            left: measured.left,
            top: measured.top,
            right: measured.right,
            bottom: measured.bottom
        });
    });
    if (groups.size === 0) {
        return;
    }

    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.classList.add('ttml-subtitle-background-layer');
    svg.setAttribute('width', String(overlay.clientWidth || 1));
    svg.setAttribute('height', String(overlay.clientHeight || 1));
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';

    groups.forEach((group) => {
        groupNearbyRects(group.rects, 1).forEach((rectGroup) => {
            const path = document.createElementNS(namespace, 'path');
            path.setAttribute('d', connectedRectPath(rectGroup, 1));
            path.setAttribute('fill', group.color);
            path.setAttribute('fill-rule', 'nonzero');
            svg.appendChild(path);
        });
    });
    overlay.insertBefore(svg, overlay.firstChild);
}

function resolveTTMLLineBoxHeight(block, scale) {
    const blockLineHeight = block && block.style ? block.style.lineHeight : '';
    const spanLineHeight = uniformSpanStyleValue(
        block && block.spans ? block.spans : [],
        'lineHeight'
    );
    const lineHeight = parseTTMLLength(blockLineHeight || spanLineHeight, 2160);
    return lineHeight !== null && lineHeight > 0 ? lineHeight * scale : null;
}

function resolveTTMLLogicalLineBackgrounds(block, lineElement, scale, blockLeft, blockTop, blockWidth, writingMode) {
    if (writingMode !== 'horizontal-tb') {
        return [];
    }

    const lines = [0];
    let lineHeight = 0;
    (block.spans || []).forEach((span) => {
        const style = span.style || block.style || {};
        const fontSize = resolveTTMLPlaneFontSize(style, block.style);
        const spacing = parseTTMLLength(style.letterSpacing, 3840) || 0;
        const spanLineHeight = parseTTMLLength(style.lineHeight, 2160);
        lineHeight = Math.max(lineHeight, spanLineHeight || fontSize[1] * 1.25);
        Array.from(String(span.text || '')).forEach((character) => {
            if (character === '\n') {
                lines.push(0);
                return;
            }
            const codePoint = character.codePointAt(0);
            const width = isARIBHalfwidthCharacter(codePoint) ? fontSize[0] / 2 : fontSize[0];
            lines[lines.length - 1] += Math.max(1, width + spacing);
        });
    });
    if (lineHeight <= 0) {
        lineHeight = (resolveTTMLLineBoxHeight(block, 1) || 90);
    }

    const view = lineElement.ownerDocument && lineElement.ownerDocument.defaultView;
    const computed = view && view.getComputedStyle ? view.getComputedStyle(lineElement) : null;
    const paddingLeft = computed ? parseFloat(computed.paddingLeft) || 0 : 0;
    const paddingRight = computed ? parseFloat(computed.paddingRight) || 0 : 0;
    const paddingTop = computed ? parseFloat(computed.paddingTop) || 0 : 0;
    const paddingBottom = computed ? parseFloat(computed.paddingBottom) || 0 : 0;
    const textAlign = block.style && block.style.textAlign || 'center';

    return lines.filter((width) => width > 0).map((width, index) => {
        let offset = 0;
        if (textAlign === 'center') {
            offset = (blockWidth / scale - width) / 2;
        } else if (textAlign === 'right' || textAlign === 'end') {
            offset = blockWidth / scale - width;
        }
        return {
            left: blockLeft + offset * scale - paddingLeft,
            top: blockTop + index * lineHeight * scale - paddingTop,
            right: blockLeft + (offset + width) * scale + paddingRight,
            bottom: blockTop + (index + 1) * lineHeight * scale + paddingBottom
        };
    });
}

function resolveTTMLPlaneFontSize(style, fallbackStyle) {
    const value = style && style.fontSize || fallbackStyle && fallbackStyle.fontSize;
    const pair = parseTTMLLengthPair(value, [3840, 2160]);
    if (pair) {
        return pair;
    }
    const height = parseTTMLLength(value, 2160);
    return height !== null ? [height, height] : [72, 72];
}

function isARIBHalfwidthCharacter(codePoint) {
    return (codePoint !== 0 && (codePoint & 0xFFFFFF00) === 0) ||
        (codePoint >= 0xFF61 && codePoint <= 0xFF9F) ||
        (codePoint >= 0xFFE8 && codePoint <= 0xFFEE);
}

function resolveLineBackgroundColor(blockElement, block, styleOptions) {
    if (styleOptions.forceBackgroundColor) {
        return styleOptions.forceBackgroundColor;
    }
    if (blockElement.style.backgroundColor) {
        return blockElement.style.backgroundColor;
    }

    const spans = block && block.spans ? block.spans : [];
    return uniformSpanStyleValue(spans, 'backgroundColor', parseTTMLColor);
}

function normalizeLineBackgroundPadding(value) {
    const text = String(value || '').trim();
    return text || '0.08em 0.08em';
}

function clearElementBackgrounds(element) {
    if (!element || !element.querySelectorAll) {
        return;
    }
    element.querySelectorAll('*').forEach((child) => {
        child.style.backgroundColor = '';
    });
}

function renderTTMLSpanRegionGroupDOM(spans, scale, styleOptions, fontFaces, parentRegion, animationNames) {
    const first = spans[0];
    const wrapper = document.createElement('span');
    wrapper.setAttribute('data-aribb62-region-group', first.regionGroupId);
    applyTTMLStyle(wrapper, first.regionStyle || {}, scale, {animationNames: animationNames});
    wrapper.style.textAlign = 'start';
    applyFontFaceStack(wrapper, fontFaces, spans.map((span) => span.text || '').join(''));
    spans.forEach((span) => {
        const child = Object.assign({}, span, {
            region: null,
            regionGroupId: null,
            regionStyle: null,
            style: styleWithoutRegionAnimation(span.style, span.regionStyle)
        });
        wrapper.appendChild(renderTTMLSpanDOM(child, scale, styleOptions, fontFaces, null, animationNames));
    });
    applyTTMLSpanRegion(wrapper, first.region, parentRegion, scale);
    return wrapper;
}

function styleWithoutRegionAnimation(style, regionStyle) {
    const result = Object.assign({}, style || {});
    ['animation', 'extent', 'origin'].forEach((name) => {
        if (regionStyle && result[name] === regionStyle[name]) {
            delete result[name];
        }
    });
    return result;
}

function renderTTMLSpanDOM(span, scale, styleOptions, fontFaces, parentRegion, animationNames) {
    const fontWidthRatio = resolveTTMLFontWidthRatio(span.style);
    if (span.rubyText) {
        const rubyElement = document.createElement('ruby');
        const baseElement = document.createElement('span');
        const rubyTextElement = document.createElement('rt');
        rubyTextElement.style.fontSize = '50%';
        rubyTextElement.style.lineHeight = '1';
        appendTTMLTextWithSVGGlyphs(baseElement, span.text, fontFaces);
        appendTTMLTextWithSVGGlyphs(rubyTextElement, span.rubyText, fontFaces);
        rubyElement.appendChild(baseElement);
        rubyElement.appendChild(rubyTextElement);
        if (fontWidthRatio !== 1) {
            const wrapper = document.createElement('span');
            applyTTMLStyle(wrapper, span.style, scale, {animationNames: animationNames});
            applyViewerStyle(wrapper, styleOptions, scale);
            applyFontFaceStack(wrapper, fontFaces, (span.text || '') + (span.rubyText || ''));
            applyTTMLFontWidth(wrapper, rubyElement, fontWidthRatio);
            applyTTMLSpanRegion(wrapper, span.region, parentRegion, scale);
            return wrapper;
        }
        applyTTMLStyle(rubyElement, span.style, scale, {animationNames: animationNames});
        applyViewerStyle(rubyElement, styleOptions, scale);
        applyFontFaceStack(rubyElement, fontFaces, (span.text || '') + (span.rubyText || ''));
        applyTTMLSpanRegion(rubyElement, span.region, parentRegion, scale);
        return rubyElement;
    }

    const spanElement = document.createElement('span');
    if (span.isRuby) {
        spanElement.setAttribute('data-aribb62-ruby', '');
    }
    applyTTMLStyle(spanElement, span.style, scale, {animationNames: animationNames});
    applyViewerStyle(spanElement, styleOptions, scale);
    applyFontFaceStack(spanElement, fontFaces, span.text);
    if (fontWidthRatio !== 1) {
        const contentElement = document.createElement('span');
        appendTTMLTextWithSVGGlyphs(contentElement, span.text, fontFaces);
        applyTTMLFontWidth(spanElement, contentElement, fontWidthRatio);
    } else {
        appendTTMLTextWithSVGGlyphs(spanElement, span.text, fontFaces);
    }
    applyTTMLSpanRegion(spanElement, span.region, parentRegion, scale);
    return spanElement;
}

function applyTTMLRegionOriginVariables(element, region, scale) {
    if (!element || !region || !region.origin) {
        return;
    }
    element.style.setProperty('--aribb62-origin-x', (region.origin[0] * scale) + 'px');
    element.style.setProperty('--aribb62-origin-y', (region.origin[1] * scale) + 'px');
}

function ttmlRegionLeft(region, origin, extent) {
    const writingMode = mapWritingMode(region && region.style && region.style.writingMode);
    return writingMode.writingMode && writingMode.writingMode !== 'horizontal-tb' ?
        origin[0] - extent[0] : origin[0];
}

function applyTTMLSpanRegion(element, region, parentRegion, scale) {
    if (!element || !region) {
        return;
    }
    const origin = region.origin || [0, 0];
    const extent = region.extent || [0, 0];
    const parentOrigin = parentRegion && parentRegion.origin ? parentRegion.origin : [0, 0];
    const parentExtent = parentRegion && parentRegion.extent ? parentRegion.extent : [0, 0];
    const left = ttmlRegionLeft(region, origin, extent);
    const parentLeft = ttmlRegionLeft(parentRegion, parentOrigin, parentExtent);
    element.style.position = 'absolute';
    element.style.display = 'block';
    element.style.left = ((left - parentLeft) * scale) + 'px';
    element.style.top = ((origin[1] - parentOrigin[1]) * scale) + 'px';
    element.style.overflow = 'hidden';
    const writingMode = mapWritingMode(region.style && region.style.writingMode);
    if (writingMode.writingMode) {
        element.style.writingMode = writingMode.writingMode;
    }
    if (writingMode.direction) {
        element.style.direction = writingMode.direction;
    }
    if (region.extent) {
        element.style.width = (extent[0] * scale) + 'px';
        element.style.height = (extent[1] * scale) + 'px';
    }
    applyTTMLRegionOriginVariables(element, region, scale);
}

function resolveTTMLFontWidthRatio(style) {
    const value = style && style.fontSize ? String(style.fontSize).trim() : '';
    if (value.split(/\s+/).length < 2) {
        return 1;
    }
    const pair = parseTTMLLengthPair(value, [3840, 2160]);
    if (!pair || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[1] <= 0) {
        return 1;
    }
    const ratio = pair[0] / pair[1];
    return ratio > 0 ? ratio : 1;
}

function applyTTMLFontWidth(wrapper, content, ratio) {
    wrapper.style.display = 'inline-block';
    wrapper.style.verticalAlign = 'top';
    wrapper.setAttribute('data-aribb62-font-width-ratio', String(ratio));
    content.setAttribute('data-aribb62-font-width-content', '');
    content.style.display = 'inline-block';
    content.style.transform = 'scaleX(' + ratio + ')';
    content.style.transformOrigin = 'left top';
    wrapper.appendChild(content);
}

function finalizeTTMLFontWidths(root) {
    if (!root || !root.querySelectorAll) {
        return;
    }
    root.querySelectorAll('[data-aribb62-font-width-ratio]').forEach((wrapper) => {
        const content = wrapper.querySelector('[data-aribb62-font-width-content]');
        if (!content || !content.getBoundingClientRect) {
            return;
        }
        const rect = content.getBoundingClientRect();
        if (rect.width > 0) {
            wrapper.style.width = rect.width + 'px';
        }
    });
}


function applyTTMLStyle(element, style, scale, options) {
    if (!style) {
        return;
    }
    options = options || {};
    if (style.fontSize) {
        const fontSize = parseTTMLLengthPair(style.fontSize, [3840, 2160]);
        const height = fontSize ? fontSize[1] : parseTTMLLength(style.fontSize, 2160);
        if (height) {
            element.style.fontSize = height * scale + 'px';
        }
    }
    if (style.lineHeight) {
        const lineHeight = parseTTMLLength(style.lineHeight, 2160);
        if (lineHeight) {
            element.style.lineHeight = lineHeight * scale + 'px';
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
    if (style.textOutline) {
        element.style.setProperty('--aribb62-explicit-outline', '1');
        const stroke = parseTTMLTextStroke(style.textOutline, scale);
        if (stroke) {
            element.style.webkitTextStroke = stroke.width + 'px ' + stroke.color;
            element.style.paintOrder = 'stroke fill';
            element.style.setProperty('--aribb62-stroke-color', stroke.color);
            element.style.setProperty('--aribb62-stroke-width', stroke.width + 'px');
            if (stroke.blur > 0) {
                const blurShadow = '0 0 ' + stroke.blur + 'px ' + stroke.color;
                element.style.textShadow = element.style.textShadow && element.style.textShadow !== 'none' ?
                    element.style.textShadow + ', ' + blurShadow : blurShadow;
            }
        } else {
            element.style.webkitTextStroke = '0px transparent';
            element.style.setProperty('--aribb62-stroke-width', '0px');
        }
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
    if (!options.skipBorder) {
        applyTTMLBorder(element, style, scale);
    }
    if (style.animation && !options.skipAnimation) {
        const animation = parseARIBAnimation(style.animation, options.animationNames);
        if (animation) {
            element.style.animation = animation;
        }
    }
    if (style.marquee && !options.skipMarquee) {
        applyARIBMarquee(element, style.marquee, style.writingMode);
    }
}

function cueAnimationNames(cue) {
    const result = {};
    const seed = [cue.trackKey || '', cue.eventId || 0, cue.key || ''].join('|');
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    (cue.keyframes || []).forEach((keyframes, index) => {
        if (keyframes && keyframes.name) {
            result[keyframes.name] = 'aribb62-' + (hash >>> 0).toString(36) + '-' + index + '-' + keyframes.name;
        }
    });
    return result;
}

function applyViewerStyle(element, options, scale) {
    if (!options) {
        return;
    }
    if (options.normalFont) {
        element.style.fontFamily = options.normalFont;
    }
    if (options.forceStrokeColor) {
        const color = typeof options.forceStrokeColor === 'string' ? options.forceStrokeColor : '#000';
        applyTextStroke(element, resolveViewerStrokeWidth(options, scale), color);
    }
}

function applyFallbackReadableTextStyle(element, options, scale) {
    if (!options || options.forceStrokeColor || !options.fallbackStrokeColor) {
        return;
    }
    if (element.style.getPropertyValue('--aribb62-explicit-outline') ||
        getTextStrokeWidth(element) > 0 ||
        (element.style.textShadow && element.style.textShadow !== 'none')) {
        return;
    }
    applyTextStroke(element, resolveViewerStrokeWidth(options, scale), options.fallbackStrokeColor);
}

function resolveViewerStrokeWidth(options, scale) {
    if (Number.isFinite(options.strokeWidthInPlane)) {
        return options.strokeWidthInPlane * scale;
    }
    return options.strokeWidth || 1.5;
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
