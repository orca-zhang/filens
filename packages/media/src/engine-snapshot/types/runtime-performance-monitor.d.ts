type Stage = 'decode' | 'encode' | 'process';
export interface NetworkObservation {
    rttMs?: number;
    packetLoss?: number;
    availableBitrate?: number;
}
export interface RuntimeObservation extends NetworkObservation {
    targetFps: number;
    encodeFps?: number;
    decodeFps?: number;
    queueDepth?: number;
    droppedFrames?: number;
    totalFrames?: number;
    demandBitrate?: number;
    active?: boolean;
    processingLimited?: boolean;
    networkLimited?: boolean;
}
export type Adaptation = {
    direction: 'down' | 'up';
    bottleneck: 'network' | 'processing' | 'mixed' | 'none';
    bitrateFactor: number;
    fpsFactor: number;
    resolutionFactor: number;
};
/** All values are observed or unknown; no hardware inference from UA, GPU names or throughput. */
export declare class RuntimePerformanceMonitor {
    private readonly now;
    private readonly limit;
    private started;
    private stages;
    private network;
    private queueDepth;
    private droppedFrames;
    private utilization;
    private pressure;
    private streak;
    private healthy;
    private lastChange;
    private lastObservation;
    constructor(options?: {
        now?: () => number;
        sampleLimit?: number;
    });
    reset(): void;
    record(stage: Stage, latencyMs: number, frames?: number): void;
    observeQueue(depth: number): void;
    observeDropped(frames: number): void;
    observeNetwork(observation: NetworkObservation): void;
    observeUtilization(cpu: number | null, gpu: number | null, source: string): void;
    snapshot(): {
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
    adapt(sample: RuntimeObservation): Adaptation | null;
}
export {};
