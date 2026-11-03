export type Support = 'supported' | 'unsupported' | 'unknown';
export type MediaPath = 'http-file' | 'mse' | 'datachannel-file' | 'webrtc-rtp';
export type CodecFamily = 'avc' | 'hevc' | 'av1' | 'vp8' | 'vp9' | 'unknown';
export type AccelerationPreference = 'prefer-hardware' | 'prefer-software' | 'no-preference';
export type HardwareExecution = 'confirmed-hardware' | 'confirmed-software' | 'unknown';
export type MediaEnvironment = Record<string, any>;
export interface CodecEvidence {
    support: Support;
    preference: AccelerationPreference;
    execution: HardwareExecution;
    configuration?: VideoDecoderConfig | VideoEncoderConfig;
    reason?: string;
}
export interface ThroughputEvidence {
    frames: number;
    elapsedMs: number;
    fps: number;
    targetFps: number;
    codecString: string;
    width: number;
    height: number;
}
export interface CodecCandidate {
    codec: CodecFamily;
    codecString: string;
    playback: Support;
    transport: Support;
    decode: Support;
    encode: Support;
    preference: AccelerationPreference;
    execution: HardwareExecution;
    remote?: boolean;
    width?: number;
    height?: number;
    fps?: number;
    performance?: ThroughputEvidence;
}
export interface BoundedMediaSource {
    readonly identity: string;
    readonly size?: number;
    readonly nativeUrl?: string;
    read(start: number, endExclusive: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
    close(): void;
}
export interface MediaTrackInfo {
    id: number;
    kind: 'video' | 'audio' | 'text' | 'other';
    codec: string;
    family: CodecFamily;
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
    timescale: number;
    duration: number;
    description?: Uint8Array<ArrayBuffer>;
    encrypted: boolean;
}
export interface MediaFormat {
    container: 'mp4' | 'quicktime' | 'webm' | 'matroska' | 'unknown';
    tracks: MediaTrackInfo[];
    duration?: number;
    fragmented?: boolean;
    mime?: string;
}
export declare const MEDIA_LIMITS: Readonly<{
    readBytes: number;
    metadataBytes: number;
    indexSamples: 250000;
    frames: 4;
    rawFrameBytes: number;
    encodedBytes: number;
    bufferAheadSeconds: 8;
    bufferBehindSeconds: 4;
    operationTimeoutMs: 10000;
}>;
export declare function abortError(): DOMException;
export declare function validNumber(value: unknown, minimum?: number): value is number;
/** Race an operation without retaining cancellation listeners after completion. */
export declare function cancellable<T>(operation: PromiseLike<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
/** A third-party transform may finish after cancellation; release its late result. */
export declare function cancellableFrame(operation: Promise<VideoFrame>, signal: AbortSignal): Promise<VideoFrame>;
export declare function waitUntil(ready: () => boolean, signal?: AbortSignal, timeoutMs?: number): Promise<void>;
