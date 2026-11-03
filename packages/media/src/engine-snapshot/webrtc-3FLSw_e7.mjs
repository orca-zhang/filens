import { a as e, i as t, n, o as r, s as i, t as a } from "./defineProperty-BPysVNyd.mjs";
// src/lib/media-engine/capability-detector.ts
var o = class {
	constructor(e = globalThis) {
		a(this, "env", void 0), this.env = e;
	}
	playback(e, t) {
		if (!e) return "unknown";
		try {
			if (t === "mse" || t === "datachannel-file") {
				let t = this.env.ManagedMediaSource || this.env.MediaSource;
				return t?.isTypeSupported && t.isTypeSupported(e) ? "supported" : "unsupported";
			}
			if (t === "webrtc-rtp") return "unknown";
			let n = this.env.nativeSupport ? this.env.nativeSupport(e) : this.env.document?.createElement("video").canPlayType(e);
			return n === "probably" ? "supported" : n === "maybe" ? "unknown" : n === "" ? "unsupported" : "unknown";
		} catch {
			return "unknown";
		}
	}
	async video(e, n, i) {
		i?.throwIfAborted();
		let a = e.hardwareAcceleration || "prefer-hardware", o = {
			support: "unsupported",
			preference: a,
			execution: "unknown"
		}, s = n === "decode" ? this.env.VideoDecoder : this.env.VideoEncoder;
		if (!this.env.isSecureContext || !s?.isConfigSupported) return {
			...o,
			reason: "api-unavailable"
		};
		if (typeof e.codec != "string" || !e.codec.trim() || [
			"width",
			"height",
			"codedWidth",
			"codedHeight",
			"framerate",
			"bitrate"
		].some((t) => e[t] !== void 0 && !r(e[t], 1))) return {
			...o,
			reason: "invalid-configuration"
		};
		if (e.description?.byteLength > 1048576) return {
			...o,
			reason: "configuration-too-large"
		};
		try {
			let n = {
				...e,
				hardwareAcceleration: a
			}, r = await t(s.isConfigSupported(n), i);
			return {
				...o,
				support: r.supported ? "supported" : "unsupported",
				configuration: r.config
			};
		} catch (e) {
			return i?.throwIfAborted(), {
				...o,
				reason: e instanceof Error ? e.message : "configuration-rejected"
			};
		}
	}
	rtp() {
		let e = (e) => {
			try {
				return e?.getCapabilities?.("video")?.codecs || [];
			} catch {
				return [];
			}
		};
		return {
			sender: e(this.env.RTCRtpSender),
			receiver: e(this.env.RTCRtpReceiver)
		};
	}
	async prediction(e, n) {
		n?.throwIfAborted();
		try {
			let r = this.env.navigator?.mediaCapabilities;
			return r?.decodingInfo ? await t(r.decodingInfo(e), n) : null;
		} catch {
			return n?.throwIfAborted(), null;
		}
	}
}, s = new TextDecoder("ascii"), c = /* @__PURE__ */ new Set([
	"moov",
	"trak",
	"mdia",
	"minf",
	"stbl"
]), l = /* @__PURE__ */ new Set([
	"stsz",
	"stz2",
	"stts",
	"ctts",
	"stsc",
	"stco",
	"co64",
	"stss"
]);
function u(e) {
	let t = new DataView(e.buffer, e.byteOffset, e.byteLength), r = 0, i = 0, a = 0, o = (u, d, f) => {
		if (f > 12) throw Error("MP4 metadata nesting budget exceeded");
		for (; u < d;) {
			if (++a > n.indexSamples || d - u < 8) throw Error("Invalid MP4 metadata box");
			let p = s.decode(e.subarray(u + 4, u + 8)), m = t.getUint32(u), h = 8;
			if (m === 1) {
				if (d - u < 16) throw Error("Invalid MP4 box size");
				m = Number(t.getBigUint64(u + 8)), h = 16;
			} else m === 0 && (m = d - u);
			if (!Number.isSafeInteger(m) || m < h || m > d - u) throw Error("Invalid MP4 box size");
			if (p === "cmov") throw Error("Compressed MP4 metadata is unsupported");
			if (p === "trak" && ++i > 16) throw Error("Media track index budget exceeded");
			if (l.has(p)) {
				let e = u + h + (p === "stsz" || p === "stz2" ? 8 : 4);
				if (e + 4 > u + m) throw Error("Truncated MP4 sample table");
				let i = t.getUint32(e);
				if ((p === "stsz" || p === "stz2") && (r += i), i > n.indexSamples || r > n.indexSamples) throw Error("Media index budget exceeded");
			}
			c.has(p) && o(u + h, u + m, f + 1), u += m;
		}
	};
	o(0, e.length, 0);
}
async function d(e, r) {
	let i = [], a = 0, o = 0, c = async (i, o) => {
		if (!Number.isSafeInteger(o) || o <= 0 || a + o > n.metadataBytes) throw Error("Media metadata budget exceeded");
		let s = new Uint8Array(o);
		for (let c = 0; c < o;) {
			let l = Math.min(o - c, n.readBytes), u = await t(e.read(i + c, i + c + l, r), r);
			if (!u.length || u.length > l) throw Error("Truncated MP4 metadata");
			s.set(u, c), c += u.length, a += u.length;
		}
		return s;
	};
	for (let t = 0; t < 4096; t++) {
		let t = await c(o, 8), n = new DataView(t.buffer), r = s.decode(t.subarray(4, 8)), l = n.getUint32(0), d = 8;
		if (l === 1 ? (l = Number(new DataView((await c(o + 8, 8)).buffer).getBigUint64(0)), d = 16) : l || (l = (e.size ?? NaN) - o), !Number.isSafeInteger(l) || l < d || !Number.isSafeInteger(o + l) || e.size !== void 0 && o + l > e.size) throw Error("Invalid MP4 box size");
		if (r === "ftyp" || r === "moov") {
			let e = await c(o, l);
			if (r === "moov" && u(e), i.push({
				offset: o,
				bytes: e
			}), r === "moov") {
				if (!i.some((e) => s.decode(e.bytes.subarray(4, 8)) === "ftyp")) throw Error("Missing MP4 file type");
				return {
					boxes: i,
					readBytes: a
				};
			}
		}
		if (o += l, e.size !== void 0 && o >= e.size) break;
	}
	throw Error("MP4 metadata not found within the box budget");
}
// src/lib/media-engine/format-inspector.ts
var f = class {
	codecFamily(e) {
		return /^(avc1|avc3)/i.test(e) ? "avc" : /^(hvc1|hev1)/i.test(e) ? "hevc" : /^av01/i.test(e) ? "av1" : /^(vp8|vp08)/i.test(e) ? "vp8" : /^(vp9|vp09)/i.test(e) ? "vp9" : "unknown";
	}
	async sniff(e, n) {
		let r = await t(e.read(0, Math.min(e.size ?? 4096, 4096), n), n), i = new TextDecoder().decode(r.subarray(4, 12));
		return i.startsWith("ftyp") ? i.slice(4).startsWith("qt") ? "quicktime" : "mp4" : r[0] === 26 && r[1] === 69 && r[2] === 223 && r[3] === 163 ? new TextDecoder().decode(r).includes("webm") ? "webm" : "matroska" : "unknown";
	}
	async inspect(e, t) {
		return (await this.openMp4(e, t)).format;
	}
	async openMp4(e, t) {
		let r = await this.sniff(e, t);
		if (r !== "mp4" && r !== "quicktime") throw Error(`Container inspection unavailable: ${r}`);
		let i = await d(e, t), { createFile: a, DataStream: o } = await import("./mp4box.all-Bw_Tlr0T.mjs").then((e) => e.t), s = a(!1), c, l;
		s.onReady = (e) => {
			c = e;
		}, s.onError = (e) => {
			l = Error(String(e));
		};
		let u = i.readBytes;
		try {
			let e = 0;
			for (let { bytes: n } of i.boxes) {
				t?.throwIfAborted();
				let r = n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength);
				if (r.fileStart = e, e += n.byteLength, s.appendBuffer(r), l) throw l;
			}
			if (!c) throw Error("Incomplete MP4 metadata");
			let a = c.tracks.map((e) => {
				let t = s.getTrackById(e.id).mdia.minf.stbl.stsd.entries[0], n = t.avcC || t.hvcC || t.vpcC || t.av1C, r;
				if (n) {
					let e = new o();
					n.write(e), r = new Uint8Array(e.buffer.slice(8));
				}
				return {
					id: e.id,
					kind: e.type === "video" || e.type === "audio" ? e.type : [
						"text",
						"subt",
						"sbtl"
					].includes(e.type) ? "text" : "other",
					codec: e.codec,
					family: this.codecFamily(e.codec),
					width: e.video?.width,
					height: e.video?.height,
					sampleRate: e.audio?.sample_rate,
					channels: e.audio?.channel_count,
					timescale: e.timescale,
					duration: e.duration / e.timescale,
					description: r,
					encrypted: !!t.sinf || /^(encv|enca)/.test(e.codec)
				};
			}), d = {
				container: r,
				tracks: a,
				duration: c.duration / c.timescale,
				fragmented: c.isFragmented,
				mime: `video/${r === "quicktime" ? "quicktime" : "mp4"}; codecs="${a.map((e) => e.codec).join(", ")}"`
			};
			if (a.length > 16 || c.tracks.some((e) => e.nb_samples > n.indexSamples)) throw Error("Media track index budget exceeded");
			return s.stop(), {
				file: s,
				movie: c,
				format: d,
				readBytes: u
			};
		} catch (e) {
			throw s.stop(), e;
		}
	}
};
// src/lib/media-engine/codec-negotiator.ts
function p(e) {
	let t = e.performance;
	return !!t && Number.isFinite(t.elapsedMs) && t.elapsedMs >= 1e3 && t.frames >= 15 && Number.isFinite(t.fps) && e.fps > 0 && e.fps <= 15 && t.targetFps >= e.fps && t.targetFps <= 15 && Math.min(t.fps, t.frames * 1e3 / t.elapsedMs) >= t.targetFps * 1.25 && t.codecString === e.codecString && t.width === e.width && t.height === e.height && e.width > 0 && e.height > 0 && e.width <= 640 && e.height <= 360;
}
var m = class {
	select(e, t) {
		return e.filter((e) => e.playback !== "supported" || e.transport !== "supported" || e.decode !== "supported" || e.encode !== "supported" || e.codec === "unknown" || t === "webrtc-rtp" && e.remote !== !0 ? !1 : e.preference !== "prefer-software" && e.execution !== "confirmed-software" || p(e)).map((e, t) => {
			let n = e.preference === "prefer-software" || e.execution === "confirmed-software", r = e.codec === "av1" && e.remote === !0 && e.execution === "confirmed-hardware";
			return {
				candidate: e,
				priority: n ? 10 : r ? 0 : e.codec === "avc" ? 1 : e.codec === "hevc" ? 2 : 3,
				index: t
			};
		}).sort((e, t) => e.priority - t.priority || e.index - t.index)[0]?.candidate;
	}
}, h = class {
	constructor(e = new m()) {
		a(this, "negotiator", void 0), this.negotiator = e;
	}
	decide(e) {
		if (e.failure && e.failure !== "unsupported") return {
			kind: "existing-fallback",
			reason: e.failure
		};
		if (!e.requiresProcessing && e.direct !== "unsupported") return {
			kind: "native-direct",
			reason: "original-playable"
		};
		if (e.preserveTracks === !1) return {
			kind: "existing-fallback",
			reason: "track-preservation-unavailable"
		};
		if (!e.requiresProcessing && e.samplesPlayable) return {
			kind: "remux",
			reason: "preserve-original-samples"
		};
		if (!e.requiresProcessing && e.videoPlayable && e.audioConversionAvailable) return {
			kind: "audio-convert",
			reason: "preserve-original-video"
		};
		if (e.sourceDecode !== "supported") return {
			kind: "existing-fallback",
			reason: "source-decoder-unavailable"
		};
		let t = this.negotiator.select(e.candidates, e.path);
		return t ? {
			kind: "client-transcode",
			candidate: t,
			reason: "compatible-output-required"
		} : {
			kind: "existing-fallback",
			reason: "no-feasible-client-configuration"
		};
	}
}, g = class {
	constructor(e = {}) {
		a(this, "now", void 0), a(this, "limit", void 0), a(this, "started", void 0), a(this, "stages", void 0), a(this, "network", {}), a(this, "queueDepth", 0), a(this, "droppedFrames", 0), a(this, "utilization", null), a(this, "pressure", ""), a(this, "streak", 0), a(this, "healthy", 0), a(this, "lastChange", -Infinity), a(this, "lastObservation", -Infinity), this.now = e.now || (() => performance.now()), this.limit = Math.max(1, Math.min(1024, e.sampleLimit || 256)), this.reset();
	}
	reset() {
		this.started = this.now(), this.stages = {
			decode: {
				frames: 0,
				values: []
			},
			encode: {
				frames: 0,
				values: []
			},
			process: {
				frames: 0,
				values: []
			}
		}, this.network = {}, this.queueDepth = this.droppedFrames = this.streak = this.healthy = 0, this.pressure = "", this.utilization = null, this.lastChange = this.lastObservation = -Infinity;
	}
	record(e, t, n = 1) {
		if (!r(t) || !r(n, 1)) return;
		let i = this.stages[e];
		i.frames += n, i.values.push(t), i.values.length > this.limit && i.values.shift();
	}
	observeQueue(e) {
		r(e) && (this.queueDepth = e);
	}
	observeDropped(e) {
		r(e) && (this.droppedFrames = e);
	}
	observeNetwork(e) {
		for (let t of [
			"rttMs",
			"packetLoss",
			"availableBitrate"
		]) {
			let n = e[t];
			r(n) && (t !== "packetLoss" || n <= 1) ? this.network[t] = n : delete this.network[t];
		}
	}
	observeUtilization(e, t, n) {
		!n || e !== null && (!r(e) || e > 100) || t !== null && (!r(t) || t > 100) || (this.utilization = {
			cpu: e,
			gpu: t,
			source: n
		});
	}
	snapshot() {
		let e = Math.max(0, this.now() - this.started), t = (t) => {
			let n = this.stages[t], r = [...n.values].sort((e, t) => e - t);
			return {
				frames: n.frames,
				samples: r.length,
				fps: e ? n.frames * 1e3 / e : 0,
				averageMs: r.length ? r.reduce((e, t) => e + t, 0) / r.length : 0,
				p95Ms: r.length ? r[Math.ceil(r.length * .95) - 1] : 0
			};
		};
		return {
			elapsedMs: e,
			encode: t("encode"),
			decode: t("decode"),
			process: t("process"),
			encoderQueueDepth: this.queueDepth,
			droppedFrames: this.droppedFrames,
			cpuUsage: this.utilization?.cpu ?? null,
			gpuVideoUtilization: this.utilization?.gpu ?? null,
			utilizationSource: this.utilization?.source ?? null,
			network: {
				rttMs: this.network.rttMs ?? null,
				packetLoss: this.network.packetLoss ?? null,
				availableBitrate: this.network.availableBitrate ?? null
			}
		};
	}
	adapt(e) {
		let t = this.now();
		if (e.active === !1 || !r(e.targetFps, 1)) return this.streak = this.healthy = 0, this.pressure = "", null;
		if (t - this.lastObservation < 500) return null;
		this.lastObservation = t;
		let n = e.networkLimited === !0 || r(e.availableBitrate, 1) && r(e.demandBitrate, 1) && e.availableBitrate < e.demandBitrate * .85 || e.packetLoss > .03, i = e.processingLimited === !0 || e.queueDepth >= 3 || e.processingLimited !== !1 && (e.encodeFps !== void 0 && e.encodeFps < e.targetFps * .85 || e.decodeFps !== void 0 && e.decodeFps < e.targetFps * .85 || e.totalFrames >= 30 && e.droppedFrames / e.totalFrames >= .15), a = n && i ? "mixed" : n ? "network" : i ? "processing" : "";
		return this.streak = a && a === this.pressure ? this.streak + 1 : +!!a, this.pressure = a, this.healthy = a ? 0 : this.healthy + 1, t - this.lastChange < 5e3 ? null : this.streak >= 3 ? (this.streak = 0, this.lastChange = t, {
			direction: "down",
			bottleneck: a,
			bitrateFactor: .8,
			fpsFactor: i ? .8 : 1,
			resolutionFactor: i ? .8 : 1
		}) : this.healthy >= 10 && r(e.encodeFps, e.targetFps) && r(e.decodeFps, e.targetFps) && r(e.availableBitrate, (e.demandBitrate || Infinity) * 1.25) ? (this.healthy = 0, this.lastChange = t, {
			direction: "up",
			bottleneck: "none",
			bitrateFactor: 1.1,
			fpsFactor: 1.1,
			resolutionFactor: 1.1
		}) : null;
	}
}, _ = class extends Error {
	constructor(e, t) {
		super(`${e}: ${t instanceof Error ? t.message : String(t)}`), a(this, "stage", void 0), this.stage = e, this.name = "MediaCodecFailure";
	}
}, v = class {
	constructor(e = globalThis) {
		a(this, "env", void 0), a(this, "controller", void 0), this.env = e;
	}
	close() {
		this.controller?.abort();
	}
	async runWithFallback(e, n) {
		try {
			return await this.run(e);
		} catch (r) {
			e.signal?.throwIfAborted();
			let i = e.encoderConfig, a = e.decoderConfig;
			if (!(r instanceof _) || i.hardwareAcceleration === "prefer-software" || !(a.codedWidth > 0 && a.codedHeight > 0 && a.codedWidth <= 640 && a.codedHeight <= 360) || !p({
				codec: "avc",
				codecString: i.codec,
				playback: "supported",
				transport: "supported",
				decode: "supported",
				encode: "supported",
				preference: "prefer-software",
				execution: "unknown",
				width: i.width,
				height: i.height,
				fps: i.framerate,
				performance: n.softwarePerformance
			})) throw r;
			return await t(n.resetOutput(), e.signal), this.run({
				...e,
				decoderConfig: {
					...e.decoderConfig,
					hardwareAcceleration: "prefer-software"
				},
				encoderConfig: {
					...i,
					hardwareAcceleration: "prefer-software"
				}
			});
		}
	}
	async run(r) {
		if (this.controller) throw Error("Media transcoder is already running");
		let a = this.controller = new AbortController(), s = a.signal, c = () => a.abort(r.signal?.reason);
		r.signal?.addEventListener("abort", c, { once: !0 }), r.signal?.aborted && c();
		let l = new g(), u = new o(this.env), d, f, p, m = /* @__PURE__ */ new Set(), h = /* @__PURE__ */ new Map(), v = /* @__PURE__ */ new Map(), y = Promise.resolve(), b = Promise.resolve(), x = 0, S = 0, C = 0, w = 0, T = 0, E = -Infinity, D = (e) => {
			s.aborted || a.abort(e);
		}, O = r.onMetrics ? setInterval(() => {
			try {
				r.onMetrics(l.snapshot());
			} catch (e) {
				D(e);
			}
		}, 1e3) : void 0;
		try {
			let a = {
				optimizeForLatency: !0,
				...r.decoderConfig
			}, o = await u.video(a, "decode", s), c = await u.video(r.encoderConfig, "encode", s);
			if (o.support !== "supported" || c.support !== "supported") throw new _("configure", "Media codec configuration unsupported");
			f = new this.env.VideoEncoder({
				error: (e) => D(new _("encode", e)),
				output: (e, i) => {
					s.aborted || (l.record("encode", performance.now() - (v.get(e.timestamp) ?? performance.now())), v.delete(e.timestamp), ++w > n.frames || (C += e.byteLength) > n.encodedBytes ? D(/* @__PURE__ */ Error("Encoded output budget exceeded")) : b = b.then(async () => {
						s.throwIfAborted(), await t(r.sink(e, i), s);
					}).catch(D).finally(() => {
						w--, C -= e.byteLength;
					}));
				}
			});
			try {
				f.configure(c.configuration || r.encoderConfig);
			} catch (e) {
				throw new _("configure", e);
			}
			d = new this.env.VideoDecoder({
				error: (e) => D(new _("decode", e)),
				output: (t) => {
					if (s.aborted) {
						t.close();
						return;
					}
					let a = t.allocationSize?.() || t.displayWidth * t.displayHeight * 4;
					l.record("decode", performance.now() - (h.get(t.timestamp) ?? performance.now())), h.delete(t.timestamp), S++, x += a, S > n.frames || x > n.rawFrameBytes ? (S--, x -= a, t.close(), D(/* @__PURE__ */ Error("Decoded frame budget exceeded"))) : (m.add(t), y = y.then(async () => {
						let o = t;
						try {
							if (s.throwIfAborted(), t.timestamp < (r.startTimestamp ?? -Infinity)) return;
							let a = r.encoderConfig.framerate;
							if (a && t.timestamp - E < 1e6 / a - 1) {
								l.observeDropped(++g);
								return;
							}
							let c = performance.now();
							if (r.process && (o = await e(r.process(t, s), s)), o !== t && m.add(o), l.record("process", performance.now() - c), await i(() => f.encodeQueueSize < n.frames && w < n.frames, s), s.throwIfAborted(), v.size >= 128) throw Error("Encoder timestamp budget exceeded");
							v.set(o.timestamp, performance.now()), f.encode(o, { keyFrame: T++ % Math.max(1, Math.round((a || 30) * 2)) === 0 }), E = o.timestamp, l.observeQueue(f.encodeQueueSize);
						} finally {
							o !== t && (o.close(), m.delete(o)), t.close(), m.delete(t), S--, x -= a;
						}
					}).catch(D));
				}
			});
			try {
				d.configure(o.configuration || a);
			} catch (e) {
				throw new _("configure", e);
			}
			let g = 0;
			for (p = r.chunks(s)[Symbol.asyncIterator]();;) {
				let e = await t(p.next(), s);
				if (e.done) break;
				if (await i(() => d.decodeQueueSize < n.frames && h.size + S < n.frames && w < 2, s), e.value.byteLength > n.encodedBytes) throw Error("Encoded input budget exceeded");
				if (h.size >= 128) throw Error("Decoder timestamp budget exceeded");
				h.set(e.value.timestamp, performance.now()), d.decode(e.value);
			}
			return await t(d.flush(), s), await t(y, s), s.throwIfAborted(), await t(f.flush(), s), await t(b, s), s.throwIfAborted(), l.observeQueue(0), l.snapshot();
		} finally {
			clearInterval(O), a.abort(), d && d.state !== "closed" && d.close(), f && f.state !== "closed" && f.close();
			for (let e of m) e.close();
			m.clear(), h.clear(), v.clear(), p?.return && await t(Promise.resolve().then(() => p.return()), void 0, 1e3).catch(() => {}), r.signal?.removeEventListener("abort", c), this.controller = void 0;
		}
	}
}, y = class {
	constructor(e = globalThis) {
		a(this, "env", void 0), this.env = e;
	}
	async run(e, r = {}) {
		let a = new AbortController(), s = a.signal, c = () => a.abort(r.signal?.reason);
		r.signal?.addEventListener("abort", c, { once: !0 }), r.signal?.aborted && c();
		let l = setTimeout(() => a.abort(new DOMException("Codec trial timed out", "TimeoutError")), r.timeoutMs || 1e4), u = new g(), d = await new o(this.env).video(e, "encode", s).catch((e) => {
			throw clearTimeout(l), r.signal?.removeEventListener("abort", c), e;
		}), f, p, m = !1, h = 0, _ = 0, v = Promise.resolve(), y = 0, b = 0, x = /* @__PURE__ */ new Map(), S = /* @__PURE__ */ new Map(), C = (e) => {
			s.aborted || a.abort(e);
		}, w = (e) => ({
			...d,
			execution: "unknown",
			initialized: m,
			completed: !e && h > 0 && _ > 0,
			error: e,
			metrics: u.snapshot()
		});
		try {
			if (d.support !== "supported") return w(d.reason || "configuration-unsupported");
			if (e.width * e.height * 4 > n.rawFrameBytes) return w("Frame budget exceeded");
			if (!this.env.VideoFrame || !this.env.VideoDecoder) return w("Frame or decoder API unavailable");
			let a = this.env.OffscreenCanvas ? new this.env.OffscreenCanvas(e.width, e.height) : this.env.document?.createElement("canvas");
			if (!a) return w("Canvas unavailable");
			a.width = e.width, a.height = e.height, a.getContext?.("2d")?.clearRect(0, 0, e.width, e.height), p = new this.env.VideoDecoder({
				error: C,
				output: (e) => {
					u.record("decode", performance.now() - (S.get(e.timestamp) ?? performance.now())), S.delete(e.timestamp), _++, e.close();
				}
			}), f = new this.env.VideoEncoder({
				error: C,
				output: (t, r) => {
					s.aborted || (u.record("encode", performance.now() - (x.get(t.timestamp) ?? performance.now())), x.delete(t.timestamp), h++, ++y > n.frames || (b += t.byteLength) > n.encodedBytes ? C(/* @__PURE__ */ Error("Probe output budget exceeded")) : v = v.then(async () => {
						if (s.throwIfAborted(), p.state === "unconfigured") {
							if (!r.decoderConfig) throw Error("Encoder omitted decoder configuration");
							let t = {
								...r.decoderConfig,
								optimizeForLatency: !0,
								hardwareAcceleration: e.hardwareAcceleration || "prefer-hardware"
							};
							if ((await new o(this.env).video(t, "decode", s)).support !== "supported") throw Error("Round-trip decoder unsupported");
							p.configure(t);
						}
						if (await i(() => p.decodeQueueSize < n.frames, s), S.size >= 128) throw Error("Probe decoder budget exceeded");
						S.set(t.timestamp, performance.now()), p.decode(t);
					}).catch(C).finally(() => {
						y--, b -= t.byteLength;
					}));
				}
			}), f.configure({
				...e,
				hardwareAcceleration: e.hardwareAcceleration || "prefer-hardware"
			}), m = !0, u.reset();
			let c = e.framerate || 30, l = Math.max(1, Math.min(108e3, r.frames || 60)), g = performance.now(), T = Math.max(0, Math.min(3e4, r.minimumDurationMs || 0)), E = 0;
			for (let e = 0; e < l || performance.now() - g < T; e++) {
				if (e >= 108e3) throw Error("Codec trial frame budget exceeded");
				r.pace && e * 1e3 / c > performance.now() - g && await t(new Promise((t) => setTimeout(t, e * 1e3 / c - (performance.now() - g))), s, r.timeoutMs || 1e4), await i(() => f.encodeQueueSize < 2 && x.size + y < n.frames, s);
				let o = Math.round(e * 1e6 / c);
				if (x.size >= 128) throw Error("Probe encoder budget exceeded");
				r.drawFrame?.(a, e);
				let l = new this.env.VideoFrame(a, {
					timestamp: o,
					duration: Math.round(1e6 / c)
				});
				try {
					x.set(o, performance.now()), f.encode(l, { keyFrame: e === 0 }), E++;
				} finally {
					l.close();
				}
				u.observeQueue(f.encodeQueueSize);
			}
			return await t(f.flush(), s), await t(v, s), s.throwIfAborted(), p.state === "configured" && await t(p.flush(), s), s.throwIfAborted(), u.observeQueue(0), w(h !== E || _ !== E ? "Incomplete codec trial" : void 0);
		} catch (e) {
			if (r.signal?.aborted) throw r.signal.reason;
			return w(e instanceof Error ? e.message : String(e));
		} finally {
			a.abort(), clearTimeout(l), r.signal?.removeEventListener("abort", c), f && f.state !== "closed" && f.close(), p && p.state !== "closed" && p.close(), x.clear(), S.clear();
		}
	}
};
// src/lib/media-engine/adapters/range-source.ts
function b(...e) {
	let t = new AbortController(), n = e.filter(Boolean).map((e) => {
		let n = () => t.abort(e.reason);
		return e.addEventListener("abort", n, { once: !0 }), e.aborted && n(), () => e.removeEventListener("abort", n);
	});
	return {
		controller: t,
		dispose: () => n.forEach((e) => e())
	};
}
var x = class {
	constructor(e, t, n) {
		a(this, "identity", void 0), a(this, "request", void 0), a(this, "nativeUrl", void 0), a(this, "lifetime", new AbortController()), a(this, "revision", void 0), a(this, "total", void 0), this.identity = e, this.request = t, this.nativeUrl = n;
	}
	get size() {
		return this.total;
	}
	async read(e, r, i) {
		if (this.lifetime.signal.throwIfAborted(), i?.throwIfAborted(), !Number.isSafeInteger(e) || !Number.isSafeInteger(r) || e < 0 || r <= e || r - e > n.readBytes) throw Error("HTTP range budget exceeded");
		let a = this.total === void 0 ? r : Math.min(r, this.total);
		if (e >= a) return /* @__PURE__ */ new Uint8Array();
		let o = b(this.lifetime.signal, i);
		try {
			let r = await t(this.request(e, a - 1, o.controller.signal), o.controller.signal), i = (e) => String(typeof r.headers.get == "function" ? r.headers.get(e) || "" : r.headers[e] || ""), s = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(i("content-range"));
			if (r.status !== 206 || !s || Number(s[1]) !== e || Number(s[2]) >= a || Number(s[2]) < e || !Number.isSafeInteger(Number(s[3])) || Number(s[3]) <= Number(s[2])) throw Error("Server ignored or returned invalid Range");
			let c = Number(s[3]), l = i("etag");
			if (this.total !== void 0 && this.total !== c || this.revision !== void 0 && this.revision !== l) throw Error("Media source changed during playback");
			if (!(r.data instanceof ArrayBuffer) || r.data.byteLength !== Number(s[2]) - e + 1 || r.data.byteLength > n.readBytes) throw Error("Invalid Range body length");
			return this.total = c, this.revision = l, new Uint8Array(r.data);
		} finally {
			o.controller.abort(), o.dispose();
		}
	}
	close() {
		this.lifetime.abort();
	}
}, S = class e {
	constructor(e, t, n, r) {
		a(this, "receiver", void 0), a(this, "file", void 0), a(this, "size", void 0), a(this, "options", void 0), a(this, "lifetime", new AbortController()), a(this, "identity", void 0), this.receiver = e, this.file = t, this.size = n, this.options = r, this.identity = `${t.file_id}:${t.version}`;
	}
	static async open(n, r, i, a = {}) {
		let o = n.fileInfo(r, "original", i), s = a.requestTimeoutMs === null ? await o : await t(o, i, a.requestTimeoutMs);
		if (i?.throwIfAborted(), !Number.isSafeInteger(s.size) || s.size <= 0) throw Error("Invalid shared media size");
		return new e(n, { ...r }, s.size, a);
	}
	async read(e, r, i) {
		if (this.lifetime.signal.throwIfAborted(), i?.throwIfAborted(), !Number.isSafeInteger(e) || !Number.isSafeInteger(r) || e < 0 || r <= e || r - e > n.readBytes || r > this.size) throw Error("Shared media range budget exceeded");
		let a = b(this.lifetime.signal, i);
		try {
			let n = this.receiver.read(this.file, e, r, "original", a.controller.signal), i = this.options.requestTimeoutMs === null ? await n : await t(n, a.controller.signal, this.options.requestTimeoutMs);
			if (a.controller.signal.throwIfAborted(), i.byteLength !== r - e) throw Error("Incomplete verified media range");
			return i;
		} finally {
			a.controller.abort(), a.dispose();
		}
	}
	close() {
		this.lifetime.abort();
	}
}, C = class {
	constructor(e = globalThis, t) {
		a(this, "environment", void 0), a(this, "request", void 0), this.environment = e, this.request = t;
	}
	direct(e) {
		if (!e.trim()) throw Error("Empty media URL");
		return {
			...new h().decide({
				direct: "unknown",
				path: "http-file",
				candidates: []
			}),
			url: e
		};
	}
	async source(e) {
		let t = this.environment.location?.origin;
		if (!t) throw Error("Photos source requires a same-origin browser context");
		let n = new URL(e, t), r = /^\/v2\/photos\/preview\/(\d+_original\.bin)$/.exec(n.pathname)?.[1], i = n.pathname === "/v2/photos/preview" ? n.searchParams.get("asset_id") : /^\/v2\/photos\/assets\/(\d+)\/preview$/.exec(n.pathname)?.[1], a = r || (/^[1-9]\d*$/.test(i || "") ? `${i}_original.bin` : "");
		if (n.origin !== t || !a || !this.request) throw Error("Unsupported Photos original resource or missing Range adapter");
		return new x(a, (e, t, n) => this.request(a, e, t, n), e);
	}
}, w = class {
	constructor(e, t, n) {
		a(this, "peer", void 0), a(this, "sender", void 0), a(this, "transceiver", void 0), a(this, "monitor", new g()), a(this, "previous", /* @__PURE__ */ new Map()), a(this, "updating", Promise.resolve()), a(this, "lifetime", new AbortController()), a(this, "timer", void 0), this.peer = e, this.sender = t, this.transceiver = n;
	}
	setCodecPreferences(e, t) {
		if (!this.transceiver?.setCodecPreferences) return !1;
		let n = (e) => {
			let t = e.mimeType.split("/")[1]?.toLowerCase();
			return t === "h264" ? "avc" : t === "h265" ? "hevc" : t;
		}, r = e.filter((e) => t.includes(n(e))).sort((e, r) => t.indexOf(n(e)) - t.indexOf(n(r)));
		if (!r.length) return !1;
		let i = e.filter((e) => /\/(rtx|red|ulpfec|flexfec-03)$/i.test(e.mimeType));
		return this.transceiver.setCodecPreferences([...r, ...i]), !0;
	}
	adjust(e) {
		let n = this.updating.then(async () => {
			this.lifetime.signal.throwIfAborted();
			for (let t of [
				"maxBitrate",
				"maxFramerate",
				"scaleResolutionDownBy"
			]) if (e[t] !== void 0 && !r(e[t], 1)) throw Error("Invalid RTP encoding adjustment");
			let n = this.sender.getParameters();
			n.encodings?.length && (n.encodings = n.encodings.map((t) => ({
				...t,
				...e
			})), await t(this.sender.setParameters(n), this.lifetime.signal));
		});
		return this.updating = n.catch(() => {}), n;
	}
	async sample() {
		let e = await t(this.sender.getStats ? this.sender.getStats() : this.peer.getStats(), this.lifetime.signal), n = /* @__PURE__ */ new Map();
		e.forEach((e) => n.set(e.id, e));
		let i = {};
		for (let e of n.values()) {
			let t = this.previous.get(e.id), a = t ? e.timestamp - t.timestamp : 0;
			if ((e.kind || e.mediaType) === "video" && a > 0) {
				let n = e.type === "outbound-rtp", o = e.type === "inbound-rtp";
				n && e.qualityLimitationReason === "cpu" && (i.processingLimited = !0), n && e.qualityLimitationReason === "bandwidth" && (i.networkLimited = !0, i.processingLimited !== !0 && (i.processingLimited = !1));
				let s = n ? "framesEncoded" : "framesDecoded", c = n ? "totalEncodeTime" : "totalDecodeTime";
				if ((n || o) && r(e[s]) && r(t[s]) && e[s] >= t[s]) {
					let l = e[s] - t[s];
					i[n ? "encodeFps" : "decodeFps"] = l * 1e3 / a, l && r(e[c]) && r(t[c]) && e[c] >= t[c] && this.monitor.record(n ? "encode" : "decode", (e[c] - t[c]) * 1e3 / l, l), o && r(e.framesDropped) && r(t.framesDropped) && e.framesDropped >= t.framesDropped && (i.droppedFrames = e.framesDropped - t.framesDropped, i.totalFrames = l + i.droppedFrames, this.monitor.observeDropped(e.framesDropped));
				}
			}
			if (e.type === "remote-inbound-rtp") {
				let a = n.get(e.localId), o = this.previous.get(e.localId);
				a && o && t && a.packetsSent > o.packetsSent && e.packetsLost >= t.packetsLost && (i.packetLoss = Math.min(1, (e.packetsLost - t.packetsLost) / (a.packetsSent - o.packetsSent))), r(e.roundTripTime) && (i.rttMs = e.roundTripTime * 1e3);
			}
		}
		let a = [...n.values()].find((e) => e.type === "transport" && e.selectedCandidatePairId), o = n.get(a?.selectedCandidatePairId);
		return o?.state === "succeeded" && (r(o.currentRoundTripTime) && (i.rttMs = o.currentRoundTripTime * 1e3), r(o.availableOutgoingBitrate) && (i.availableBitrate = o.availableOutgoingBitrate)), this.previous = n, this.monitor.observeNetwork(i), {
			observation: i,
			metrics: this.monitor.snapshot()
		};
	}
	start(e) {
		if (this.timer) throw Error("RTP monitoring already started");
		let t = async () => {
			try {
				let t = await this.sample();
				e.onSample?.(t);
				let n = this.sender.getParameters().encodings?.[0], r = this.monitor.adapt({
					...t.observation,
					targetFps: n?.maxFramerate || e.targetFps,
					active: e.active ? e.active() : !!this.sender.track && this.sender.track.enabled && this.sender.track.readyState === "live",
					demandBitrate: n?.maxBitrate || e.maxBitrate
				});
				if (r) {
					let t = this.sender.getParameters().encodings?.[0];
					t && await this.adjust({
						maxBitrate: Math.max(64e3, Math.min(e.maxBitrate, (t.maxBitrate || e.maxBitrate) * r.bitrateFactor)),
						maxFramerate: Math.max(5, Math.min(e.targetFps, (t.maxFramerate || e.targetFps) * r.fpsFactor)),
						scaleResolutionDownBy: Math.max(1, Math.min(4, (t.scaleResolutionDownBy || 1) / r.resolutionFactor))
					});
				}
			} catch (t) {
				this.lifetime.signal.aborted || e.onError(t);
			}
			this.lifetime.signal.aborted || (this.timer = setTimeout(t, 1e3));
		};
		this.timer = setTimeout(t, 0);
	}
	close() {
		this.lifetime.abort(), clearTimeout(this.timer), this.previous.clear();
	}
};
function T(r, i) {
	let a = i.environment || globalThis, o = a.MediaStreamTrackProcessor, s = a.VideoTrackGenerator || a.MediaStreamTrackGenerator;
	if (!o || !s) throw Error("Processed video tracks are unavailable in this execution context");
	let c = b(i.signal), l = c.controller.signal, u = new o({
		track: r,
		maxBufferSize: 1
	}), d = a.VideoTrackGenerator ? new s() : new s({ kind: "video" }), f = d.track || d, p = u.readable.getReader(), m = d.writable.getWriter(), h = () => {
		p.cancel().catch(() => {}), m.abort(l.reason).catch(() => {}), f.stop();
	};
	l.addEventListener("abort", h, { once: !0 });
	let g = (async () => {
		try {
			for (l.throwIfAborted();;) {
				let r = await t(p.read(), l);
				if (r.done) break;
				let a = r.value;
				try {
					if (a.displayWidth * a.displayHeight * 4 > n.rawFrameBytes) throw Error("Track frame budget exceeded");
					a = await e(i.transform(r.value, l), l), await t(m.ready, l), await t(m.write(a), l);
				} finally {
					a !== r.value && a.close(), r.value.close();
				}
			}
			await t(m.close(), l);
		} finally {
			c.controller.abort(), l.removeEventListener("abort", h), c.dispose(), await p.cancel().catch(() => {}), p.releaseLock(), await m.abort().catch(() => {}), m.releaseLock(), f.stop();
		}
	})();
	return {
		track: f,
		done: g,
		close: async () => {
			c.controller.abort(), h(), await g.catch(() => {});
		}
	};
}
export { x as a, v as c, h as d, m as f, o as h, S as i, _ as l, f as m, T as n, b as o, p, C as r, y as s, w as t, g as u };

//# sourceMappingURL=webrtc-3FLSw_e7.mjs.map