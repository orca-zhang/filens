import { MediaCapabilityDetector } from './capability-detector';
import { MediaFormatInspector } from './format-inspector';
import { HardwareAccelerationProbe } from './hardware-acceleration-probe';
import { CodecNegotiator } from './codec-negotiator';
import { TranscodingPolicy } from './transcoding-policy';
import { RuntimePerformanceMonitor } from './runtime-performance-monitor';
import type { BoundedMediaSource, MediaEnvironment } from './types';
import type { Mp4PlaybackOptions } from './mp4-playback';
/** Shared engine for caller-provided HTTP or verified DataChannel range sources. */
export declare class MediaEngine {
    private env;
    readonly capabilities: MediaCapabilityDetector;
    readonly inspector: MediaFormatInspector;
    readonly negotiator: CodecNegotiator;
    readonly policy: TranscodingPolicy;
    readonly performance: RuntimePerformanceMonitor;
    readonly hardware: HardwareAccelerationProbe;
    constructor(env?: MediaEnvironment);
    /** Explicit recovery entry: callers must first try native playback and retain their old fallback. */
    recover(source: BoundedMediaSource, video: HTMLVideoElement, options?: Mp4PlaybackOptions & {
        allowTranscoding?: boolean;
    }): Promise<import("./mp4-playback").Mp4StreamPlayback>;
}
