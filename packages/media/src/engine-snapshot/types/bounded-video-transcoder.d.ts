import { RuntimePerformanceMonitor } from './runtime-performance-monitor';
import { type MediaEnvironment, type ThroughputEvidence } from './types';
export declare class MediaCodecFailure extends Error {
    readonly stage: 'encode' | 'decode' | 'configure';
    constructor(stage: 'encode' | 'decode' | 'configure', error: unknown);
}
export interface TranscodeOptions {
    decoderConfig: VideoDecoderConfig;
    encoderConfig: VideoEncoderConfig;
    chunks: (signal: AbortSignal) => AsyncIterable<EncodedVideoChunk>;
    sink: (chunk: EncodedVideoChunk, metadata: EncodedVideoChunkMetadata) => Promise<void>;
    process?: (frame: VideoFrame, signal: AbortSignal) => Promise<VideoFrame>;
    signal?: AbortSignal;
    startTimestamp?: number;
    onMetrics?: (metrics: ReturnType<RuntimePerformanceMonitor['snapshot']>) => void;
}
/** One bounded attempt. The caller owns demux, mux and any restart after a failed attempt. */
export declare class BoundedVideoTranscoder {
    private env;
    private controller?;
    constructor(env?: MediaEnvironment);
    close(): void;
    runWithFallback(options: TranscodeOptions, fallback: {
        softwarePerformance: ThroughputEvidence;
        resetOutput: () => Promise<void>;
    }): Promise<{
        elapsedMs: number;
        encode: {
            frames: number;
            samples: number;
            fps: number;
            averageMs: number;
            p95Ms: number;
        };
        decode: {
            frames: number;
            samples: number;
            fps: number;
            averageMs: number;
            p95Ms: number;
        };
        process: {
            frames: number;
            samples: number;
            fps: number;
            averageMs: number;
            p95Ms: number;
        };
        encoderQueueDepth: number;
        droppedFrames: number;
        cpuUsage: number;
        gpuVideoUtilization: number;
        utilizationSource: string;
        network: {
            rttMs: number;
            packetLoss: number;
            availableBitrate: number;
        };
    }>;
    run(options: TranscodeOptions): Promise<{
        elapsedMs: number;
        encode: {
            frames: number;
            samples: number;
            fps: number;
            averageMs: number;
            p95Ms: number;
        };
        decode: {
            frames: number;
            samples: number;
            fps: number;
            averageMs: number;
            p95Ms: number;
        };
        process: {
            frames: number;
            samples: number;
            fps: number;
            averageMs: number;
            p95Ms: number;
        };
        encoderQueueDepth: number;
        droppedFrames: number;
        cpuUsage: number;
        gpuVideoUtilization: number;
        utilizationSource: string;
        network: {
            rttMs: number;
            packetLoss: number;
            availableBitrate: number;
        };
    }>;
}
