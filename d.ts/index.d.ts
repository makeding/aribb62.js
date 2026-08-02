export interface B62TTMLRendererOptions {
  mediaElement?: HTMLVideoElement
  overlayElement?: HTMLElement
  isLive?: boolean
  liveTimingDelay?: number
  maxCues?: number
  normalFont?: string
  fontFamily?: string
  forceStrokeColor?: boolean | string
  fallbackStrokeColor?: false | string
  strokeWidth?: number
  strokeWidthInPlane?: number
  forceBackgroundColor?: string
  backgroundPadding?: string
  lineBackground?: boolean
  outputRenderer?: B62OutputRenderer
}

export interface B62RenderContext {
  overlayElement: HTMLElement | null
  mediaElement: HTMLVideoElement | null
  cues: B62TTMLCue[]
  styleOptions: B62TTMLRendererOptions
}

export interface B62OutputRenderer {
  renderScene(context: B62RenderContext): void
  clear?(context: B62RenderContext): void
  destroy?(context: B62RenderContext): void
}

export declare class B62DOMRenderer implements B62OutputRenderer {
  renderScene(context: B62RenderContext): void
  clear(context: B62RenderContext): void
  destroy(context: B62RenderContext): void
}

export interface B62TTMLResource {
  index?: number
  subsampleIndex?: number
  subsampleNumber?: number
  subsample?: number
  id?: number
  data?: Uint8Array | ArrayBuffer | number[]
  payload?: Uint8Array | ArrayBuffer | number[]
  bytes?: Uint8Array | ArrayBuffer | number[]
  url?: string
  mimeType?: string
  type?: string | number
  dataType?: number
  format?: string
}

export interface B62TTMLPushData {
  packetId?: number
  mpuSequenceNumber?: number
  pts?: number
  rawPts?: number
  dts?: number
  rawDts?: number
  subtitleTimingMode?: number
  subtitleReferenceStartTime?: number
  subtitleReferenceStartMediaTime?: number
  videoMediaDts?: number
  videoMediaPts?: number
  videoRawDtsBase?: number
  videoDtsBase?: number
  len?: number
  text?: string
  data?: Uint8Array | ArrayBuffer
  resources?: B62TTMLResource[]
  subsamples?: B62TTMLResource[]
  resourceMap?: Record<string, B62TTMLResource | Uint8Array | ArrayBuffer | number[]>
  resourcesBySubsample?: Record<string, B62TTMLResource | Uint8Array | ArrayBuffer | number[]>
}

export interface B62TTMLPushResult {
  eventCount: number
  packetId?: number
  documentKind: 'none' | 'invalid' | 'clear' | 'presentation'
  cueCount: number
  cues: object[]
  audioCount: number
  audios: B62TTMLAudioCue[]
  text: string
  pts?: number
  basePts: number | null
  effectiveBasePts: number | null
  arrivalAligned: boolean
  timelineOffset: number | null
  len: number
  resourceCount: number
  preview: string
  previewCodePoints: string
  fontFaceCount: number
  fontFaces: B62TTMLFontFace[]
}

export interface B62TTMLFontFace {
  family: string
  url: string
  src: string
  resourceIndex: number | null
  format: string
  unicodeRange: string
  downloadName: string
}

export interface B62TTMLSpanCue {
  text: string
  rubyText?: string
  style: Record<string, string>
}

export interface B62TTMLAudioCue {
  id: string
  src: string
  resolvedSrc: string
  loop: boolean
  begin: number | null
  end: number | null
  dur: number | null
}

export interface B62TTMLBlockCue {
  xmlId?: string
  groupKey?: string
  region: object | null
  style: Record<string, string>
  contentStyle?: Record<string, string>
  spans: B62TTMLSpanCue[]
}

export interface B62TTMLCue {
  key: string
  start: number
  end: number
  clear: boolean
  trackKey?: string
  eventId?: number
  eventStart?: number
  resourceScopeKey?: string
  continuationId?: string
  plane: [number, number]
  fontFaces?: object[]
  keyframes?: object[]
  hasMarquee?: boolean
  audios?: B62TTMLAudioCue[]
  blocks: B62TTMLBlockCue[]
}

export declare class B62TTMLRenderer {
  constructor(options?: B62TTMLRendererOptions)
  attachMediaElement(mediaElement: HTMLVideoElement): void
  detachMediaElement(): void
  setOverlayElement(overlayElement: HTMLElement): void
  setLive(isLive: boolean): void
  startClock(): void
  stopClock(): void
  destroy(): void
  clear(): void
  reset(): void
  push(data: B62TTMLPushData): B62TTMLPushResult
  render(): void
  readonly eventCount: number
  static parse(text: string, basePts?: number | null, currentTime?: number, forceBaseAlignment?: boolean, options?: object): B62TTMLCue[]
  static renderCueDOM(overlay: HTMLElement, cue: B62TTMLCue, styleOptions?: B62TTMLRendererOptions, mediaElement?: HTMLVideoElement): void
  static previewCues(cues: B62TTMLCue[], text?: string): string
}

export const TTMLRenderer: typeof B62TTMLRenderer

declare const aribb62js: {
  B62TTMLRenderer: typeof B62TTMLRenderer
  B62DOMRenderer: typeof B62DOMRenderer
  TTMLRenderer: typeof B62TTMLRenderer
}

export default aribb62js
