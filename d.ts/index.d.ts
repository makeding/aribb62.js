export interface B62TTMLRendererOptions {
  mediaElement?: HTMLMediaElement
  overlayElement?: HTMLElement
  isLive?: boolean
  maxCues?: number
}

export interface B62TTMLPushResult {
  eventCount: number
  packetId?: number
  cueCount: number
  cues: object[]
  text: string
  pts?: number
  basePts: number | null
  effectiveBasePts: number | null
  arrivalAligned: boolean
  len: number
  preview: string
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
  push(data: object): B62TTMLPushResult
  render(): void
  readonly eventCount: number
  static parse(text: string, basePts?: number | null, currentTime?: number, forceBaseAlignment?: boolean): object[]
  static renderCueDOM(overlay: HTMLElement, cue: object): void
  static previewCues(cues: object[], text?: string): string
}

export const TTMLRenderer: typeof B62TTMLRenderer

declare const aribb62js: {
  B62TTMLRenderer: typeof B62TTMLRenderer
  TTMLRenderer: typeof B62TTMLRenderer
}

export default aribb62js
