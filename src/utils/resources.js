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
