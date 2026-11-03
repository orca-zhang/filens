// src/lib/media-engine/types.ts
var e = Object.freeze({
	readBytes: 1048576,
	metadataBytes: 16777216,
	indexSamples: 25e4,
	frames: 4,
	rawFrameBytes: 67108864,
	encodedBytes: 8388608,
	bufferAheadSeconds: 8,
	bufferBehindSeconds: 4,
	operationTimeoutMs: 1e4
});
function t() {
	return new DOMException("Media operation cancelled", "AbortError");
}
function n(e, t = 0) {
	return typeof e == "number" && Number.isFinite(e) && e >= t;
}
function r(n, r, i = e.operationTimeoutMs) {
	return r?.aborted ? (Promise.resolve(n).catch(() => {}), Promise.reject(r.reason || t())) : new Promise((e, a) => {
		let o = () => {
			clearTimeout(l), r?.removeEventListener("abort", c);
		}, s = (e, t) => {
			o(), e(t);
		}, c = () => s(a, r?.reason || t()), l = setTimeout(() => s(a, new DOMException("Media operation timed out", "TimeoutError")), i);
		r?.addEventListener("abort", c, { once: !0 }), Promise.resolve(n).then((t) => s(e, t), (e) => s(a, e)), r?.aborted && c();
	});
}
function i(e, t) {
	return r(e.then((e) => (t.aborted && (e.close(), t.throwIfAborted()), e)), t);
}
async function a(t, n, i = e.operationTimeoutMs) {
	let a = performance.now() + i;
	for (; !t();) {
		if (n?.throwIfAborted(), performance.now() >= a) throw new DOMException("Media queue timed out", "TimeoutError");
		await r(new Promise((e) => setTimeout(e, 4)), n, i);
	}
	n?.throwIfAborted();
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/typeof.js
function o(e) {
	"@babel/helpers - typeof";
	return o = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
		return typeof e;
	} : function(e) {
		return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
	}, o(e);
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/toPrimitive.js
function s(e, t) {
	if (o(e) != "object" || !e) return e;
	var n = e[Symbol.toPrimitive];
	if (n !== void 0) {
		var r = n.call(e, t || "default");
		if (o(r) != "object") return r;
		throw TypeError("@@toPrimitive must return a primitive value.");
	}
	return (t === "string" ? String : Number)(e);
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/toPropertyKey.js
function c(e) {
	var t = s(e, "string");
	return o(t) == "symbol" ? t : t + "";
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/defineProperty.js
function l(e, t, n) {
	return (t = c(t)) in e ? Object.defineProperty(e, t, {
		value: n,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[t] = n, e;
}
export { i as a, r as i, e as n, n as o, t as r, a as s, l as t };

//# sourceMappingURL=defineProperty-BPysVNyd.mjs.map