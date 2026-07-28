function timingKey(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (value === Infinity) {
        return 'infinity';
    }
    return String(value);
}

export function groupRawTTMLCues(rawCues) {
    const groups = [];
    const groupsByTiming = new Map();

    rawCues.forEach((cue) => {
        const key = timingKey(cue.rawStart) + ':' + timingKey(cue.rawEnd);
        let group = groupsByTiming.get(key);
        if (!group) {
            group = {
                index: cue.index,
                rawStart: cue.rawStart,
                rawEnd: cue.rawEnd,
                blocks: [],
                audios: []
            };
            groupsByTiming.set(key, group);
            groups.push(group);
        }
        if (cue.block) {
            group.blocks.push(cue.block);
        }
        if (cue.audios && cue.audios.length > 0) {
            group.audios.push(...cue.audios);
        }
    });

    return groups;
}

export function selectActiveTTMLCues(cues, currentTime) {
    const active = cues.filter((cue) => cue.start <= currentTime && currentTime < cue.end);
    const latestEventByTrack = new Map();

    active.forEach((cue) => {
        const trackKey = cue.trackKey || 'default';
        const eventId = Number.isFinite(cue.eventId) ? cue.eventId : 0;
        const latest = latestEventByTrack.get(trackKey);
        if (latest === undefined || eventId > latest) {
            latestEventByTrack.set(trackKey, eventId);
        }
    });

    return active.filter((cue) => {
        const trackKey = cue.trackKey || 'default';
        const eventId = Number.isFinite(cue.eventId) ? cue.eventId : 0;
        return eventId === latestEventByTrack.get(trackKey);
    });
}

export function uniformSpanStyleValue(spans, property, normalize) {
    if (!spans || spans.length === 0) {
        return '';
    }
    const normalizeValue = typeof normalize === 'function' ? normalize : (value) => value;
    const firstValue = spans[0].style && spans[0].style[property] ?
        normalizeValue(spans[0].style[property]) : '';
    if (!firstValue) {
        return '';
    }
    const uniform = spans.every((span) => {
        const value = span.style && span.style[property] ? normalizeValue(span.style[property]) : '';
        return value === firstValue;
    });
    return uniform ? firstValue : '';
}

export function closeSmallVerticalGaps(rects, tolerance) {
    const limit = Number.isFinite(tolerance) ? tolerance : 1;
    const result = rects.map((rect) => Object.assign({}, rect));
    result.sort((a, b) => a.top - b.top || a.left - b.left);
    for (let i = 0; i + 1 < result.length; i++) {
        const current = result[i];
        const next = result[i + 1];
        const horizontalOverlap = Math.min(current.right, next.right) - Math.max(current.left, next.left);
        const gap = next.top - current.bottom;
        if (horizontalOverlap > 0 && gap > 0 && gap <= limit) {
            current.bottom = next.top;
        }
    }
    return result;
}
