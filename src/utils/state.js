import {selectActiveTTMLCues} from './cues.js';

function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

function trackKey(data) {
    return data && data.packetId !== undefined ? 'packet:' + data.packetId : 'default';
}

function resourceScopeKey(data) {
    if (!data) {
        return 'default';
    }
    const packet = data.packetId !== undefined ? data.packetId : 'default';
    const mpu = data.mpuSequenceNumber !== undefined ? data.mpuSequenceNumber : 'default';
    return 'packet:' + packet + ':mpu:' + mpu;
}

function timelineEpochKey(data) {
    if (!data) {
        return 'default';
    }
    const parts = [trackKey(data)];
    if (Number.isFinite(data.videoRawDtsBase)) {
        parts.push('raw-base:' + data.videoRawDtsBase);
    }
    if (Number.isFinite(data.videoDtsBase)) {
        parts.push('media-base:' + data.videoDtsBase);
    }
    return parts.join(':');
}

/**
 * Owns renderer lifecycle and presentation transitions.
 *
 * A pushed TTML document is a presentation, not just a bag of independent
 * cues. Once a newer presentation becomes effective on a track, an older one
 * must not become visible again merely because the newer presentation has no
 * active cue at the current time.
 */
export class B62RendererStateMachine {
    constructor(options) {
        options = options || {};
        this._maxCues = Number.isFinite(options.maxCues) ? options.maxCues : 300;
        this._lifecycle = 'ready';
        this._media = 'detached';
        this._eventCount = 0;
        this._presentations = [];
        this._timelineOffsets = new Map();
        this._trackEpochs = new Map();
    }

    get lifecycle() {
        return this._lifecycle;
    }

    get media() {
        return this._media;
    }

    get eventCount() {
        return this._eventCount;
    }

    attachMedia(paused) {
        if (this._lifecycle === 'destroyed') {
            return;
        }
        this._media = paused ? 'paused' : 'playing';
    }

    detachMedia() {
        if (this._lifecycle !== 'destroyed') {
            this._media = 'detached';
        }
    }

    play() {
        if (this._lifecycle !== 'destroyed' && this._media !== 'detached') {
            this._media = 'playing';
        }
    }

    pause() {
        if (this._lifecycle !== 'destroyed' && this._media !== 'detached') {
            this._media = 'paused';
        }
    }

    canRunClock() {
        return this._lifecycle === 'ready' && this._media === 'playing';
    }

    beginPush(data) {
        if (this._lifecycle === 'destroyed') {
            return null;
        }
        this._eventCount++;
        const nextTrackKey = trackKey(data);
        const nextEpochKey = timelineEpochKey(data);
        return {
            eventId: this._eventCount,
            trackKey: nextTrackKey,
            resourceScopeKey: resourceScopeKey(data),
            timelineEpochKey: nextEpochKey,
            hasExplicitTimelineEpoch: hasExplicitTimelineEpoch(data)
        };
    }

    commitPresentation(transaction, cues) {
        if (!transaction || this._lifecycle === 'destroyed' || !cues || cues.length === 0) {
            return;
        }
        this._applyTimelineEpoch(transaction);
        let start = null;
        cues.forEach((cue) => {
            if (Number.isFinite(cue.start) && (start === null || cue.start < start)) {
                start = cue.start;
            }
        });
        if (start === null) {
            return;
        }

        const annotatedCues = cues.map((cue, index) => Object.assign({}, cue, {
            key: cue.key + ':event:' + transaction.eventId + ':' + index,
            trackKey: transaction.trackKey,
            eventId: transaction.eventId,
            eventStart: start,
            resourceScopeKey: cue.resourceScopeKey || transaction.resourceScopeKey
        }));
        const resourceScopeKeys = Array.from(new Set(annotatedCues
            .map((cue) => cue.resourceScopeKey)
            .filter(Boolean)));

        // A partial and then complete delivery of one MPU commonly produces the
        // same presentation start. Only the latest delivery is authoritative.
        this._presentations = this._presentations.filter((presentation) =>
            presentation.trackKey !== transaction.trackKey || presentation.start !== start
        );
        this._presentations.push({
            eventId: transaction.eventId,
            trackKey: transaction.trackKey,
            resourceScopeKey: transaction.resourceScopeKey,
            resourceScopeKeys: resourceScopeKeys,
            start: start,
            cues: annotatedCues
        });
        this._sortPresentations();
        this._enforceCueLimit();
    }

    resolveContinuations(transaction, continuations) {
        if (!transaction || !continuations || continuations.length === 0) {
            return [];
        }
        const previousEpochKey = this._trackEpochs.get(transaction.trackKey);
        if (transaction.hasExplicitTimelineEpoch &&
            previousEpochKey && previousEpochKey !== transaction.timelineEpochKey) {
            return [];
        }
        const source = this._latestPresentationForTrack(transaction.trackKey);
        if (!source) {
            return [];
        }

        const resolved = [];
        const resolvedIds = new Set();
        continuations.forEach((continuation) => {
            if (!continuation || !continuation.id || resolvedIds.has(continuation.id)) {
                return;
            }
            for (let i = 0; i < source.cues.length; i++) {
                const cue = source.cues[i];
                if (cue.end !== Infinity || !cue.blocks || cue.blocks.length === 0) {
                    continue;
                }
                const blocks = cue.blocks.filter((block) => block && block.xmlId === continuation.id);
                if (blocks.length === 0) {
                    continue;
                }

                let end = continuation.end;
                if (Number.isFinite(continuation.dur) && !Number.isFinite(end)) {
                    end = cue.start + continuation.dur;
                } else if (end === null || end === undefined) {
                    end = Infinity;
                }
                if (Number.isFinite(end) && end <= cue.start) {
                    end = cue.start + 0.05;
                }

                resolved.push(Object.assign({}, cue, {
                    key: 'continuation:' + continuation.id + ':' + cue.key,
                    end: end,
                    blocks: blocks,
                    audios: [],
                    continuationId: continuation.id
                }));
                resolvedIds.add(continuation.id);
                break;
            }
        });
        return resolved;
    }

