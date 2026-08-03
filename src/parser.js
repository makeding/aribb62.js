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
    offsetTTMLAudios
} from './utils/resources.js';
import {groupRawTTMLCues} from './utils/cues.js';
import {normalizeTTMLText} from './utils/text.js';
import {parseTTMLLengthPair, parseTTMLPlane, parseTTMLTime} from './utils/ttml.js';

export function findTTMLMinStart(text) {
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
        if (Number.isFinite(start) && (minStart === null || start < minStart)) {
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

export function parseARIBTTML(text, basePts, currentTime, forceBaseAlignment, options) {
    return parseARIBTTMLDocument(text, basePts, currentTime, forceBaseAlignment, options).cues;
}

export function parseARIBTTMLDocument(text, basePts, currentTime, forceBaseAlignment, options) {
    options = options || {};
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement || localName(doc.documentElement) !== 'tt') {
        return {kind: 'invalid', cues: [], continuations: []};
    }

    const tt = doc.documentElement;
    if (isEmptyTTMLDocument(tt)) {
        return {kind: 'clear', cues: [], continuations: []};
    }
    if (!firstChildByLocalName(tt, 'body')) {
        return {kind: 'presentation', cues: [], continuations: []};
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
    const rawContinuations = [];
    const presentationGroups = new Map();
    let nextPresentationGroupId = 0;

    pNodes.forEach((pNode, index) => {
        const timingNode = nearestTimedNode(pNode);
        const beginValue = getTTMLAttr(pNode, 'begin');
        let rawStart = parseTTMLTime(beginValue);
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

        if (String(beginValue || '').trim() === 'indefinite') {
            const id = getXMLId(pNode);
            if (id) {
                rawContinuations.push({id: id, rawEnd: rawEnd, rawDur: rawDur});
            }
            return;
        }

        const regionId = nearestTTMLAttr(pNode, 'region');
        const region = regions[regionId] || null;
        const contentStyle = collectInheritedTTMLStyle(pNode, styles);
        const blockStyle = Object.assign({}, region && region.style ? region.style : {}, contentStyle);
        applyTTMLResourceStyle(blockStyle, embeddedImages, options.resourceResolver);
        const spans = parseTTMLSpans(pNode, styles, inheritedInlineTTMLStyle(blockStyle), regions);
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
                xmlId: getXMLId(pNode) || '',
                groupKey: ttmlPresentationGroupKey(pNode, presentationGroups, () => nextPresentationGroupId++),
                region: region,
                style: blockStyle,
                contentStyle: contentStyle,
                spans: spans,
                _logicalNodes: collectTTMLBlockLogicalNodes(pNode)
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

    resolveTTMLRubyAssociations(rawCues);

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

    if (rawCues.length === 0) {
        return {
            kind: 'presentation',
            cues: [],
            continuations: offsetTTMLContinuations(rawContinuations, startOffset)
        };
    }

    const cues = groupRawTTMLCues(rawCues).map((raw) => {
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
            hasMarquee: raw.blocks.some((block) => blockTreeHasMarquee(block)),
            audios: offsetTTMLAudios(raw.audios, startOffset, start, end),
            blocks: raw.blocks
        };
    });
    return {
        kind: 'presentation',
        cues: cues,
        continuations: offsetTTMLContinuations(rawContinuations, startOffset)
    };
}

function isEmptyTTMLDocument(tt) {
    if (!tt || !tt.childNodes) {
        return false;
    }
    for (let i = 0; i < tt.childNodes.length; i++) {
        const child = tt.childNodes[i];
        if (child.nodeType === Node.ELEMENT_NODE) {
            return false;
        }
        if ((child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) &&
            String(child.nodeValue || '').trim() !== '') {
            return false;
        }
    }
    return true;
}

function offsetTTMLContinuations(continuations, offset) {
    return continuations.map((continuation) => ({
        id: continuation.id,
        end: continuation.rawEnd === null || continuation.rawEnd === Infinity ?
            continuation.rawEnd : continuation.rawEnd + offset,
        dur: continuation.rawDur
    }));
}

function ttmlPresentationGroupKey(node, groups, nextId) {
    let current = node ? node.parentNode : null;
    while (current && current.nodeType === Node.ELEMENT_NODE && localName(current) !== 'body') {
        if (localName(current) === 'div') {
            break;
        }
        current = current.parentNode;
    }
    const groupNode = current || (node ? node.parentNode : null);
    if (!groupNode) {
        return 'group:default';
    }
    if (!groups.has(groupNode)) {
        const xmlId = getXMLId(groupNode);
        groups.set(groupNode, xmlId ? 'group:id:' + xmlId : 'group:' + nextId());
    }
    return groups.get(groupNode);
}

function parseTTMLSpans(pNode, styles, inheritedStyle, regions) {
    const spans = [];
    appendTTMLInlineSpans(
        pNode,
        styles,
        inheritedStyle,
        spans,
        regions || {},
        null,
        hasARIBTTMLRubyAncestor(pNode)
    );
    return spans;
}

function inheritedInlineTTMLStyle(style) {
    const result = Object.assign({}, style || {});
    [
        'animation',
        'backgroundColor',
        'backgroundImage',
        'backgroundImageUrl',
        'border',
        'borderTop',
        'borderBottom',
        'borderLeft',
        'borderRight',
        'displayAlign',
        'extent',
        'marquee',
        'opacity',
        'origin'
    ].forEach((name) => delete result[name]);
    return result;
}

function appendTTMLInlineSpans(parentNode, styles, inheritedStyle, spans, regions, regionContext, inheritedRuby) {
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
                    style: Object.assign({}, inheritedStyle),
                    region: regionContext && regionContext.region,
                    regionStyle: regionContext && regionContext.style,
                    regionGroupId: regionContext && regionContext.groupId,
                    isRuby: !!inheritedRuby
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
                style: Object.assign({}, inheritedStyle),
                region: regionContext && regionContext.region,
                regionStyle: regionContext && regionContext.style,
                regionGroupId: regionContext && regionContext.groupId,
                isRuby: !!inheritedRuby
            });
            continue;
        }
        if (name !== 'span') {
            appendTTMLInlineSpans(
                child,
                styles,
                inheritedStyle,
                spans,
                regions,
                regionContext,
                inheritedRuby || !!getARIBTTMLAttr(child, 'ruby')
            );
            continue;
        }

        const regionId = getTTMLAttr(child, 'region');
        const explicitRegion = regionId && regions[regionId] ? regions[regionId] : null;
        const region = explicitRegion || (regionContext && regionContext.region);
        const nextRegionContext = explicitRegion ? {
            region: explicitRegion,
            style: explicitRegion.style || {},
            groupId: 'region:' + regionId
        } : regionContext;
        const regionStyle = region && region.style ?
            Object.assign({}, inheritedStyle, region.style) : inheritedStyle;
        const style = mergeTTMLStyleRefs(child, styles, regionStyle);
        const isRuby = inheritedRuby || !!getARIBTTMLAttr(child, 'ruby');
        const beforeLength = spans.length;
        appendTTMLInlineSpans(child, styles, style, spans, regions, nextRegionContext, isRuby);
        if (spans.length === beforeLength) {
            const text = normalizeTTMLText(child.textContent || '');
            if (text !== '') {
                spans.push({
                    text: text,
                    style: style,
                    region: region,
                    regionStyle: nextRegionContext && nextRegionContext.style,
                    regionGroupId: nextRegionContext && nextRegionContext.groupId,
                    isRuby: !!isRuby
                });
            }
        }

        const id = getXMLId(child);
        const rubyTargetId = getARIBTTMLAttr(child, 'ruby');
        for (let j = beforeLength; j < spans.length; j++) {
            if ((id || rubyTargetId) && (!spans[j]._logicalNodes || spans[j]._logicalNodes.indexOf(child) < 0)) {
                spans[j]._logicalNodes = spans[j]._logicalNodes || [];
                spans[j]._logicalNodes.push(child);
            }
            if (id && !spans[j].id) {
                spans[j].id = id;
            }
            if (rubyTargetId && !spans[j].rubyTargetId) {
                spans[j].rubyTargetId = rubyTargetId;
            }
        }
    }
}

