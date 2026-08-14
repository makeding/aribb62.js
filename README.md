# aribb62.js

ARIB STD-B62 / ARIB-TTML parser and browser renderer.

This package accepts normalized B62 subtitle payloads from a demuxer and owns the ARIB-TTML parsing, presentation state, and browser rendering path.

There is no build step. The package exports `src/index.js` directly as an ES module and also installs `window.aribb62js` when loaded in a browser.

Serve this directory with any static file server and open `/demo/`.

Implemented renderer basics:

- TTML timing, regions, color, one- and two-value font size, line height, and display alignment
- ARIB-TTML `writingMode` mapping for horizontal and vertical captions
- ARIB-TTML `arib-tt:ruby` associations on `div`, `p`, and `span` through same-document `xml:id` references
- `smpte:backgroundImage` with embedded `smpte:image` or same-MPU `subt://n` resources
- `arib-tt:font-face` with same-MPU `subt://n` font resources
- ARIB-TTML extension CSS mapping for `arib-tt:border`, `arib-tt:letter-spacing`, `arib-tt:text-shadow`, `arib-tt:marquee`, `arib-tt:keyframes`, and `arib-tt:animation`
- TR-B39 span-level regions, fixed overflow clipping, media-clock animation synchronization, and absolute keyframe-origin mapping
- `dur` and `indefinite` timing for live-mode continued presentation
- `arib-tt:audio` metadata extraction (`romsound://n` and `subt://n` are exposed, playback is left to the host)
- UTF-8 text with LF/TAB preserved for browser `pre-wrap` rendering

Document state follows the B62 presentation rules rather than treating every parsed cue independently:

- malformed XML is ignored and does not clear the active presentation
- an empty `<tt></tt>` is recognized as the explicit clear command
- in live mode, `end="indefinite"` content is continued only by a following `begin="indefinite"` element with the same `xml:id`
- continued content keeps the old DOM/style and same-MPU resource scope while accepting the new end time
- caption and superimpose are independent logical planes; superimpose is always painted above caption

Pass `trackKind: 'caption' | 'superimpose'` when the upstream metadata already identifies the plane. The renderer also
recognizes the normalized ARIB `subtitleType` value (`0` caption, `1` superimpose). In B60, this value comes from the
additional ARIB subtitle information `type` field; `componentTag` only identifies a component stream and is not used to
infer the plane. Reserved or unknown type values must be handled by the upstream integration rather than guessed as a
superimpose track.
`setTrackVisibility('caption', false)` hides selectable captions without suppressing superimpose, and
`clearTrack(packetId)` retires one switched or discontinuous packet without disturbing the other plane.

Pass B60 `resolution` as `subtitleResolution` when available. It uses the B60 values `0` = 1920×1080,
`1` = 3840×2160, and `2` = 7680×4320 when the TTML document does not provide `tts:extent`.

`arib-tt:border` is rendered as the four-sided enclosure around a character sequence. Viewer readability stroke (`forceStrokeColor` / `fallbackStrokeColor`) is a separate, non-ARIB presentation option.

```js
const renderer = new aribb62js.B62TTMLRenderer({
  mediaElement: video,
  overlayElement: overlay,
  isLive: true,
  normalFont: '"Rounded M+ 1m for ARIB", "Hiragino Maru Gothic Pro", "BIZ UDGothic", "Yu Gothic Medium", sans-serif',
  forceStrokeColor: false,
  fallbackStrokeColor: 'rgba(0, 0, 0, 0.86)',
  strokeWidth: 1.5,
  backgroundPadding: '0 0.08em',
  lineBackground: true,
  smallScreenScale: true,
})

// Feed normalized B62 push payloads from the selected subtitle source.
renderer.push(data)
```

The renderer fits the complete caption plane to the visible video area by default, preserving the broadcaster's coordinates. Set `smallScreenScale: true` to enlarge captions up to `2x` on video viewports shorter than 640 CSS pixels, or pass a number from `1` to `2` for a fixed accessibility scale. Enlarged captions are anchored vertically to the bottom and horizontally to the caption group's nearer edge so separately positioned ARIB readings stay aligned with the main text.

External B62 resources can be supplied on the push payload as `resources`, `subsamples`, `resourceMap`, or `resourcesBySubsample`. The resource index is the B60/B62 subsample number used by `subt://<index>`.
