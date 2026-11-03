import { CodecNegotiator } from './codec-negotiator';
import type { CodecCandidate, MediaPath, Support } from './types';
export interface PolicyContext {
    direct: Support;
    path: MediaPath;
    candidates: readonly CodecCandidate[];
    requiresProcessing?: boolean;
    samplesPlayable?: boolean;
    videoPlayable?: boolean;
    audioConversionAvailable?: boolean;
    preserveTracks?: boolean;
    sourceDecode?: Support;
    failure?: 'authorization' | 'source-changed' | 'network' | 'cancelled' | 'unsupported';
}
export type PlaybackPlan = {
    kind: 'native-direct' | 'remux' | 'audio-convert' | 'decode-render' | 'existing-fallback' | 'client-transcode';
    reason: string;
    candidate?: CodecCandidate;
};
export declare class TranscodingPolicy {
    private negotiator;
    constructor(negotiator?: CodecNegotiator);
    decide(context: PolicyContext): PlaybackPlan;
}
