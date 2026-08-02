import {connectedRectPath, groupNearbyRects, uniformSpanStyleValue} from './utils/cues.js';
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
    clear(context) {
        const overlay = context && context.overlayElement;
        if (overlay) {
            overlay.innerHTML = '';
        }
    }

    renderScene(context) {
        context = context || {};
        const overlay = context.overlayElement;
        if (!overlay) {
            return;
        }
        this.clear(context);
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
    }

    destroy(context) {
        this.clear(context);
    }
}

export function renderTTMLCueDOM(overlay, cue, styleOptions, mediaElement) {
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
    const mergedLineBackgrounds = [];

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
        blockElement.style.whiteSpace = 'pre-wrap';
        const hasMarquee = !!block.style.marquee || block.spans.some((span) => span.style && span.style.marquee);
        blockElement.style.overflow = 'hidden';
        blockElement.style.fontSize = Math.max(14, 72 * scale) + 'px';
        blockElement.style.lineHeight = Math.max(16, 90 * scale) + 'px';
        blockElement.style.fontFamily = styleOptions.normalFont;
        blockElement.style.fontKerning = 'none';
        blockElement.style.fontVariantEastAsian = 'full-width';
        blockElement.style.fontFeatureSettings = '"palt" 0, "pkna" 0';
        const textAlign = block.style.textAlign || 'start';
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
        applyTTMLRegionOriginVariables(line, region, scale);
        const lineStyle = Object.assign({}, block.contentStyle || {});
        if (!lineStyle.writingMode && block.style.writingMode) {
            lineStyle.writingMode = block.style.writingMode;
        }
        applyTTMLStyle(line, lineStyle, scale);
        const lineBackgroundColor = resolveLineBackgroundColor(blockElement, block, styleOptions);
        const renderedSpans = [];
        block.spans.forEach((span) => {
            const element = renderTTMLSpanDOM(span, scale, styleOptions, cue.fontFaces, region);
            line.appendChild(element);
            renderedSpans.push({
                element: element,
                color: span.style && span.style.backgroundColor ?
                    parseTTMLColor(span.style.backgroundColor) : ''
            });
        });
        if (lineBackgroundColor) {
            if (styleOptions.lineBackground) {
                blockElement.style.backgroundColor = '';
                clearElementBackgrounds(line);
                line.style.padding = normalizeLineBackgroundPadding(styleOptions.backgroundPadding);
                mergedLineBackgrounds.push({
                    element: line,
                    color: lineBackgroundColor,
                    groupKey: block.groupKey || 'group:default',
                    writingMode: writingMode.writingMode || 'horizontal-tb',
                    top: blockTop,
                    height: resolveTTMLLineBoxHeight(block, scale)
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
        blockElement.appendChild(line);
        overlay.appendChild(blockElement);
        finalizeTTMLFontWidths(blockElement);
    });
    appendMergedLineBackgroundLayer(overlay, mergedLineBackgrounds);
}

function appendMergedLineBackgroundLayer(overlay, backgrounds) {
    if (!overlay || backgrounds.length === 0 || !overlay.getBoundingClientRect) {
        return;
    }
    const overlayRect = overlay.getBoundingClientRect();
    const groups = new Map();
    backgrounds.forEach((background) => {
        const rect = background.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
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
            left: rect.left - overlayRect.left,
            top: Number.isFinite(background.top) ? background.top : rect.top - overlayRect.top,
            right: rect.right - overlayRect.left,
            bottom: Number.isFinite(background.top) && Number.isFinite(background.height) ?
                background.top + background.height : rect.bottom - overlayRect.top
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

function renderTTMLSpanDOM(span, scale, styleOptions, fontFaces, parentRegion) {
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
            applyTTMLStyle(wrapper, span.style, scale);
            applyViewerStyle(wrapper, styleOptions, scale);
            applyFontFaceStack(wrapper, fontFaces, (span.text || '') + (span.rubyText || ''));
            applyTTMLFontWidth(wrapper, rubyElement, fontWidthRatio);
            applyTTMLSpanRegion(wrapper, span.region, parentRegion, scale);
            return wrapper;
        }
        applyTTMLStyle(rubyElement, span.style, scale);
        applyViewerStyle(rubyElement, styleOptions, scale);
        applyFontFaceStack(rubyElement, fontFaces, (span.text || '') + (span.rubyText || ''));
        applyTTMLSpanRegion(rubyElement, span.region, parentRegion, scale);
        return rubyElement;
    }

    const spanElement = document.createElement('span');
    applyTTMLStyle(spanElement, span.style, scale);
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

function applyTTMLSpanRegion(element, region, parentRegion, scale) {
    if (!element || !region) {
        return;
    }
    const origin = region.origin || [0, 0];
    const parentOrigin = parentRegion && parentRegion.origin ? parentRegion.origin : [0, 0];
    element.style.position = 'absolute';
    element.style.display = 'block';
    element.style.left = ((origin[0] - parentOrigin[0]) * scale) + 'px';
    element.style.top = ((origin[1] - parentOrigin[1]) * scale) + 'px';
    element.style.overflow = 'hidden';
    if (region.extent) {
        element.style.width = (region.extent[0] * scale) + 'px';
        element.style.height = (region.extent[1] * scale) + 'px';
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
        const animation = parseARIBAnimation(style.animation);
        if (animation) {
            element.style.animation = animation;
        }
    }
    if (style.marquee && !options.skipMarquee) {
        applyARIBMarquee(element, style.marquee, style.writingMode);
    }
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
