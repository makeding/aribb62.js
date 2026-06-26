# aribb62.js

ARIB STD-B62 / ARIB-TTML parser and browser renderer.

This project intentionally stays outside `mmts.js`: `mmts.js` demuxes MMTS and emits TTML payloads, while `aribb62.js` parses and renders those payloads.

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
