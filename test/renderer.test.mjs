import assert from 'node:assert/strict';
import aribb62js, {B62DOMRenderer, B62TTMLRenderer, TTMLRenderer} from '../src/index.js';

assert.equal(TTMLRenderer, B62TTMLRenderer);
assert.equal(aribb62js.B62TTMLRenderer, B62TTMLRenderer);
assert.equal(aribb62js.B62DOMRenderer, B62DOMRenderer);
assert.equal(typeof B62TTMLRenderer.parse, 'function');
assert.equal(typeof B62TTMLRenderer.renderCueDOM, 'function');
assert.equal(typeof B62TTMLRenderer.previewCues, 'function');

const originalWindow = globalThis.window;
let nextFrameId = 0;
const requestedFrames = [];
const cancelledFrames = [];
globalThis.window = {
    requestAnimationFrame(callback) {
        const id = ++nextFrameId;
        requestedFrames.push({id, callback});
        return id;
    },
    cancelAnimationFrame(id) {
        cancelledFrames.push(id);
    },
    addEventListener() {},
    removeEventListener() {}
};

const listeners = new Map();
const media = {
    paused: true,
    ended: false,
    currentTime: 0,
    addEventListener(name, listener) {
        listeners.set(name, listener);
    },
    removeEventListener(name) {
        listeners.delete(name);
    }
};

const clockRenderer = new B62TTMLRenderer({mediaElement: media});
assert.equal(requestedFrames.length, 0);
listeners.get('play')();
assert.equal(requestedFrames.length, 1);
listeners.get('pause')();
assert.deepEqual(cancelledFrames, [1]);
clockRenderer.destroy();

if (originalWindow === undefined) {
    delete globalThis.window;
} else {
    globalThis.window = originalWindow;
}

const resourceRenderer = new B62TTMLRenderer();
const invalidUtf8Result = resourceRenderer.push({
    packetId: 99,
    data: new Uint8Array([0x3c, 0x74, 0x74, 0x3e, 0xc3, 0x28])
});
assert.equal(invalidUtf8Result.documentKind, 'invalid');
const resourceBytes = new Uint8Array([1, 2, 3]);
const firstResourceResult = resourceRenderer.push({
    packetId: 1,
    mpuSequenceNumber: 1,
    resources: [{index: 1, data: resourceBytes, mimeType: 'image/png'}]
});
assert.equal(firstResourceResult.basePts, null);
assert.equal(firstResourceResult.timelineOffset, null);
assert.equal(resourceRenderer._resourceScopes.size, 1);
const firstScope = resourceRenderer._resourceScopes.get('packet:1:mpu:1');
assert.equal(firstScope.objectUrls.length, 1);

resourceRenderer.push({
    packetId: 1,
    mpuSequenceNumber: 1,
    resources: [{index: 1, data: resourceBytes, mimeType: 'image/png'}]
});
assert.equal(firstScope.objectUrls.length, 1);

resourceRenderer.push({packetId: 1, mpuSequenceNumber: 2});
assert.deepEqual(Array.from(resourceRenderer._resourceScopes.keys()), ['packet:1:mpu:2']);
resourceRenderer.reset();
assert.equal(resourceRenderer._resourceScopes.size, 0);

let fontLoadCount = 0;
let resolveFontLoad;
let fontLayoutCount = 0;
const fontLoad = new Promise((resolve) => {
    resolveFontLoad = resolve;
});
const fontOverlay = {
    innerHTML: '',
    ownerDocument: {
        fonts: {
            load() {
                fontLoadCount++;
                return fontLoad;
            }
        }
    }
};
const fontContext = {
    overlayElement: fontOverlay,
    requestLayout() {
        fontLayoutCount++;
    },
    cues: [{
        fontFaces: [{family: 'ARIB External', url: 'blob:font-1', unicodeRange: 'U+E000'}],
        blocks: [{spans: [{text: '\ue000'}]}]
    }]
};
const fontRenderer = new B62DOMRenderer();
fontRenderer._watchFonts(fontContext);
fontRenderer._watchFonts(fontContext);
assert.equal(fontLoadCount, 1, 'a pending WOFF load must be deduplicated');
resolveFontLoad([]);
await fontLoad;
await Promise.resolve();
assert.equal(fontLayoutCount, 1, 'a loaded active WOFF must request one layout pass');
fontRenderer._watchFonts(fontContext);
assert.equal(fontLoadCount, 1, 'a loaded WOFF must not start a render loop');
fontRenderer.renderScene(Object.assign({}, fontContext, {
    cues: [Object.assign({clear: true}, fontContext.cues[0])]
}));
assert.equal(fontLoadCount, 1, 'rebuilding an active scene must retain its loaded WOFF state');

fontRenderer._watchFonts({
    overlayElement: fontOverlay,
    requestLayout: fontContext.requestLayout,
    cues: [{
        fontFaces: [{family: 'Range font', url: 'blob:range-font', unicodeRange: 'U+E000'}],
        blocks: [{spans: [{text: 'ASCII'}]}]
    }]
});
assert.equal(fontLoadCount, 1, 'a unicode-range mismatch must not be marked as a loaded font');
assert.equal(fontRenderer._fontLoads.size, 0, 'settled inactive WOFF entries must be pruned');

let resolveObsoleteFont;
const obsoleteLoad = new Promise((resolve) => {
    resolveObsoleteFont = resolve;
});
fontOverlay.ownerDocument.fonts.load = () => obsoleteLoad;
fontRenderer._watchFonts({
    overlayElement: fontOverlay,
    requestLayout: fontContext.requestLayout,
    cues: [{
        fontFaces: [{family: 'Old font', url: 'blob:font-2'}],
        blocks: [{spans: [{text: 'old'}]}]
    }]
});
fontRenderer.clear({overlayElement: fontOverlay});
resolveObsoleteFont([]);
await obsoleteLoad;
await Promise.resolve();
assert.equal(fontLayoutCount, 1, 'an obsolete WOFF must not redraw a cleared scene');
assert.equal(fontRenderer._fontLoads.size, 0, 'an obsolete pending WOFF must be removed after settlement');

const renderedScenes = [];
const outputRenderer = {
    clear(context) {
        renderedScenes.push({type: 'clear', cueCount: context.cues.length});
    },
    renderScene(context) {
        renderedScenes.push({type: 'render', cueCount: context.cues.length});
    }
};
const outputMedia = {
    paused: true,
    ended: false,
    currentTime: 0,
    addEventListener() {},
    removeEventListener() {}
};
const outputOverlay = {style: {}, innerHTML: ''};
const pluggableRenderer = new B62TTMLRenderer({
    mediaElement: outputMedia,
    overlayElement: outputOverlay,
    outputRenderer: outputRenderer
});
assert.equal(renderedScenes.at(-1).type, 'render');
pluggableRenderer.clear();
assert.equal(renderedScenes.at(-1).type, 'clear');
pluggableRenderer.destroy();

console.log('renderer clock and resource lifecycle: ok');