    activeCues(currentTime) {
        const selectedByTrack = new Map();
        this._presentations.forEach((presentation) => {
            if (presentation.start > currentTime) {
                return;
            }
            const selected = selectedByTrack.get(presentation.trackKey);
            if (!selected ||
                presentation.start > selected.start ||
                (presentation.start === selected.start && presentation.eventId > selected.eventId)) {
                selectedByTrack.set(presentation.trackKey, presentation);
            }
        });

        const active = [];
        selectedByTrack.forEach((presentation) => {
            active.push(...selectActiveTTMLCues(presentation.cues, currentTime));
        });
        return active.sort((a, b) => a.start - b.start || a.eventId - b.eventId);
    }

    prune(currentTime) {
        const keepFrom = currentTime - 30;
        const byTrack = new Map();
        this._presentations.forEach((presentation) => {
            const list = byTrack.get(presentation.trackKey) || [];
            list.push(presentation);
            byTrack.set(presentation.trackKey, list);
        });

        const keep = new Set();
        byTrack.forEach((presentations) => {
            presentations.sort((a, b) => a.start - b.start || a.eventId - b.eventId);
            let predecessor = null;
            presentations.forEach((presentation) => {
                if (presentation.start < keepFrom) {
                    predecessor = presentation;
                } else {
                    keep.add(presentation);
                }
            });
            // Retain one state barrier before the seek window. It prevents a
            // cleared/expired presentation from exposing an even older one.
            if (predecessor) {
                if (predecessor.cues.every((cue) => cue.end < keepFrom)) {
                    predecessor.cues = [];
                    predecessor.resourceScopeKey = null;
                    predecessor.resourceScopeKeys = [];
                }
                keep.add(predecessor);
            }
        });
        this._presentations = this._presentations.filter((presentation) => keep.has(presentation));
        this._enforceCueLimit();
    }

    clearPresentations() {
        this._presentations = [];
    }

    reset() {
        if (this._lifecycle === 'destroyed') {
            return;
        }
        this._presentations = [];
        this._eventCount = 0;
        this._timelineOffsets.clear();
        this._trackEpochs.clear();
    }

    destroy() {
        this._presentations = [];
        this._timelineOffsets.clear();
        this._trackEpochs.clear();
        this._media = 'detached';
        this._lifecycle = 'destroyed';
    }

    timelineOffsetKey(data, prefix) {
        const base = timelineEpochKey(data);
        return prefix ? prefix + ':' + base : base;
    }

    getTimelineOffset(key) {
        return finiteOrNull(this._timelineOffsets.get(key));
    }

    setTimelineOffset(key, value) {
        if (Number.isFinite(value)) {
            this._timelineOffsets.set(key, value);
        }
    }

    referencedResourceScopes() {
        const referenced = new Set();
        this._presentations.forEach((presentation) => {
            const scopeKeys = presentation.resourceScopeKeys || [presentation.resourceScopeKey];
            scopeKeys.filter(Boolean).forEach((scopeKey) => referenced.add(scopeKey));
        });
        return referenced;
    }

    _latestPresentationForTrack(track) {
        let latest = null;
        this._presentations.forEach((presentation) => {
            if (presentation.trackKey === track && (!latest || presentation.eventId > latest.eventId)) {
                latest = presentation;
            }
        });
        return latest;
    }

    _applyTimelineEpoch(transaction) {
        if (!transaction.hasExplicitTimelineEpoch) {
            return;
        }
        const previousEpochKey = this._trackEpochs.get(transaction.trackKey);
        if (previousEpochKey && previousEpochKey !== transaction.timelineEpochKey) {
            this._presentations = this._presentations.filter((presentation) =>
                presentation.trackKey !== transaction.trackKey
            );
            this._clearTimelineOffsetsForTrack(transaction.trackKey);
        }
        this._trackEpochs.set(transaction.trackKey, transaction.timelineEpochKey);
    }

    _sortPresentations() {
        this._presentations.sort((a, b) => a.start - b.start || a.eventId - b.eventId);
    }

    _enforceCueLimit() {
        let cueCount = this._presentations.reduce((count, presentation) => count + presentation.cues.length, 0);
        while (cueCount > this._maxCues) {
            const removableIndex = this._presentations.findIndex((presentation) =>
                this._presentations.some((other) =>
                    other.trackKey === presentation.trackKey &&
                    (other.start > presentation.start ||
                        (other.start === presentation.start && other.eventId > presentation.eventId))
                )
            );
            if (removableIndex < 0) {
                break;
            }
            const removed = this._presentations.splice(removableIndex, 1)[0];
            cueCount -= removed.cues.length;
        }
    }

    _clearTimelineOffsetsForTrack(track) {
        Array.from(this._timelineOffsets.keys()).forEach((key) => {
            if (key === track ||
                key.startsWith(track + ':') ||
                key.includes(':' + track + ':') ||
                key.endsWith(':' + track)) {
                this._timelineOffsets.delete(key);
            }
        });
    }
}

export const B62StateKeys = {
    trackKey,
    resourceScopeKey,
    timelineEpochKey
};

function hasExplicitTimelineEpoch(data) {
    return !!data && (Number.isFinite(data.videoRawDtsBase) || Number.isFinite(data.videoDtsBase));
}
