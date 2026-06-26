# aribb62.js

ARIB STD-B62 / ARIB-TTML parser and browser renderer.

This project intentionally stays outside `mmts.js`: `mmts.js` demuxes MMTS and emits TTML payloads, while `aribb62.js` parses and renders those payloads.

There is no build step. The package exports `src/index.js` directly as an ES module and also installs `window.aribb62js` when loaded in a browser.

Serve this directory with any static file server and open `/demo/`.

Implemented renderer basics:

- TTML timing, regions, color, font size, line height, and display alignment
- ARIB-TTML `writingMode` mapping for horizontal and vertical captions
- ARIB-TTML `arib-tt:ruby` spans linked to a base element by `xml:id`
- `smpte:backgroundImage` with embedded `smpte:image` or same-MPU `subt://n` resources
- `arib-tt:font-face` with same-MPU `subt://n` font resources
- ARIB-TTML extension CSS mapping for `arib-tt:border`, `arib-tt:letter-spacing`, `arib-tt:text-shadow`, `arib-tt:marquee`, `arib-tt:keyframes`, and `arib-tt:animation`
- `dur` and `indefinite` timing for live-mode continued presentation
- `arib-tt:audio` metadata extraction (`romsound://n` and `subt://n` are exposed, playback is left to the host)
- UTF-8 text with LF/TAB preserved for browser `pre-wrap` rendering

```js
const renderer = new aribb62js.B62TTMLRenderer({
  mediaElement: video,
  overlayElement: overlay,
  isLive: true,
})

player.on(mpegts.Events.MMTS_SUBTITLE_DATA_ARRIVED, data => {
  renderer.push(data)
})
```

External B62 resources can be supplied on the push payload as `resources`, `subsamples`, `resourceMap`, or `resourcesBySubsample`. The resource index is the B60/B62 subsample number used by `subt://<index>`.
