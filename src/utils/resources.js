/*
 * External B62 resource and ARIB-TTML media helpers.
 */

import {
    childElementsByLocalName,
    descendantsByLocalName,
    getARIBTTMLAttr,
    getTTMLAttr,
    getXMLId
} from './dom.js';

export function collectTTMLEmbeddedImages(doc) {
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

export function collectTTMLFontFaces(doc, resourceResolver) {
    const fontFaces = [];
    descendantsByLocalName(doc.documentElement, 'font-face').forEach((fontFaceNode) => {
        const family = getTTMLAttr(fontFaceNode, 'font-family') || getTTMLAttr(fontFaceNode, 'fontFamily');
        if (!family) {
            return;
        }
        const sourceNodes = childElementsByLocalName(fontFaceNode, 'src');
        sourceNodes.forEach((sourceNode) => {
            const url = getTTMLAttr(sourceNode, 'url');
            const src = normalizeResourceReference(url);
            const resolvedUrl = resolveTTMLResourceReference(url, {}, resourceResolver);
            if (!resolvedUrl) {
                return;
            }
            const format = getTTMLAttr(sourceNode, 'format');
            const resource = resourceResolver && resourceResolver.resource ? resourceResolver.resource(src) : null;
            fontFaces.push({
                family: stripQuotes(family),
                src: src,
                resourceIndex: resourceIndexFromSubtUrl(src),
                url: resolvedUrl,
                format: format,
                unicodeRange: getTTMLAttr(fontFaceNode, 'unicode-range') || getTTMLAttr(fontFaceNode, 'unicodeRange'),
                svgGlyphs: collectSVGFontGlyphs(resource, format)
            });
        });
    });
    return fontFaces;
}

export function collectTTMLKeyframes(doc) {
    const keyframes = [];
    descendantsByLocalName(doc.documentElement, 'keyframes').forEach((keyframesNode) => {
        const name = getARIBTTMLAttr(keyframesNode, 'animationName') || getTTMLAttr(keyframesNode, 'animationName');
        if (!name) {
            return;
        }
        const frames = childElementsByLocalName(keyframesNode, 'keyframe').map((keyframeNode) => {
            return {
                position: getTTMLAttr(keyframeNode, 'position') || '0%',
                style: {
                    backgroundColor: getTTMLAttr(keyframeNode, 'backgroundColor'),
                    color: getTTMLAttr(keyframeNode, 'color'),
                    fontSize: getTTMLAttr(keyframeNode, 'fontSize'),
                    extent: getTTMLAttr(keyframeNode, 'extent'),
                    opacity: getTTMLAttr(keyframeNode, 'opacity'),
                    origin: getTTMLAttr(keyframeNode, 'origin')
                }
            };
        }).filter((frame) => /^(?:100|[0-9]{1,2})(?:\.[0-9]+)?%$/.test(frame.position));
        if (frames.length > 0) {
            keyframes.push({ name: name, frames: frames });
        }
    });
    return keyframes;
}

export function collectTTMLAudios(pNode, rawStart, rawEnd, rawDur, resourceResolver) {
    const audios = [];
    descendantsByLocalName(pNode, 'audio').forEach((audioNode) => {
        const audio = collectTTMLAudioNode(audioNode, rawStart, rawEnd, rawDur, resourceResolver);
        if (audio) {
            audios.push(audio);
        }
    });
    return audios;
}

export function collectTTMLAudioNode(audioNode, rawStart, rawEnd, rawDur, resourceResolver) {
    const src = getARIBTTMLAttr(audioNode, 'src') || getTTMLAttr(audioNode, 'src');
    if (!src) {
        return null;
    }
    return {
        id: getXMLId(audioNode) || '',
        src: normalizeResourceReference(src),
        resolvedSrc: resolveTTMLResourceReference(src, {}, resourceResolver),
        loop: parseBooleanAttr(getARIBTTMLAttr(audioNode, 'loop') || getTTMLAttr(audioNode, 'loop')),
        begin: rawStart,
        end: rawEnd,
        dur: rawDur
    };
}

export function offsetTTMLAudios(audios, offset, fallbackStart, fallbackEnd) {
    if (!audios || audios.length === 0) {
        return [];
    }
    return audios.map((audio) => {
        return Object.assign({}, audio, {
            begin: audio.begin === null ? fallbackStart : offsetTime(audio.begin, offset),
            end: audio.end === null ? fallbackEnd : offsetTime(audio.end, offset)
        });
    });
}

export function offsetTime(value, offset) {
    return value === Infinity ? Infinity : value + offset;
}

export function applyTTMLResourceStyle(style, embeddedImages, resourceResolver) {
    if (!style || !style.backgroundImage) {
        return;
    }
    const resolvedUrl = resolveTTMLResourceReference(style.backgroundImage, embeddedImages, resourceResolver);
    if (resolvedUrl) {
        style.backgroundImageUrl = resolvedUrl;
    }
}

export function resolveTTMLResourceReference(value, embeddedImages, resourceResolver) {
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

export function normalizeB62Resources(data) {
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

export function appendB62ResourceList(resources, list) {
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

export function appendB62ResourceMap(resources, map) {
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

export function normalizeB62Resource(item) {
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

export function mimeFromB62Resource(resource) {
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

export function stringMimeType(value) {
    return typeof value === 'string' && value.indexOf('/') >= 0 ? value : '';
}

export function toUint8Array(data) {
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

export function blockTreeHasMarquee(block) {
    if (block && block.style && block.style.marquee) {
        return true;
    }
    return !!(block && block.spans && block.spans.some((span) => span.style && span.style.marquee));
}

export function firstFiniteNumber() {
    for (let i = 0; i < arguments.length; i++) {
        const value = Number(arguments[i]);
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return NaN;
}

export function normalizeResourceReference(value) {
    let text = String(value || '').trim().replace(/\uFF03/g, '#');
    const url = text.match(/^url\((.*)\)$/);
    if (url) {
        text = url[1].trim();
    }
    return stripQuotes(text);
}

function resourceIndexFromSubtUrl(value) {
    const match = String(value || '').match(/^subt:\/\/(\d+)$/);
    return match ? Number(match[1]) : null;
}

function collectSVGFontGlyphs(resource, format) {
    if (!resource || !resource.data) {
        return null;
    }
    const mimeType = String(resource.mimeType || '').toLowerCase();
    const normalizedFormat = String(format || '').toLowerCase();
    if (normalizedFormat !== 'svg' && mimeType !== 'image/svg+xml') {
        return null;
    }
    if (typeof TextDecoder === 'undefined' || typeof DOMParser === 'undefined') {
        return null;
    }

    try {
        const text = new TextDecoder('utf-8').decode(resource.data);
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        if (!doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
            return null;
        }
        const fontNode = descendantsByLocalName(doc.documentElement, 'font')[0];
        if (!fontNode) {
            return null;
        }
        const fontFaceNode = descendantsByLocalName(fontNode, 'font-face')[0];
        const unitsPerEm = parseNumericAttr(fontFaceNode, 'units-per-em', 360);
        const ascent = parseNumericAttr(fontFaceNode, 'ascent', unitsPerEm);
        const descent = parseNumericAttr(fontFaceNode, 'descent', 0);
        const fontAdvance = parseNumericAttr(fontNode, 'horiz-adv-x', unitsPerEm);
        const glyphs = {};

        descendantsByLocalName(fontNode, 'glyph').forEach((glyphNode) => {
            const unicode = glyphNode.getAttribute('unicode');
            const path = glyphNode.getAttribute('d');
            if (!unicode || !path) {
                return;
            }
            const char = Array.from(unicode)[0];
            if (!char) {
                return;
            }
            glyphs[char.codePointAt(0)] = {
                path: path,
                horizAdvX: parseNumericAttr(glyphNode, 'horiz-adv-x', fontAdvance),
                unitsPerEm: unitsPerEm,
                ascent: ascent,
                descent: descent
            };
        });

        return Object.keys(glyphs).length > 0 ? glyphs : null;
    } catch (e) {
        return null;
    }
}

function parseNumericAttr(node, name, fallback) {
    if (!node) {
        return fallback;
    }
    const value = Number(node.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
}

export function imageTypeToMime(type) {
    switch (String(type || '').toLowerCase()) {
        case 'svg':
        case 'svg+xml':
            return 'image/svg+xml';
        case 'png':
        default:
            return 'image/png';
    }
}

export function formatToMime(format) {
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

export function stripQuotes(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

export function parseBooleanAttr(value) {
    return value === true || String(value || '').toLowerCase() === 'true' || value === '1';
}
