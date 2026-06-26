export interface B62TTMLRendererOptions {
  mediaElement?: HTMLMediaElement
  overlayElement?: HTMLElement
  isLive?: boolean
  maxCues?: number
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
  cueCount: number
  cues: object[]
  audioCount: number
  audios: B62TTMLAudioCue[]
  text: string
  pts?: number
  basePts: number | null
  effectiveBasePts: number | null
  arrivalAligned: boolean
  len: number
  resourceCount: number
  preview: string
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
  region: object | null
  style: Record<string, string>
  spans: B62TTMLSpanCue[]
}

export interface B62TTMLCue {
  key: string
  start: number
  end: number
  clear: boolean
  plane: [number, number]
  fontFaces?: object[]
  keyframes?: object[]
  hasMarquee?: boolean
  audios?: B62TTMLAudioCue[]
  blocks: B62TTMLBlockCue[]
}

export declare class B62TTMLRenderer {
  constructor(options?: B62TTMLRendererOptions)
  attachMediaElement(mediaElement: HTMLMediaElement): void
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
  static renderCueDOM(overlay: HTMLElement, cue: B62TTMLCue): void
  static previewCues(cues: B62TTMLCue[], text?: string): string
}

export const TTMLRenderer: typeof B62TTMLRenderer

declare const aribb62js: {
  B62TTMLRenderer: typeof B62TTMLRenderer
  TTMLRenderer: typeof B62TTMLRenderer
}

export default aribb62js
