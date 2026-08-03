import assert from 'node:assert/strict';
import {
    closeSmallVerticalGaps,
    connectedRectPath,
    groupNearbyRects,
    groupRawTTMLCues,
    selectActiveTTMLCues,
    subtitleMediaTimeSeconds,
    uniformSpanStyleValue
} from '../src/utils/cues.js';
import {normalizeTTMLText} from '../src/utils/text.js';

const firstBlock = {spans: [{text: 'first line'}]};
const secondBlock = {spans: [{text: 'second line'}]};
const laterBlock = {spans: [{text: 'later line'}]};
const grouped = groupRawTTMLCues([
    {index: 0, rawStart: null, rawEnd: null, block: firstBlock, audios: []},
    {index: 1, rawStart: null, rawEnd: null, block: secondBlock, audios: []},
    {index: 2, rawStart: 2, rawEnd: 4, block: laterBlock, audios: []}
]);

assert.equal(grouped.length, 2);
assert.deepEqual(grouped[0].blocks, [firstBlock, secondBlock]);
assert.deepEqual(grouped[1].blocks, [laterBlock]);

const active = selectActiveTTMLCues([
    {key: 'old-caption', start: 0, end: 10, trackKey: 'packet:62256', eventId: 1},
    {key: 'new-caption-a', start: 1, end: 10, trackKey: 'packet:62256', eventId: 2},
    {key: 'new-caption-b', start: 1, end: 10, trackKey: 'packet:62256', eventId: 2},
    {key: 'superimpose', start: 0, end: 10, trackKey: 'packet:62264', eventId: 1},
    {key: 'future', start: 20, end: 30, trackKey: 'packet:62256', eventId: 3}
], 5);

assert.deepEqual(active.map((cue) => cue.key), [
    'new-caption-a',
    'new-caption-b',
    'superimpose'
]);

assert.equal(uniformSpanStyleValue([
    {style: {backgroundColor: '#00000080'}},
    {style: {backgroundColor: '#00000080'}}
], 'backgroundColor'), '#00000080');
assert.equal(uniformSpanStyleValue([
    {style: {backgroundColor: '#00ff00ff'}},
    {style: {}},
    {style: {backgroundColor: '#000080ff'}}
], 'backgroundColor'), '');

assert.deepEqual(closeSmallVerticalGaps([
    {left: 10, top: 20, right: 200, bottom: 50.4},
    {left: 10, top: 51, right: 150, bottom: 80}
], 1), [
    {left: 10, top: 20, right: 200, bottom: 51},
    {left: 10, top: 51, right: 150, bottom: 80}
]);

const nearbyGroups = groupNearbyRects([
    {left: 80, top: 16, right: 310, bottom: 32},
    {left: 80, top: 32, right: 350, bottom: 48},
    {left: 10, top: 180, right: 100, bottom: 200}
], 1);
assert.equal(nearbyGroups.length, 2);
assert.deepEqual(nearbyGroups[0], [
    {left: 80, top: 16, right: 310, bottom: 32},
    {left: 80, top: 32, right: 350, bottom: 48}
]);
assert.equal(connectedRectPath(nearbyGroups[0], 1),
    'M 80 16 H 310 V 32 H 80 Z M 80 32 H 350 V 48 H 80 Z');

const branchingBackground = groupNearbyRects([
    {left: 10, top: 0, right: 20, bottom: 10},
    {left: 30, top: 0, right: 40, bottom: 10},
    {left: 5, top: 10, right: 45, bottom: 20}
], 1);
assert.equal(branchingBackground.length, 1);
assert.equal(connectedRectPath(branchingBackground[0], 1),
    'M 10 0 H 20 V 10 H 10 Z M 30 0 H 40 V 10 H 30 Z M 5 10 H 45 V 20 H 5 Z');

assert.equal(normalizeTTMLText('　西原村　御船町'), '　西原村　御船町');
assert.equal(normalizeTTMLText('  plain text  '), 'plain text');

assert.equal(subtitleMediaTimeSeconds({videoMediaDts: 5322}), 5.322);
assert.equal(subtitleMediaTimeSeconds({
    videoMediaDts: 5322,
    rawPts: 1785229133391
}), 5.322);
assert.equal(subtitleMediaTimeSeconds({pts: 4100, videoMediaDts: 5322}), 4.1);

console.log('cue grouping and concurrent-track selection: ok');