function hasARIBTTMLRubyAncestor(node) {
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE && localName(current) !== 'body') {
        if (getARIBTTMLAttr(current, 'ruby')) {
            return true;
        }
        current = current.parentNode;
    }
    return false;
}

function collectTTMLBlockLogicalNodes(pNode) {
    const nodes = [];
    let current = pNode;
    while (current && current.nodeType === Node.ELEMENT_NODE && localName(current) !== 'body') {
        const name = localName(current);
        if ((name === 'p' || name === 'div') &&
            (getXMLId(current) || getARIBTTMLAttr(current, 'ruby'))) {
            nodes.push(current);
        }
        current = current.parentNode;
    }
    return nodes;
}

function resolveTTMLRubyAssociations(rawCues) {
    const representations = new Map();
    const addRepresentation = (node, type, value) => {
        let representation = representations.get(node);
        if (!representation) {
            representation = {node: node, spans: [], blocks: []};
            representations.set(node, representation);
        }
        const values = type === 'span' ? representation.spans : representation.blocks;
        if (values.indexOf(value) < 0) {
            values.push(value);
        }
    };

    rawCues.forEach((cue) => {
        const block = cue.block;
        if (!block) {
            return;
        }
        (block._logicalNodes || []).forEach((node) => addRepresentation(node, 'block', block));
        block.spans.forEach((span) => {
            (span._logicalNodes || []).forEach((node) => addRepresentation(node, 'span', span));
        });
    });

    const ordered = Array.from(representations.values()).sort((left, right) => {
        if (left.node === right.node || !left.node.compareDocumentPosition) {
            return 0;
        }
        return left.node.compareDocumentPosition(right.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    const targets = new Map();
    ordered.forEach((representation) => {
        const id = getXMLId(representation.node);
        if (id && !targets.has(id)) {
            targets.set(id, representation);
        }
    });

    ordered.forEach((annotation) => {
        const targetId = getARIBTTMLAttr(annotation.node, 'ruby');
        if (!targetId) {
            return;
        }
        const annotationValues = annotation.spans.concat(annotation.blocks);
        annotationValues.forEach((value) => {
            value.rubyTargetId = value.rubyTargetId || targetId;
            value.rubyTargetIds = value.rubyTargetIds || [];
            if (value.rubyTargetIds.indexOf(targetId) < 0) {
                value.rubyTargetIds.push(targetId);
            }
        });
        const target = targets.get(targetId);
        if (!target || target.node === annotation.node) {
            return;
        }
        const metadata = {
            id: getXMLId(annotation.node) || '',
            targetId: targetId,
            element: localName(annotation.node),
            text: rubyRepresentationText(annotation)
        };
        const targetValue = target.spans[0] || target.blocks[0];
        targetValue.rubyAnnotations = targetValue.rubyAnnotations || [];
        targetValue.rubyAnnotations.push(metadata);
        annotationValues.forEach((value) => {
            value.rubyResolved = true;
        });
    });

    rawCues.forEach((cue) => {
        if (!cue.block) {
            return;
        }
        delete cue.block._logicalNodes;
        cue.block.spans.forEach((span) => delete span._logicalNodes);
    });
}

function rubyRepresentationText(representation) {
    if (representation.spans.length > 0) {
        return representation.spans.map((span) => span.text).join('');
    }
    return representation.blocks.map((block) => block.spans.map((span) => span.text).join('')).join('\n');
}

function collectTTMLStyles(doc) {
    const styles = {};
    descendantsByLocalName(doc.documentElement, 'style').forEach((styleNode) => {
        const id = getXMLId(styleNode);
        if (id) {
            styles[id] = mergeTTMLStyleRefs(styleNode, styles, {});
        }
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
            origin: parseTTMLLengthPair(getTTMLAttr(regionNode, 'origin') || style.origin, plane),
            extent: parseTTMLLengthPair(getTTMLAttr(regionNode, 'extent') || style.extent, plane),
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
        'fontSize', 'lineHeight', 'fontWeight', 'fontStyle', 'fontFamily',
        'color', 'backgroundColor', 'displayAlign', 'textAlign',
        'textDecoration', 'textShadow', 'backgroundImage', 'writingMode',
        'direction', 'extent', 'opacity', 'origin', 'textOutline'
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
