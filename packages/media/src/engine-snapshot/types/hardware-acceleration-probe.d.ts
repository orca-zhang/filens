import { type MediaEnvironment, type HardwareExecution } from './types';
/** Explicit bounded encode/decode trial; support and speed never assert hardware execution. */
export declare class HardwareAccelerationProbe {
    private env;
    constructor(env?: MediaEnvironment);
    run(config: VideoEncoderConfig, options?: {
        frames?: number;
        signal?: AbortSignal;
        timeoutMs?: number;
        minimumDurationMs?: number;
        pace?: boolean;
        drawFrame?: (canvas: OffscreenCanvas | HTMLCanvasElement, index: number) => void;
    }): Promise<{
        execution: HardwareExecution;
        initialized: boolean;
        completed: boolean;
        error: string;
        metrics: {
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
        };
        support: import("./types").Support;
        preference: import("./types").AccelerationPreference;
        configuration?: VideoDecoderConfig | VideoEncoderConfig;
        reason?: string;
    }>;
}
