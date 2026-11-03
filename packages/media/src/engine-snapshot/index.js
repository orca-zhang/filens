import { i as e, n as t, r as n } from "./mp4box.all-Bw_Tlr0T.mjs";
import { a as r, i, n as a, o, r as s, s as c, t as l } from "./defineProperty-BPysVNyd.mjs";
import { a as u, c as d, d as f, f as p, h as m, i as h, l as g, m as _, n as v, o as y, p as b, r as x, s as S, t as C, u as w } from "./webrtc-3FLSw_e7.mjs";
// src/lib/media-engine/mp4-sample-stream.ts
var T = /* @__PURE__ */ e({
	AvcFragmentMuxer: () => O,
	Mp4SampleStream: () => E,
	mp4Fragment: () => D
}), E = class {
	constructor(e, t) {
		if (l(this, "source", void 0), l(this, "tracks", void 0), l(this, "samples", /* @__PURE__ */ new Map()), l(this, "accessPoints", /* @__PURE__ */ new Map()), l(this, "offsets", /* @__PURE__ */ new Map()), l(this, "mux", n()), l(this, "initializations", /* @__PURE__ */ new Map()), l(this, "cache", void 0), this.source = e, this.tracks = t.format.tracks, this.tracks.some((e) => e.encrypted)) throw Error("Encrypted media is unsupported");
		if (this.tracks.filter((e) => e.kind === "video").length !== 1 || this.tracks.filter((e) => e.kind === "audio").length > 1 || this.tracks.some((e) => e.kind !== "video" && e.kind !== "audio")) throw Error("Cannot preserve this media track layout");
		if (t.format.fragmented) throw Error("Fragmented input requires the existing native playback path");
		for (let e of this.tracks) {
			let n = t.file.getTrackById(e.id), r = n.mdia.minf.stbl.stsd.entries[0], i = n.tkhd.matrix;
			if (e.kind === "video" && (i[0] !== 65536 || i[1] !== 0 || i[3] !== 0 || i[4] !== 65536)) throw Error("Cannot preserve rotated or scaled track geometry");
			let o = t.movie.tracks.find((t) => t.id === e.id), s = 0, c = 0, l = 0;
			for (let n of o.edits || []) {
				if (n.media_rate_integer !== void 0 && (n.media_rate_integer !== 1 || n.media_rate_fraction !== 0)) throw Error("Cannot preserve track edit rate");
				if (n.media_time < 0 && !l) s += n.segment_duration / t.movie.timescale;
				else {
					if (++l > 1) throw Error("Cannot preserve multiple track edits");
					c = s - n.media_time / e.timescale;
				}
			}
			this.offsets.set(e.id, c);
			let u = t.file.getTrackSamplesInfo(e.id);
			if (!u.length || u.length > a.indexSamples) throw Error("Media index budget exceeded");
			this.samples.set(e.id, u), this.accessPoints.set(e.id, u.map((e, t) => t).filter((t) => e.kind === "audio" || u[t].is_sync).sort((e, t) => u[e].cts - u[t].cts)), this.mux.addTrack({
				id: e.id,
				type: r.type,
				timescale: e.timescale,
				width: e.width,
				height: e.height,
				hdlr: e.kind === "audio" ? "soun" : "vide",
				channel_count: e.channels,
				samplerate: e.sampleRate,
				description_boxes: r.boxes.filter((e) => [
					"avcC",
					"hvcC",
					"av1C",
					"vpcC",
					"esds",
					"colr",
					"pasp"
				].includes(e.type))
			}), this.mux.setSegmentOptions(e.id, null, { nbSamples: 16 });
		}
		this.mux.onSegment = () => {};
		for (let e of this.mux.initializeSegmentation("per-track")) this.initializations.set(e.id, e.buffer);
	}
	count(e) {
		return this.samples.get(e)?.length || 0;
	}
	offset(e) {
		return this.offsets.get(e) || 0;
	}
	initialization(e) {
		return this.initializations.get(e);
	}
	seekIndex(e, t) {
		let n = this.tracks.find((t) => t.id === e), r = this.samples.get(e), i = (t - this.offset(e)) * n.timescale, a = this.accessPoints.get(e), o = 0, s = a.length;
		for (; o < s;) {
			let e = Math.floor((o + s) / 2);
			r[a[e]].cts <= i ? o = e + 1 : s = e;
		}
		return o ? a[o - 1] : 0;
	}
	retentionStart(e, t) {
		let n = this.samples.get(e)?.[this.seekIndex(e, t)], r = this.tracks.find((t) => t.id === e);
		return n ? n.cts / r.timescale + this.offset(e) : 0;
	}
	async packet(e, t, n) {
		let r = this.samples.get(e)?.[t], o = this.tracks.find((t) => t.id === e);
		if (!r || !Number.isSafeInteger(r.offset) || r.offset < 0 || r.size <= 0 || r.size > a.readBytes) throw Error("Media sample budget exceeded");
		let s = r.offset + r.size;
		if (!this.cache || r.offset < this.cache.start || s > this.cache.start + this.cache.bytes.byteLength) {
			let e = Math.min(this.source.size ?? s, r.offset + a.readBytes);
			this.cache = {
				start: r.offset,
				bytes: await i(this.source.read(r.offset, e, n), n)
			};
		}
		if (s > this.cache.start + this.cache.bytes.byteLength) throw Error("Truncated media sample");
		return {
			data: this.cache.bytes.subarray(r.offset - this.cache.start, s - this.cache.start),
			timestamp: Math.round((r.cts / o.timescale + this.offset(e)) * 1e6),
			duration: Math.round(r.duration / o.timescale * 1e6),
			type: r.is_sync ? "key" : "delta"
		};
	}
	async fragment(e, t, n) {
		let r = this.samples.get(e), i = this.tracks.find((t) => t.id === e), o = r[t], s = [], c = 0;
		for (; t < r.length && s.length < 16;) {
			let l = r[t];
			if (s.length && (l.dts - o.dts > i.timescale * .25 || c + l.size > a.encodedBytes)) break;
			let u = await this.packet(e, t++, n);
			s.push({
				...l,
				data: u.data
			}), c += l.size;
		}
		return {
			data: D(this.mux, s),
			next: t,
			start: o.cts / i.timescale + this.offset(e),
			end: Math.max(...s.map((t) => (t.cts + t.duration) / i.timescale + this.offset(e)))
		};
	}
	close() {
		this.cache = void 0, this.samples.clear(), this.accessPoints.clear(), this.initializations.clear(), this.mux.stop();
	}
};
function D(e, n) {
	let r = e.createMoof(n), i = new t();
	r.write(i), i.adjustUint32(r.trafs[0].truns[0].data_offset_position, r.size + 8);
	let o = n.reduce((e, t) => e + t.data.byteLength, 0);
	if (o > a.encodedBytes) throw Error("Media fragment budget exceeded");
	i.writeUint32(o + 8), i.writeString("mdat");
	let s = new Uint8Array(i.buffer), c = new Uint8Array(s.byteLength + o);
	c.set(s);
	let l = s.byteLength;
	for (let e of n) c.set(e.data, l), l += e.data.byteLength;
	return c.buffer;
}
var O = class {
	constructor(e) {
		if (l(this, "file", n()), l(this, "id", void 0), l(this, "count", 0), !e.codec.startsWith("avc1") || !e.description) throw Error("AVC decoder configuration required for MP4");
		let t = ArrayBuffer.isView(e.description) ? new Uint8Array(e.description.buffer, e.description.byteOffset, e.description.byteLength) : new Uint8Array(e.description);
		this.id = this.file.addTrack({
			type: "avc1",
			timescale: 1e6,
			width: e.codedWidth,
			height: e.codedHeight,
			avcDecoderConfigRecord: t.slice().buffer
		}), this.file.setSegmentOptions(this.id, null, { nbSamples: 1 }), this.file.onSegment = () => {};
	}
	initialization() {
		return this.file.initializeSegmentation("per-track")[0].buffer;
	}
	fragment(e, t) {
		let n = new Uint8Array(e.byteLength);
		e.copyTo(n);
		let r = Math.max(e.duration || 0, Math.round(1e6 / t));
		return D(this.file, [{
			track_id: this.id,
			number: this.count++,
			description_index: 1,
			dts: e.timestamp,
			cts: e.timestamp,
			duration: r,
			is_sync: e.type === "key",
			data: n,
			size: n.byteLength
		}]);
	}
	close() {
		this.file.stop();
	}
}, k = /* @__PURE__ */ e({ Mp4StreamPlayback: () => j });
function A(e, t, n) {
	return new Promise((r, i) => {
		let o = () => {
			clearTimeout(u), e.removeEventListener(t, s), e.removeEventListener("error", c), n.removeEventListener("abort", l);
		}, s = () => {
			o(), r();
		}, c = () => {
			o(), i(/* @__PURE__ */ Error(`Media ${t} failed`));
		}, l = () => {
			o(), i(n.reason);
		}, u = setTimeout(c, a.operationTimeoutMs);
		e.addEventListener(t, s, { once: !0 }), e.addEventListener("error", c, { once: !0 }), n.addEventListener("abort", l, { once: !0 }), n.aborted && l();
	});
}
var j = class e {
	constructor(e, t, n, r, i) {
		l(this, "source", void 0), l(this, "inspection", void 0), l(this, "video", void 0), l(this, "options", void 0), l(this, "env", void 0), l(this, "lifetime", new AbortController()), l(this, "run", void 0), l(this, "pumping", Promise.resolve()), l(this, "switching", Promise.resolve()), l(this, "samples", void 0), l(this, "url", ""), l(this, "media", void 0), l(this, "runStart", 0), l(this, "restarting", !1), l(this, "revision", 0), l(this, "metrics", void 0), l(this, "onSeeking", () => {
			if (!(this.restarting || this.lifetime.signal.aborted || Math.abs(this.video.currentTime - this.runStart) < .05)) {
				for (let e = 0; e < this.video.buffered.length; e++) if (this.video.currentTime >= this.video.buffered.start(e) && this.video.currentTime < this.video.buffered.end(e)) return;
				this.seek(this.video.currentTime).catch((e) => {
					this.lifetime.signal.aborted || this.options.onError?.(e);
				});
			}
		}), this.source = e, this.inspection = t, this.video = n, this.options = r, this.env = i, this.samples = new E(e, t);
	}
	static async open(t, n, r, i = {}, a = globalThis) {
		let o = new e(t, n, r, i, a), s = () => {
			o.close();
		};
		i.signal?.addEventListener("abort", s, { once: !0 }), o.lifetime.signal.addEventListener("abort", () => i.signal?.removeEventListener("abort", s), { once: !0 }), i.signal?.aborted && (await o.close(), i.signal.throwIfAborted()), r.addEventListener("seeking", o.onSeeking);
		try {
			return await o.seek(i.startTime || 0, i.autoplay ?? (!r.paused || r.autoplay)), o;
		} catch (e) {
			throw await o.close(), e;
		}
	}
	get done() {
		return this.pumping;
	}
	seek(e, t = !this.video.paused) {
		if (!Number.isFinite(e) || e < 0) return Promise.reject(/* @__PURE__ */ Error("Invalid media seek"));
		let n = {
			rate: this.video.playbackRate,
			volume: this.video.volume,
			muted: this.video.muted,
			loop: this.video.loop
		}, r = ++this.revision;
		this.run?.abort();
		let i = this.switching.catch(() => {}).then(() => this.start(e, t, n, r));
		return this.switching = i, i;
	}
	async start(e, t, n, r) {
		if (this.lifetime.signal.throwIfAborted(), r !== this.revision || (await this.pumping.catch(() => {}), this.lifetime.signal.throwIfAborted(), r !== this.revision)) return;
		this.releaseMedia();
		let o = y(this.lifetime.signal), s = o.controller.signal;
		this.run = o.controller, this.runStart = e, this.restarting = !0;
		let c = this.env.ManagedMediaSource || this.env.MediaSource;
		if (!c) throw o.dispose(), Error("MSE unavailable");
		let l = this.media = new c();
		this.url = this.env.URL.createObjectURL(l);
		let u = A(l, "sourceopen", s);
		this.video.disableRemotePlayback = !0, this.video.src = this.url, this.video.load();
		try {
			await u;
		} catch (e) {
			throw o.dispose(), this.restarting = !1, e;
		}
		s.throwIfAborted(), this.video.playbackRate = n.rate, this.video.volume = n.volume, this.video.muted = n.muted, this.video.loop = n.loop, l.duration = Math.max(this.inspection.format.duration || 0, ...this.samples.tracks.map((e) => e.duration)), e > 0 && (this.video.currentTime = Math.min(e, l.duration));
		let f, p, m = new Promise((e, t) => {
			f = e, p = t;
		}), h = () => {
			s.aborted || (this.restarting = !1, t && this.video.play().catch((e) => {
				e.name !== "NotAllowedError" && e.name !== "AbortError" && !s.aborted && this.options.onError?.(e);
			}));
		};
		this.video.addEventListener("loadeddata", h, { once: !0 });
		let g = () => this.video.removeEventListener("loadeddata", h);
		s.addEventListener("abort", g, { once: !0 });
		let _ = /* @__PURE__ */ new Map();
		for (let e of this.samples.tracks) {
			let t = e.kind === "video" && this.options.encoderConfig ? this.options.encoderConfig.codec : e.codec, n = l.addSourceBuffer(`${e.kind}/mp4; codecs="${t}"`);
			e.kind === "video" && this.options.encoderConfig || (n.timestampOffset = this.samples.offset(e.id)), _.set(e.id, n);
		}
		let v = async (t) => {
			let n = this.samples.tracks.find((e) => e.id === t), r = _.get(t);
			await this.append(r, this.samples.initialization(t), s);
			let i = this.samples.seekIndex(t, e);
			for (; i < this.samples.count(t);) {
				let e = await this.samples.fragment(t, i, s);
				await this.backpressure(e.start, s), await this.trim(r, s, this.samples.retentionStart(t, this.video.currentTime - a.bufferBehindSeconds)), await this.append(r, e.data, s), i = e.next, n.kind === "video" && f();
			}
		}, b, x = [], S = async (t) => {
			let n = _.get(t), r = !1, i = this.samples, o = this.env, c = this.options.encoderConfig;
			this.metrics = await new d(o).run({
				signal: s,
				decoderConfig: this.options.decoderConfig,
				encoderConfig: c,
				startTimestamp: Math.round(e * 1e6),
				onMetrics: this.options.onMetrics,
				chunks: async function* (n) {
					for (let r = i.seekIndex(t, e); r < i.count(t); r++) {
						let e = await i.packet(t, r, n);
						yield new o.EncodedVideoChunk(e);
					}
				},
				sink: async (e, t) => {
					if (!r) {
						if (b = new O(t.decoderConfig), t.decoderConfig.codec !== c.codec) {
							if (!n.changeType) throw Error("Encoder codec change requires SourceBuffer.changeType");
							n.changeType(`video/mp4; codecs="${t.decoderConfig.codec}"`);
						}
						await this.append(n, b.initialization(), s), r = !0;
					}
					await this.backpressure(e.timestamp / 1e6, s), e.type === "key" && x.push(e.timestamp / 1e6);
					let i = this.video.currentTime - a.bufferBehindSeconds;
					for (; x.length > 1 && x[1] <= i;) x.shift();
					await this.trim(n, s, x[0] <= i ? x[0] : 0), await this.append(n, b.fragment(e, c.framerate || 30), s), f();
				}
			});
		};
		this.pumping = (async () => {
			let e = this.samples.tracks.map((e) => e.kind === "video" && this.options.encoderConfig ? S(e.id) : v(e.id));
			try {
				await Promise.all(e), s.throwIfAborted(), l.readyState === "open" && l.endOfStream(), f();
			} catch (t) {
				throw p(t), o.controller.abort(t), await Promise.allSettled(e), t;
			} finally {
				b?.close(), o.dispose(), g(), s.removeEventListener("abort", g);
			}
		})(), this.pumping.catch((e) => {
			s.aborted && s.reason !== e || e?.name === "AbortError" || this.lifetime.signal.aborted || this.options.onError?.(e);
		});
		try {
			await i(m, s);
		} finally {
			this.restarting = !1;
		}
	}
	async backpressure(e, t) {
		for (; e > this.video.currentTime + a.bufferAheadSeconds;) await i(new Promise((e) => setTimeout(e, 50)), t);
	}
	async append(e, t, n) {
		n.throwIfAborted();
		let r = y(n), i = A(e, "updateend", r.controller.signal);
		try {
			e.appendBuffer(t), await i;
		} catch (e) {
			throw r.controller.abort(), await i.catch(() => {}), e;
		} finally {
			r.dispose();
		}
	}
	async trim(e, t, n) {
		if (n > 0 && e.buffered.length && e.buffered.start(0) < n) {
			let r = y(t), i = A(e, "updateend", r.controller.signal);
			try {
				e.remove(0, n), await i;
			} catch (e) {
				throw r.controller.abort(), await i.catch(() => {}), e;
			} finally {
				r.dispose();
			}
		}
	}
	releaseMedia() {
		this.url && (this.video.src === this.url && (this.video.pause(), this.video.removeAttribute("src"), this.video.load()), this.env.URL.revokeObjectURL(this.url), this.url = ""), this.media = void 0;
	}
	async close() {
		this.revision++, this.lifetime.abort(), this.run?.abort(), this.video.removeEventListener("seeking", this.onSeeking), await this.pumping.catch(() => {}), await this.switching.catch(() => {}), this.releaseMedia(), this.samples.close(), this.source.close(), this.inspection = void 0;
	}
}, M = class {
	constructor(e = globalThis) {
		l(this, "env", void 0), l(this, "capabilities", void 0), l(this, "inspector", new _()), l(this, "negotiator", new p()), l(this, "policy", new f(this.negotiator)), l(this, "performance", new w()), l(this, "hardware", void 0), this.env = e, this.capabilities = new m(e), this.hardware = new S(e);
	}
	async recover(e, t, n = {}) {
		try {
			let r = await this.inspector.openMp4(e, n.signal), { Mp4SampleStream: i } = await Promise.resolve().then(() => T);
			new i(e, r).close();
			let a = r.format.tracks.find((e) => e.kind === "video");
			if (r.format.tracks.filter((e) => e.kind === "audio").some((e) => this.capabilities.playback(`audio/mp4; codecs="${e.codec}"`, "mse") !== "supported")) throw Error("Client recovery cannot preserve this audio codec");
			let o = this.capabilities.playback(`video/mp4; codecs="${a.codec}"`, "mse") === "supported", s, c;
			if (!o) {
				if (!n.allowTranscoding) throw Error("Client video transcoding is not enabled");
				let e = r.file.getTrackById(a.id).mdia.minf.stbl.stsd.entries[0];
				if ([16, 18].includes(e.colr?.transfer_characteristics)) throw Error("Client HDR tone mapping is unavailable");
				let t = Math.min(1, 1280 / a.width, 720 / a.height);
				s = {
					codec: a.codec,
					description: a.description,
					codedWidth: a.width,
					codedHeight: a.height,
					hardwareAcceleration: "prefer-hardware"
				}, c = {
					codec: "avc1.42001f",
					width: Math.max(2, Math.floor(a.width * t / 2) * 2),
					height: Math.max(2, Math.floor(a.height * t / 2) * 2),
					framerate: 30,
					bitrate: 25e5,
					hardwareAcceleration: "prefer-hardware",
					latencyMode: "realtime",
					avc: { format: "avc" }
				};
				let i = await this.capabilities.video(s, "decode", n.signal), o = await this.capabilities.video(c, "encode", n.signal), l = this.capabilities.playback(`video/mp4; codecs="${c.codec}"`, "mse"), u = this.policy.decide({
					direct: "unsupported",
					path: "mse",
					sourceDecode: i.support,
					candidates: [{
						codec: "avc",
						codecString: c.codec,
						decode: i.support,
						encode: o.support,
						playback: l,
						transport: l,
						preference: "prefer-hardware",
						execution: "unknown"
					}]
				});
				if (u.kind !== "client-transcode") throw Error(`Client recovery unavailable: ${u.reason}`);
			}
			let { Mp4StreamPlayback: l } = await Promise.resolve().then(() => k);
			return await l.open(e, r, t, {
				...n,
				decoderConfig: s,
				encoderConfig: c
			}, this.env);
		} catch (t) {
			throw e.close(), t;
		}
	}
};
export { O as AvcFragmentMuxer, d as BoundedVideoTranscoder, p as CodecNegotiator, S as HardwareAccelerationProbe, u as HttpRangeSource, a as MEDIA_LIMITS, m as MediaCapabilityDetector, g as MediaCodecFailure, M as MediaEngine, _ as MediaFormatInspector, E as Mp4SampleStream, j as Mp4StreamPlayback, x as PhotosHttpAdapter, h as ReceiverMediaSource, w as RuntimePerformanceMonitor, f as TranscodingPolicy, C as WebRTCAdapter, s as abortError, i as cancellable, r as cancellableFrame, v as createProcessedVideoTrack, y as linkAbort, b as measuredSoftware, D as mp4Fragment, o as validNumber, c as waitUntil };

//# sourceMappingURL=index.js.map