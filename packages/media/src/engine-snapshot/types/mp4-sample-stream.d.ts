import { createFile, type Sample } from './mp4box-types/mp4box.all.mjs';
import type { MediaFormatInspector } from './format-inspector';
import { type BoundedMediaSource, type MediaTrackInfo } from './types';
type Inspected = Awaited<ReturnType<MediaFormatInspector['openMp4']>>;
export interface MediaPacket {
    data: Uint8Array<ArrayBuffer>;
    timestamp: number;
    duration: number;
    type: 'key' | 'delta';
}
/** Reuses MP4Box; rejects layouts that this incremental adapter cannot faithfully preserve. */
export declare class Mp4SampleStream {
    private source;
    readonly tracks: MediaTrackInfo[];
    private samples;
    private accessPoints;
    private offsets;
    private mux;
    private initializations;
    private cache?;
    constructor(source: BoundedMediaSource, inspected: Inspected);
    count(id: number): number;
    offset(id: number): number;
    initialization(id: number): ArrayBuffer;
    seekIndex(id: number, seconds: number): number;
    /** MSE remove() also removes dependent frames until the next keyframe.
     * End removal exactly at a retained random access point, never mid-GOP. */
    retentionStart(id: number, seconds: number): number;
    packet(id: number, index: number, signal?: AbortSignal): Promise<MediaPacket>;
    fragment(id: number, index: number, signal?: AbortSignal): Promise<{
        data: ArrayBuffer;
        next: number;
        start: number;
        end: number;
    }>;
    close(): void;
}
export declare function mp4Fragment(file: ReturnType<typeof createFile>, samples: Sample[]): ArrayBuffer;
/** H.264 fMP4 output; other encoder outputs require a separately validated mux path. */
export declare class AvcFragmentMuxer {
    private file;
    private id;
    private count;
    constructor(configuration: VideoDecoderConfig);
    initialization(): ArrayBuffer;
    fragment(chunk: EncodedVideoChunk, fps: number): ArrayBuffer;
    close(): void;
}
export {};
