import { RuntimePerformanceMonitor, type RuntimeObservation } from '../runtime-performance-monitor';
import { type CodecFamily, type MediaEnvironment } from '../types';
export interface EncodingAdjustment {
    maxBitrate?: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
}
/** Operates on caller-owned RTP objects; never changes ICE, TURN, DataChannels or SDP itself. */
export declare class WebRTCAdapter {
    private peer;
    private sender;
    private transceiver?;
    readonly monitor: RuntimePerformanceMonitor;
    private previous;
    private updating;
    private lifetime;
    private timer?;
    constructor(peer: RTCPeerConnection, sender: RTCRtpSender, transceiver?: RTCRtpTransceiver);
    setCodecPreferences(capabilities: RTCRtpCodec[], priorities: readonly CodecFamily[]): boolean;
    adjust(adjustment: EncodingAdjustment): Promise<void>;
    sample(): Promise<{
        observation: Partial<RuntimeObservation>;
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
    }>;
    start(options: {
        targetFps: number;
        maxBitrate: number;
        active?: () => boolean;
        onError: (error: unknown) => void;
        onSample?: (sample: Awaited<ReturnType<WebRTCAdapter['sample']>>) => void;
    }): void;
    close(): void;
}
/** Raw VideoFrames enter the native WebRTC encoder through a generated track. */
export declare function createProcessedVideoTrack(input: MediaStreamTrack, options: {
    transform: (frame: VideoFrame, signal: AbortSignal) => Promise<VideoFrame>;
    signal?: AbortSignal;
    environment?: MediaEnvironment;
}): {
    track: MediaStreamTrack;
    done: Promise<void>;
    close: () => Promise<void>;
};
