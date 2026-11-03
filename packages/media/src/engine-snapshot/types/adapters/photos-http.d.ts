import type { BoundedMediaSource, MediaEnvironment } from '../types';
import { type RangeResponse } from './range-source';
export declare class PhotosHttpAdapter {
    private environment;
    private request?;
    constructor(environment?: MediaEnvironment, request?: (resource: string, start: number, end: number, signal: AbortSignal) => Promise<RangeResponse>);
    /** Synchronous, with no capability probes, API requests or codec instances. */
    direct(url: string): {
        url: string;
        kind: "native-direct" | "remux" | "audio-convert" | "decode-render" | "existing-fallback" | "client-transcode";
        reason: string;
        candidate?: import("..").CodecCandidate;
    };
    source(url: string): Promise<BoundedMediaSource>;
}
