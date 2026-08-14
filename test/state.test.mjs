import assert from 'node:assert/strict';
import {B62RendererStateMachine, B62StateKeys} from '../src/utils/state.js';

function cue(key, start, end, clear = false) {
    return {key, start, end, clear, plane: [3840, 2160], blocks: []};
}

const lifecycle = new B62RendererStateMachine();
assert.equal(lifecycle.lifecycle, 'ready');
assert.equal(lifecycle.media, 'detached');
lifecycle.attachMedia(true);
assert.equal(lifecycle.media, 'paused');
assert.equal(lifecycle.canRunClock(), false);
lifecycle.play();
assert.equal(lifecycle.canRunClock(), true);
lifecycle.pause();
assert.equal(lifecycle.canRunClock(), false);
lifecycle.detachMedia();
assert.equal(lifecycle.media, 'detached');

const state = new B62RendererStateMachine();
const captionTrack = {packetId: 62256, mpuSequenceNumber: 10, trackKind: 'caption'};
const superimposeTrack = {packetId: 62264, mpuSequenceNumber: 20, trackKind: 'superimpose'};

state.commitPresentation(state.beginPush(captionTrack), [cue('old', 0, 10)]);
state.commitPresentation(state.beginPush(captionTrack), [cue('future', 2, 4)]);
state.commitPresentation(state.beginPush(superimposeTrack), [cue('superimpose', 0, 10)]);

assert.deepEqual(state.activeCues(1).map((item) => item.key), [
    'old:event:1:0',
    'superimpose:event:3:0'
]);
assert.deepEqual(state.activeCues(3).map((item) => item.key), [
    'future:event:2:0',
    'superimpose:event:3:0'
]);
// The newer presentation remains the state barrier after its own cue ends.
assert.deepEqual(state.activeCues(5).map((item) => item.key), [
    'superimpose:event:3:0'
]);
assert.equal(state.activeCues(3)[0].trackKind, 'caption');
assert.equal(state.activeCues(3)[1].trackKind, 'superimpose');

assert.equal(B62StateKeys.trackKind({trackKind: 'superimpose'}), 'superimpose');
assert.equal(B62StateKeys.trackKind({subtitleType: 1}), 'superimpose');
assert.equal(B62StateKeys.trackKind({componentTag: 0x38}), 'superimpose');
assert.equal(B62StateKeys.trackKind({componentTag: 0x30}), 'caption');

const trackClearState = new B62RendererStateMachine();
trackClearState.commitPresentation(trackClearState.beginPush(captionTrack), [cue('caption', 0, 10)]);
trackClearState.commitPresentation(trackClearState.beginPush({
    ...superimposeTrack,
    trackKind: 'superimpose'
}), [cue('superimpose', 0, 10)]);
trackClearState.clearTrack(captionTrack.packetId);
assert.deepEqual(trackClearState.activeCues(1).map((item) => item.key), ['superimpose:event:2:0']);

const clearState = new B62RendererStateMachine();
clearState.commitPresentation(clearState.beginPush(captionTrack), [cue('indefinite', 0, Infinity)]);
clearState.commitPresentation(clearState.beginPush({...captionTrack, mpuSequenceNumber: 11}), [cue('clear', 5, 5.05, true)]);
assert.equal(clearState.activeCues(5.02)[0].clear, true);
assert.deepEqual(clearState.activeCues(6), []);

const continuationState = new B62RendererStateMachine();
continuationState.commitPresentation(
    continuationState.beginPush({packetId: 1, mpuSequenceNumber: 1}),
    [Object.assign(cue('continued-source', 10, Infinity), {
        blocks: [{xmlId: 'p4', spans: [{text: 'old content'}]}]
    })]
);
const continuationTransaction = continuationState.beginPush({packetId: 1, mpuSequenceNumber: 2});
const continued = continuationState.resolveContinuations(continuationTransaction, [{id: 'p4', end: 50, dur: null}]);
assert.equal(continued.length, 1);
assert.equal(continued[0].end, 50);
assert.equal(continued[0].blocks[0].spans[0].text, 'old content');
assert.equal(continued[0].resourceScopeKey, 'packet:1:mpu:1');
continuationState.commitPresentation(continuationTransaction, continued);
assert.equal(continuationState.activeCues(20)[0].blocks[0].spans[0].text, 'old content');
assert.deepEqual(Array.from(continuationState.referencedResourceScopes()), ['packet:1:mpu:1']);
assert.deepEqual(continuationState.activeCues(51), []);

