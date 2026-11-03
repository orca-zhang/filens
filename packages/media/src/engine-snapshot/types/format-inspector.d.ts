import { type BoundedMediaSource, type CodecFamily, type MediaFormat } from './types';
export declare class MediaFormatInspector {
    codecFamily(codec: string): CodecFamily;
    sniff(source: BoundedMediaSource, signal?: AbortSignal): Promise<MediaFormat['container']>;
    /** Existing MP4Box is loaded only on the optional inspection path. */
    inspect(source: BoundedMediaSource, signal?: AbortSignal): Promise<MediaFormat>;
    openMp4(source: BoundedMediaSource, signal?: AbortSignal): Promise<{
        file: import("./mp4box-types/mp4box.all.mjs").ISOFile<unknown, unknown>;
        movie: any;
        format: MediaFormat;
        readBytes: number;
    }>;
}
