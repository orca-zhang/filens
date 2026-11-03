import { type CodecEvidence, type MediaEnvironment, type MediaPath, type Support } from './types';
/** Queries are explicit and configuration-specific; ordinary playback never calls video(). */
export declare class MediaCapabilityDetector {
    private env;
    constructor(env?: MediaEnvironment);
    playback(mime: string, path: MediaPath): Support;
    video(config: Record<string, any>, mode: 'decode' | 'encode', signal?: AbortSignal): Promise<CodecEvidence>;
    rtp(): {
        sender: any;
        receiver: any;
    };
    prediction(configuration: MediaDecodingConfiguration, signal?: AbortSignal): Promise<unknown>;
}