const durationContinuationState = new B62RendererStateMachine();
durationContinuationState.commitPresentation(
    durationContinuationState.beginPush({packetId: 2, mpuSequenceNumber: 1}),
    [Object.assign(cue('duration-source', 12, Infinity), {blocks: [{xmlId: 'duration'}]})]
);
const durationTransaction = durationContinuationState.beginPush({packetId: 2, mpuSequenceNumber: 2});
const durationContinued = durationContinuationState.resolveContinuations(
    durationTransaction,
    [{id: 'duration', end: Infinity, dur: 8}]
);
assert.equal(durationContinued[0].end, 20);

const replacementState = new B62RendererStateMachine();
replacementState.commitPresentation(replacementState.beginPush(captionTrack), [cue('partial', 1, 5)]);
replacementState.commitPresentation(replacementState.beginPush(captionTrack), [cue('complete', 1, 5)]);
assert.deepEqual(replacementState.activeCues(2).map((item) => item.key), ['complete:event:2:0']);

const epochState = new B62RendererStateMachine();
const firstEpochKey = epochState.timelineOffsetKey({packetId: 1, videoRawDtsBase: 1000, videoDtsBase: 0});
const secondEpochKey = epochState.timelineOffsetKey({packetId: 1, videoRawDtsBase: 2000, videoDtsBase: 0});
assert.notEqual(firstEpochKey, secondEpochKey);
epochState.setTimelineOffset(firstEpochKey, 1.25);
assert.equal(epochState.getTimelineOffset(firstEpochKey), 1.25);
assert.equal(epochState.getTimelineOffset(secondEpochKey), null);
epochState.commitPresentation(
    epochState.beginPush({packetId: 1, videoRawDtsBase: 1000, videoDtsBase: 0}),
    [cue('old-epoch', 0.5, 10)]
);
epochState.commitPresentation(
    epochState.beginPush({packetId: 1, videoRawDtsBase: 2000, videoDtsBase: 0}),
    [cue('new-epoch', 0, 2)]
);
assert.deepEqual(epochState.activeCues(1).map((item) => item.key), ['new-epoch:event:2:0']);

const abortedEpochState = new B62RendererStateMachine();
abortedEpochState.commitPresentation(
    abortedEpochState.beginPush({packetId: 3, videoRawDtsBase: 1000, videoDtsBase: 0}),
    [cue('valid-epoch', 0, 10)]
);
abortedEpochState.beginPush({packetId: 3, videoRawDtsBase: 2000, videoDtsBase: 0});
assert.deepEqual(abortedEpochState.activeCues(1).map((item) => item.key), ['valid-epoch:event:1:0']);

const resourceState = new B62RendererStateMachine();
resourceState.commitPresentation(resourceState.beginPush({packetId: 1, mpuSequenceNumber: 1}), [cue('one', 0, 4)]);
resourceState.commitPresentation(resourceState.beginPush({packetId: 1, mpuSequenceNumber: 2}), [cue('two', 5, 9)]);
assert.deepEqual(Array.from(resourceState.referencedResourceScopes()), [
    'packet:1:mpu:1',
    'packet:1:mpu:2'
]);
resourceState.prune(100);
assert.deepEqual(Array.from(resourceState.referencedResourceScopes()), []);

lifecycle.destroy();
assert.equal(lifecycle.lifecycle, 'destroyed');
assert.equal(lifecycle.canRunClock(), false);
assert.equal(lifecycle.beginPush(captionTrack), null);

console.log('renderer state machine transitions: ok');
