import { MediaFormatInspector } from './format-inspector';
import { BoundedVideoTranscoder } from './bounded-video-transcoder';
import { type BoundedMediaSource, type MediaEnvironment } from './types';
type Inspection = Awaited<ReturnType<MediaFormatInspector['openMp4']>>;
export interface Mp4PlaybackOptions {
    signal?: AbortSignal;
    encoderConfig?: VideoEncoderConfig;
    decoderConfig?: VideoDecoderConfig;
    startTime?: number;
    autoplay?: boolean;
    onError?: (error: unknown) => void;
    onMetrics?: Parameters<BoundedVideoTranscoder['run']>[0]['onMetrics'];
}
/** A streaming MediaSource URL, never a whole-file Blob. One epoch owns each seek. */
export declare class Mp4StreamPlayback {
    private source;
    private inspection;
    private video;
    private options;
    private env;
    private lifetime;
    private run?;
    private pumping;
    private switching;
    private samples;
    private url;
    private media?;
    private runStart;
    private restarting;
    private revision;
    metrics?: Awaited<ReturnType<BoundedVideoTranscoder['run']>>;
    private constructor();
    static open(source: BoundedMediaSource, inspection: Inspection, video: HTMLVideoElement, options?: Mp4PlaybackOptions, env?: MediaEnvironment): Promise<Mp4StreamPlayback>;
    private onSeeking;
    get done(): Promise<void>;
    seek(time: number, playing?: boolean): Promise<void>;
    private start;
    private backpressure;
    private append;
    private trim;
    private releaseMedia;
    close(): Promise<void>;
}
export {};
