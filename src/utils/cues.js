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

export function groupNearbyRects(rects, tolerance) {
    const limit = Number.isFinite(tolerance) ? tolerance : 1;
    const rows = rects.map((rect) => Object.assign({}, rect))
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .reduce((result, rect) => {
            const row = result[result.length - 1];
            if (row &&
                Math.abs(row.top - rect.top) <= limit &&
                Math.abs(row.bottom - rect.bottom) <= limit &&
                rect.left <= row.right + limit) {
                row.left = Math.min(row.left, rect.left);
                row.right = Math.max(row.right, rect.right);
                row.top = Math.min(row.top, rect.top);
                row.bottom = Math.max(row.bottom, rect.bottom);
            } else {
                result.push(rect);
            }
            return result;
        }, []);
    const groups = [];

    rows.forEach((rect) => {
        const touchingGroups = groups.filter((group) => group.some((other) => {
            const horizontalGap = Math.max(rect.left, other.left) - Math.min(rect.right, other.right);
            const verticalGap = Math.max(rect.top, other.top) - Math.min(rect.bottom, other.bottom);
            return horizontalGap <= limit && verticalGap <= limit;
        }));
        if (touchingGroups.length === 0) {
            groups.push([rect]);
            return;
        }
        const target = touchingGroups[0];
        target.push(rect);
        touchingGroups.slice(1).forEach((group) => {
            target.push(...group);
            groups.splice(groups.indexOf(group), 1);
        });
    });

    return groups.map((group) => group.sort((a, b) => a.top - b.top || a.left - b.left));
}

export function connectedRectPath(rects, tolerance) {
    if (!rects || rects.length === 0) {
        return '';
    }
    const limit = Number.isFinite(tolerance) ? tolerance : 1;
    const rows = rects.map((rect) => Object.assign({}, rect))
        .sort((a, b) => a.top - b.top || a.left - b.left);

    for (let i = 0; i + 1 < rows.length; i++) {
        const current = rows[i];
        const next = rows[i + 1];
        if (Math.abs(next.top - current.bottom) <= limit) {
            const boundary = (next.top + current.bottom) / 2;
            current.bottom = boundary;
            next.top = boundary;
        }
    }

    const first = rows[0];
    const commands = ['M', first.left, first.top, 'H', first.right];
    rows.forEach((row, index) => {
        commands.push('V', row.bottom);
        if (index + 1 < rows.length) {
            commands.push('H', rows[index + 1].right);
        }
    });
    const last = rows[rows.length - 1];
    commands.push('H', last.left);
    for (let i = rows.length - 1; i >= 0; i--) {
        commands.push('V', rows[i].top);
        if (i > 0) {
            commands.push('H', rows[i - 1].left);
        }
    }
    commands.push('Z');
    return commands.join(' ');
}

export function subtitleMediaTimeSeconds(data) {
    if (!data) {
        return null;
    }
    const timelineFields = ['pts', 'dts', 'videoMediaDts', 'videoMediaPts', 'rawPts', 'rawDts'];
    for (let i = 0; i < timelineFields.length; i++) {
        const value = data[timelineFields[i]];
        if (Number.isFinite(value)) {
            return value / 1000;
        }
    }
    return null;
}
