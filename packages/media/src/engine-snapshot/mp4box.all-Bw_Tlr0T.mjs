// \0rolldown/runtime.js
var e = Object.defineProperty, t = (t, n) => {
	let r = {};
	for (var i in t) e(r, i, {
		get: t[i],
		enumerable: !0
	});
	return n || e(r, Symbol.toStringTag, { value: "Module" }), r;
}, n = Object.defineProperty, r = (e, t) => {
	let r = {};
	for (var i in e) n(r, i, {
		get: e[i],
		enumerable: !0
	});
	return t || n(r, Symbol.toStringTag, { value: "Module" }), r;
};
// \0@oxc-project+runtime@0.155.0/helpers/esm/checkPrivateRedeclaration.js
function i(e, t) {
	if (t.has(e)) throw TypeError("Cannot initialize the same private elements twice on an object");
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/classPrivateMethodInitSpec.js
function a(e, t) {
	i(e, t), t.add(e);
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/assertClassBrand.js
function o(e, t, n) {
	if (typeof e == "function" ? e === t : e.has(t)) return arguments.length < 3 ? t : n;
	throw TypeError("Private element is not present on this object");
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/classPrivateFieldInitSpec.js
function s(e, t, n) {
	i(e, t), t.set(e, n);
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/classPrivateFieldGet2.js
function c(e, t) {
	return e.get(o(e, t));
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/classPrivateFieldSet2.js
function l(e, t, n) {
	return e.set(o(e, t), n), n;
}
// node_modules/mp4box/dist/styp-9TIZZDLN.mjs
var u, d, f, p, m, h, g, _, v, y, b, x, S, C, w, T, E, ee, te, ne, re, ie, ae, oe, se, ce, le, ue, de, fe, pe, me, he, ge, _e, ve, ye, be, xe, Se, Ce, we, Te, Ee, De, Oe, ke, Ae, je, Me, Ne, Pe, Fe, Ie, Le, D, Re, ze, Be, Ve, He, Ue, We, Ge, Ke, qe, Je, Ye, Xe, Ze, Qe, $e, et, tt, nt, rt, it, at, ot, st, ct, lt, ut, dt, ft, pt, mt, ht, gt, _t, vt, yt, bt, xt, St, Ct, wt, Tt, Et, Dt, Ot, kt, At, jt, Mt, Nt, Pt, Ft, It, Lt, Rt, zt, Bt, Vt, Ht, Ut, Wt, Gt, Kt, qt, Jt, Yt, Xt, Zt, Qt, $t, en, tn, nn, rn, an, on, sn, cn, ln, un, dn, fn, pn, mn, hn, gn, _n = 2 ** 32, O = 2 ** 32 - 1, vn = 131072, k = class e extends ArrayBuffer {
	constructor(e) {
		super(e), this.fileStart = 0, this.usedBytes = 0;
	}
	static fromArrayBuffer(t, n) {
		let r = new e(t.byteLength);
		return new Uint8Array(r).set(new Uint8Array(t)), r.fileStart = n, r;
	}
}, A = (u = /* @__PURE__ */ new WeakSet(), d = class e {
	constructor(e, t, n) {
		a(this, u), this._byteLength = 0, this.failurePosition = 0, this._dynamicSize = 1, this._byteOffset = t || 0, e instanceof ArrayBuffer ? this.buffer = k.fromArrayBuffer(e, 0) : e instanceof DataView ? (this.dataView = e, t && (this._byteOffset += t)) : this.buffer = new k(e || 0), this.position = 0, this.endianness = n || 1;
	}
	getPosition() {
		return this.position;
	}
	_realloc(e) {
		if (!this._dynamicSize) return;
		let t = this._byteOffset + this.position + e, n = this._buffer.byteLength;
		if (t <= n) {
			t > this._byteLength && (this._byteLength = t);
			return;
		}
		for (n < 1 && (n = 1); t > n;) n *= 2;
		let r = new k(n), i = new Uint8Array(this._buffer);
		new Uint8Array(r, 0, i.length).set(i), this.buffer = r, this._byteLength = t;
	}
	_trimAlloc() {
		if (this._byteLength === this._buffer.byteLength) return;
		let e = new k(this._byteLength), t = new Uint8Array(e), n = new Uint8Array(this._buffer, 0, t.length);
		t.set(n), this.buffer = e;
	}
	get byteLength() {
		return this._byteLength - this._byteOffset;
	}
	get buffer() {
		return this._trimAlloc(), this._buffer;
	}
	set buffer(e) {
		this._buffer = e, this._dataView = new DataView(e, this._byteOffset), this._byteLength = e.byteLength;
	}
	get byteOffset() {
		return this._byteOffset;
	}
	set byteOffset(e) {
		this._byteOffset = e, this._dataView = new DataView(this._buffer, this._byteOffset), this._byteLength = this._buffer.byteLength;
	}
	get dataView() {
		return this._dataView;
	}
	set dataView(e) {
		this._byteOffset = e.byteOffset, this._buffer = k.fromArrayBuffer(e.buffer, 0), this._dataView = new DataView(this._buffer, this._byteOffset), this._byteLength = this._byteOffset + e.byteLength;
	}
	seek(e) {
		let t = Math.max(0, Math.min(this.byteLength, e));
		this.position = isNaN(t) || !isFinite(t) ? 0 : t;
	}
	isEof() {
		return this.position >= this._byteLength;
	}
	mapUint8Array(e) {
		this._realloc(e * 1);
		let t = new Uint8Array(this._buffer, this.byteOffset + this.position, e);
		return this.position += e * 1, t;
	}
	readInt32Array(t, n) {
		t = t === void 0 ? this.byteLength - this.position / 4 : t;
		let r = new Int32Array(t);
		return e.memcpy(r.buffer, 0, this.buffer, this.byteOffset + this.position, t * r.BYTES_PER_ELEMENT), e.arrayToNative(r, n ?? this.endianness), this.position += r.byteLength, r;
	}
	readInt16Array(t, n) {
		t = t === void 0 ? this.byteLength - this.position / 2 : t;
		let r = new Int16Array(t);
		return e.memcpy(r.buffer, 0, this.buffer, this.byteOffset + this.position, t * r.BYTES_PER_ELEMENT), e.arrayToNative(r, n ?? this.endianness), this.position += r.byteLength, r;
	}
	readInt8Array(t) {
		t = t === void 0 ? this.byteLength - this.position : t;
		let n = new Int8Array(t);
		return e.memcpy(n.buffer, 0, this.buffer, this.byteOffset + this.position, t * n.BYTES_PER_ELEMENT), this.position += n.byteLength, n;
	}
	readUint32Array(t, n) {
		t = t === void 0 ? this.byteLength - this.position / 4 : t;
		let r = new Uint32Array(t);
		return e.memcpy(r.buffer, 0, this.buffer, this.byteOffset + this.position, t * r.BYTES_PER_ELEMENT), e.arrayToNative(r, n ?? this.endianness), this.position += r.byteLength, r;
	}
	readUint16Array(t, n) {
		t = t === void 0 ? this.byteLength - this.position / 2 : t;
		let r = new Uint16Array(t);
		return e.memcpy(r.buffer, 0, this.buffer, this.byteOffset + this.position, t * r.BYTES_PER_ELEMENT), e.arrayToNative(r, n ?? this.endianness), this.position += r.byteLength, r;
	}
	readUint8Array(t) {
		t = t === void 0 ? this.byteLength - this.position : t;
		let n = new Uint8Array(t);
		return e.memcpy(n.buffer, 0, this.buffer, this.byteOffset + this.position, t * n.BYTES_PER_ELEMENT), this.position += n.byteLength, n;
	}
	readFloat64Array(t, n) {
		t = t === void 0 ? this.byteLength - this.position / 8 : t;
		let r = new Float64Array(t);
		return e.memcpy(r.buffer, 0, this.buffer, this.byteOffset + this.position, t * r.BYTES_PER_ELEMENT), e.arrayToNative(r, n ?? this.endianness), this.position += r.byteLength, r;
	}
	readFloat32Array(t, n) {
		t = t === void 0 ? this.byteLength - this.position / 4 : t;
		let r = new Float32Array(t);
		return e.memcpy(r.buffer, 0, this.buffer, this.byteOffset + this.position, t * r.BYTES_PER_ELEMENT), e.arrayToNative(r, n ?? this.endianness), this.position += r.byteLength, r;
	}
	readInt32(e) {
		let t = this._dataView.getInt32(this.position, (e ?? this.endianness) === 2);
		return this.position += 4, t;
	}
	readInt16(e) {
		let t = this._dataView.getInt16(this.position, (e ?? this.endianness) === 2);
		return this.position += 2, t;
	}
	readInt8() {
		let e = this._dataView.getInt8(this.position);
		return this.position += 1, e;
	}
	readUint32(e) {
		let t = this._dataView.getUint32(this.position, (e ?? this.endianness) === 2);
		return this.position += 4, t;
	}
	readUint16(e) {
		let t = this._dataView.getUint16(this.position, (e ?? this.endianness) === 2);
		return this.position += 2, t;
	}
	readUint8() {
		let e = this._dataView.getUint8(this.position);
		return this.position += 1, e;
	}
	readFloat32(e) {
		let t = this._dataView.getFloat32(this.position, (e ?? this.endianness) === 2);
		return this.position += 4, t;
	}
	readFloat64(e) {
		let t = this._dataView.getFloat64(this.position, (e ?? this.endianness) === 2);
		return this.position += 8, t;
	}
	static memcpy(e, t, n, r, i) {
		let a = new Uint8Array(e, t, i), o = new Uint8Array(n, r, i);
		a.set(o);
	}
	static arrayToNative(t, n) {
		return n === e.ENDIANNESS ? t : this.flipArrayEndianness(t);
	}
	static nativeToEndian(t, n) {
		return n && e.ENDIANNESS === 2 ? t : this.flipArrayEndianness(t);
	}
	static flipArrayEndianness(e) {
		let t = new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
		for (let n = 0; n < e.byteLength; n += e.BYTES_PER_ELEMENT) for (let r = n + e.BYTES_PER_ELEMENT - 1, i = n; r > i; r--, i++) {
			let e = t[i];
			t[i] = t[r], t[r] = e;
		}
		return e;
	}
	readString(e, t) {
		return t === void 0 || t === "ASCII" ? bn(this.mapUint8Array(e === void 0 ? this.byteLength - this.position : e)) : new TextDecoder(t).decode(this.mapUint8Array(e));
	}
	readCString(e) {
		let t = 0, n = this.byteLength - this.position, r = new Uint8Array(this._buffer, this._byteOffset + this.position), i = e === void 0 ? n : Math.min(e, n);
		for (; t < i && r[t] !== 0; t++);
		let a = bn(this.mapUint8Array(t));
		return e === void 0 ? t !== n && (this.position += 1) : this.position += i - t, a;
	}
	readInt64() {
		return this.readInt32() * _n + this.readUint32();
	}
	readUint64() {
		return this.readUint32() * _n + this.readUint32();
	}
	readUint24() {
		return (this.readUint8() << 16) + (this.readUint8() << 8) + this.readUint8();
	}
	save(e) {
		let t = new Blob([this.buffer]);
		if (typeof window < "u" && typeof document < "u") {
			if (window.URL && URL.createObjectURL) {
				let n = window.URL.createObjectURL(t), r = document.createElement("a");
				document.body.appendChild(r), r.setAttribute("href", n), r.setAttribute("download", e), r.setAttribute("target", "_self"), r.click(), window.URL.revokeObjectURL(n), document.body.removeChild(r);
			} else throw Error("DataStream.save: Can't create object URL.");
		}
		return t;
	}
	get dynamicSize() {
		return this._dynamicSize;
	}
	set dynamicSize(e) {
		e || this._trimAlloc(), this._dynamicSize = e;
	}
	shift(e) {
		let t = new k(this._byteLength - e), n = new Uint8Array(t), r = new Uint8Array(this._buffer, e, n.length);
		n.set(r), this.buffer = t, this.position -= e;
	}
	writeInt32Array(t, n) {
		if (this._realloc(t.length * 4), t instanceof Int32Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapInt32Array(t.length, n);
		else for (let e = 0; e < t.length; e++) this.writeInt32(t[e], n);
	}
	writeInt16Array(t, n) {
		if (this._realloc(t.length * 2), t instanceof Int16Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapInt16Array(t.length, n);
		else for (let e = 0; e < t.length; e++) this.writeInt16(t[e], n);
	}
	writeInt8Array(t) {
		if (this._realloc(t.length * 1), t instanceof Int8Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapInt8Array(t.length);
		else for (let e = 0; e < t.length; e++) this.writeInt8(t[e]);
	}
	writeUint32Array(t, n) {
		if (this._realloc(t.length * 4), t instanceof Uint32Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapUint32Array(t.length, n);
		else for (let e = 0; e < t.length; e++) this.writeUint32(t[e], n);
	}
	writeUint16Array(t, n) {
		if (this._realloc(t.length * 2), t instanceof Uint16Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapUint16Array(t.length, n);
		else for (let e = 0; e < t.length; e++) this.writeUint16(t[e], n);
	}
	writeUint8Array(t) {
		if (this._realloc(t.length * 1), t instanceof Uint8Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapUint8Array(t.length);
		else for (let e = 0; e < t.length; e++) this.writeUint8(t[e]);
	}
	writeFloat64Array(t, n) {
		if (this._realloc(t.length * 8), t instanceof Float64Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapFloat64Array(t.length, n);
		else for (let e = 0; e < t.length; e++) this.writeFloat64(t[e], n);
	}
	writeFloat32Array(t, n) {
		if (this._realloc(t.length * 4), t instanceof Float32Array && this.byteOffset + this.position % t.BYTES_PER_ELEMENT === 0) e.memcpy(this._buffer, this.byteOffset + this.position, t.buffer, 0, t.byteLength), this.mapFloat32Array(t.length, n);
		else for (let e = 0; e < t.length; e++) this.writeFloat32(t[e], n);
	}
	writeInt64(e, t) {
		this._realloc(8), this._dataView.setBigInt64(this.position, BigInt(e), (t ?? this.endianness) === 2), this.position += 8;
	}
	writeInt32(e, t) {
		this._realloc(4), this._dataView.setInt32(this.position, e, (t ?? this.endianness) === 2), this.position += 4;
	}
	writeInt16(e, t) {
		this._realloc(2), this._dataView.setInt16(this.position, e, (t ?? this.endianness) === 2), this.position += 2;
	}
	writeInt8(e) {
		this._realloc(1), this._dataView.setInt8(this.position, e), this.position += 1;
	}
	writeUint32(e, t) {
		this._realloc(4), this._dataView.setUint32(this.position, e, (t ?? this.endianness) === 2), this.position += 4;
	}
	writeUint16(e, t) {
		this._realloc(2), this._dataView.setUint16(this.position, e, (t ?? this.endianness) === 2), this.position += 2;
	}
	writeUint8(e) {
		this._realloc(1), this._dataView.setUint8(this.position, e), this.position += 1;
	}
	writeFloat32(e, t) {
		this._realloc(4), this._dataView.setFloat32(this.position, e, (t ?? this.endianness) === 2), this.position += 4;
	}
	writeFloat64(e, t) {
		this._realloc(8), this._dataView.setFloat64(this.position, e, (t ?? this.endianness) === 2), this.position += 8;
	}
	writeUCS2String(e, t, n) {
		n === void 0 && (n = e.length);
		let r = 0;
		for (; r < e.length && r < n; r++) this.writeUint16(e.charCodeAt(r), t);
		for (; r < n; r++) this.writeUint16(0);
	}
	writeString(e, t, n) {
		let r = 0;
		if (t === void 0 || t === "ASCII") {
			if (n !== void 0) {
				let t = Math.min(e.length, n);
				for (r = 0; r < t; r++) this.writeUint8(e.charCodeAt(r));
				for (; r < n; r++) this.writeUint8(0);
			} else for (r = 0; r < e.length; r++) this.writeUint8(e.charCodeAt(r));
		} else this.writeUint8Array(new TextEncoder(t).encode(e.substring(0, n)));
	}
	writeCString(e, t) {
		let n = 0;
		if (t !== void 0) {
			let r = Math.min(e.length, t);
			for (n = 0; n < r; n++) this.writeUint8(e.charCodeAt(n));
			for (; n < t; n++) this.writeUint8(0);
		} else {
			for (n = 0; n < e.length; n++) this.writeUint8(e.charCodeAt(n));
			this.writeUint8(0);
		}
	}
	writeStruct(e, t) {
		for (let n = 0; n < e.length; n++) {
			let [r, i] = e[n], a = t[r];
			this.writeType(i, a, t);
		}
	}
	writeType(e, t, n) {
		if (typeof e == "function") return e(this, t);
		if (typeof e == "object" && !(e instanceof Array)) return e.set(this, t, n);
		let r, i = "ASCII", a = this.position, s = e;
		if (typeof e == "string" && /:/.test(e)) {
			let t = e.split(":");
			s = t[0], r = parseInt(t[1]);
		}
		if (typeof s == "string" && /,/.test(s)) {
			let e = s.split(",");
			s = e[0], i = e[1];
		}
		switch (s) {
			case "uint8":
				this.writeUint8(t);
				break;
			case "int8":
				this.writeInt8(t);
				break;
			case "uint16":
				this.writeUint16(t, this.endianness);
				break;
			case "int16":
				this.writeInt16(t, this.endianness);
				break;
			case "uint32":
				this.writeUint32(t, this.endianness);
				break;
			case "int32":
				this.writeInt32(t, this.endianness);
				break;
			case "float32":
				this.writeFloat32(t, this.endianness);
				break;
			case "float64":
				this.writeFloat64(t, this.endianness);
				break;
			case "uint16be":
				this.writeUint16(t, 1);
				break;
			case "int16be":
				this.writeInt16(t, 1);
				break;
			case "uint32be":
				this.writeUint32(t, 1);
				break;
			case "int32be":
				this.writeInt32(t, 1);
				break;
			case "float32be":
				this.writeFloat32(t, 1);
				break;
			case "float64be":
				this.writeFloat64(t, 1);
				break;
			case "uint16le":
				this.writeUint16(t, 2);
				break;
			case "int16le":
				this.writeInt16(t, 2);
				break;
			case "uint32le":
				this.writeUint32(t, 2);
				break;
			case "int32le":
				this.writeInt32(t, 2);
				break;
			case "float32le":
				this.writeFloat32(t, 2);
				break;
			case "float64le":
				this.writeFloat64(t, 2);
				break;
			case "cstring":
				this.writeCString(t, r);
				break;
			case "string":
				this.writeString(t, i, r);
				break;
			case "u16string":
				this.writeUCS2String(t, this.endianness, r);
				break;
			case "u16stringle":
				this.writeUCS2String(t, 2, r);
				break;
			case "u16stringbe":
				this.writeUCS2String(t, 1, r);
				break;
			default:
				if (o(u, this, yn).call(this, s)) {
					let [, e] = s;
					for (let n = 0; n < t.length; n++) this.writeType(e, t[n]);
					break;
				}
				this.writeStruct(s, t);
		}
		r && (this.position = a, this._realloc(r), this.position = a + r);
	}
	writeUint64(e) {
		let t = Math.floor(e / _n);
		this.writeUint32(t), this.writeUint32(e | 0);
	}
	writeUint24(e) {
		this.writeUint8((e & 16711680) >> 16), this.writeUint8((e & 65280) >> 8), this.writeUint8(e & 255);
	}
	adjustUint32(e, t) {
		let n = this.position;
		this.seek(e), this.writeUint32(t), this.seek(n);
	}
	readStruct(e) {
		let t = {}, n = this.position;
		for (let r = 0; r < e.length; r += 1) {
			let i = e[r][1], a = this.readType(i, t);
			if (!a) {
				this.failurePosition === 0 && (this.failurePosition = this.position), this.position = n;
				return;
			}
			t[e[r][0]] = a;
		}
		return t;
	}
	readUCS2String(e, t) {
		return String.fromCharCode.apply(void 0, this.readUint16Array(e, t));
	}
	readType(e, t) {
		if (typeof e == "function") return e(this, t);
		if (typeof e == "object" && !(e instanceof Array)) return e.get(this, t);
		if (e instanceof Array && e.length !== 3) return this.readStruct(e);
		let n, r, i = "ASCII", a = this.position, s = e;
		if (typeof s == "string" && /:/.test(s)) {
			let e = s.split(":");
			s = e[0], r = parseInt(e[1]);
		}
		if (typeof s == "string" && /,/.test(s)) {
			let e = s.split(",");
			s = e[0], i = e[1];
		}
		switch (s) {
			case "uint8":
				n = this.readUint8();
				break;
			case "int8":
				n = this.readInt8();
				break;
			case "uint16":
				n = this.readUint16(this.endianness);
				break;
			case "int16":
				n = this.readInt16(this.endianness);
				break;
			case "uint32":
				n = this.readUint32(this.endianness);
				break;
			case "int32":
				n = this.readInt32(this.endianness);
				break;
			case "float32":
				n = this.readFloat32(this.endianness);
				break;
			case "float64":
				n = this.readFloat64(this.endianness);
				break;
			case "uint16be":
				n = this.readUint16(1);
				break;
			case "int16be":
				n = this.readInt16(1);
				break;
			case "uint32be":
				n = this.readUint32(1);
				break;
			case "int32be":
				n = this.readInt32(1);
				break;
			case "float32be":
				n = this.readFloat32(1);
				break;
			case "float64be":
				n = this.readFloat64(1);
				break;
			case "uint16le":
				n = this.readUint16(2);
				break;
			case "int16le":
				n = this.readInt16(2);
				break;
			case "uint32le":
				n = this.readUint32(2);
				break;
			case "int32le":
				n = this.readInt32(2);
				break;
			case "float32le":
				n = this.readFloat32(2);
				break;
			case "float64le":
				n = this.readFloat64(2);
				break;
			case "cstring":
				n = this.readCString(r);
				break;
			case "string":
				n = this.readString(r, i);
				break;
			case "u16string":
				n = this.readUCS2String(r, this.endianness);
				break;
			case "u16stringle":
				n = this.readUCS2String(r, 2);
				break;
			case "u16stringbe":
				n = this.readUCS2String(r, 1);
				break;
			default: if (o(u, this, yn).call(this, s)) {
				let [, e, r] = s, i = typeof r == "function" ? r(t, this, s) : typeof r == "string" && t[r] !== void 0 ? parseInt(t[r]) : typeof r == "number" ? r : r === "*" ? void 0 : parseInt(r);
				if (typeof e == "string") {
					let r = e.replace(/(le|be)$/, ""), a;
					switch (/le$/.test(e) ? a = 2 : /be$/.test(e) && (a = 1), r) {
						case "uint8":
							n = this.readUint8Array(i);
							break;
						case "uint16":
							n = this.readUint16Array(i, a);
							break;
						case "uint32":
							n = this.readUint32Array(i, a);
							break;
						case "int8":
							n = this.readInt8Array(i);
							break;
						case "int16":
							n = this.readInt16Array(i, a);
							break;
						case "int32":
							n = this.readInt32Array(i, a);
							break;
						case "float32":
							n = this.readFloat32Array(i, a);
							break;
						case "float64":
							n = this.readFloat64Array(i, a);
							break;
						case "cstring":
						case "utf16string":
						case "string": if (i) {
							n = Array(i);
							for (let r = 0; r < i; r++) n[r] = this.readType(e, t);
						} else for (n = []; !this.isEof();) {
							let r = this.readType(e, t);
							if (!r) break;
							n.push(r);
						}
					}
				} else if (i) {
					n = Array(i);
					for (let r = 0; r < i; r++) {
						let i = this.readType(e, t);
						if (!i) return;
						n[r] = i;
					}
				} else for (n = [];;) {
					let r = this.position;
					try {
						let i = this.readType(e, t);
						if (!i) {
							this.position = r;
							break;
						}
						n.push(i);
					} catch {
						this.position = r;
						break;
					}
				}
				break;
			}
		}
		return r && (this.position = a + r), n;
	}
	mapInt32Array(t, n) {
		this._realloc(t * 4);
		let r = new Int32Array(this._buffer, this.byteOffset + this.position, t);
		return e.arrayToNative(r, n ?? this.endianness), this.position += t * 4, r;
	}
	mapInt16Array(t, n) {
		this._realloc(t * 2);
		let r = new Int16Array(this._buffer, this.byteOffset + this.position, t);
		return e.arrayToNative(r, n ?? this.endianness), this.position += t * 2, r;
	}
	mapInt8Array(e, t) {
		this._realloc(e * 1);
		let n = new Int8Array(this._buffer, this.byteOffset + this.position, e);
		return this.position += e * 1, n;
	}
	mapUint32Array(t, n) {
		this._realloc(t * 4);
		let r = new Uint32Array(this._buffer, this.byteOffset + this.position, t);
		return e.arrayToNative(r, n ?? this.endianness), this.position += t * 4, r;
	}
	mapUint16Array(t, n) {
		this._realloc(t * 2);
		let r = new Uint16Array(this._buffer, this.byteOffset + this.position, t);
		return e.arrayToNative(r, n ?? this.endianness), this.position += t * 2, r;
	}
	mapFloat64Array(t, n) {
		this._realloc(t * 8);
		let r = new Float64Array(this._buffer, this.byteOffset + this.position, t);
		return e.arrayToNative(r, n ?? this.endianness), this.position += t * 8, r;
	}
	mapFloat32Array(t, n) {
		this._realloc(t * 4);
		let r = new Float32Array(this._buffer, this.byteOffset + this.position, t);
		return e.arrayToNative(r, n ?? this.endianness), this.position += t * 4, r;
	}
}, d.ENDIANNESS = new Int8Array(new Int16Array([1]).buffer)[0] > 0 ? 2 : 1, d);
function yn(e) {
	return Array.isArray(e) && e.length === 3 && e[0] === "[]";
}
function bn(e) {
	let t = [];
	for (let n = 0; n < e.length; n++) t[n] = e[n];
	return String.fromCharCode.apply(void 0, t);
}
var j = /* @__PURE__ */ new Date(), xn = 4, Sn = 3, Cn = 2, wn = 1, M = xn, N = {
	setLogLevel(e) {
		M = e === this.debug ? wn : e === this.info ? Cn : e === this.warn ? Sn : (this.error, xn);
	},
	debug(e, t) {
		console.debug === void 0 && (console.debug = console.log), wn >= M && console.debug("[" + N.getDurationString((/* @__PURE__ */ new Date()).getTime() - j.getTime(), 1e3) + "]", "[" + e + "]", t);
	},
	log(e, t) {
		this.debug(e.msg);
	},
	info(e, t) {
		Cn >= M && console.info("[" + N.getDurationString((/* @__PURE__ */ new Date()).getTime() - j.getTime(), 1e3) + "]", "[" + e + "]", t);
	},
	warn(e, t) {
		Sn >= M && console.warn("[" + N.getDurationString((/* @__PURE__ */ new Date()).getTime() - j.getTime(), 1e3) + "]", "[" + e + "]", t);
	},
	error(e, t, n) {
		n?.onError ? n.onError(e, t) : xn >= M && console.error("[" + N.getDurationString((/* @__PURE__ */ new Date()).getTime() - j.getTime(), 1e3) + "]", "[" + e + "]", t);
	},
	getDurationString(e, t) {
		let n;
		function r(e, t) {
			let n = ("" + e).split(".");
			for (; n[0].length < t;) n[0] = "0" + n[0];
			return n.join(".");
		}
		e < 0 ? (n = !0, e = -e) : n = !1;
		let i = e / (t || 1), a = Math.floor(i / 3600);
		i -= a * 3600;
		let o = Math.floor(i / 60);
		i -= o * 60;
		let s = i * 1e3;
		return i = Math.floor(i), s -= i * 1e3, s = Math.floor(s), (n ? "-" : "") + a + ":" + r(o, 2) + ":" + r(i, 2) + "." + r(s, 3);
	},
	printRanges(e) {
		let t = e.length;
		if (t > 0) {
			let n = "";
			for (let r = 0; r < t; r++) r > 0 && (n += ","), n += "[" + N.getDurationString(e.start(r)) + "," + N.getDurationString(e.end(r)) + "]";
			return n;
		}
		return "(empty)";
	}
};
function Tn(e, t) {
	N.debug("ArrayBuffer", "Trying to create a new buffer of size: " + (e.byteLength + t.byteLength));
	let n = new Uint8Array(e.byteLength + t.byteLength);
	return n.set(new Uint8Array(e), 0), n.set(new Uint8Array(t), e.byteLength), n.buffer;
}
var P = class extends A {
	constructor(e) {
		super(/* @__PURE__ */ new ArrayBuffer(), 0), this.buffers = [], this.bufferIndex = -1, e && (this.insertBuffer(e), this.bufferIndex = 0);
	}
	initialized() {
		if (this.bufferIndex > -1) return !0;
		if (this.buffers.length > 0) {
			let e = this.buffers[0];
			return e.fileStart === 0 ? (this.buffer = e, this.bufferIndex = 0, N.debug("MultiBufferStream", "Stream ready for parsing"), !0) : (N.warn("MultiBufferStream", "The first buffer should have a fileStart of 0"), this.logBufferLevel(), !1);
		}
		return N.warn("MultiBufferStream", "No buffer to start parsing from"), this.logBufferLevel(), !1;
	}
	reduceBuffer(e, t, n) {
		let r = new Uint8Array(n);
		return r.set(new Uint8Array(e, t, n)), r.buffer.fileStart = e.fileStart + t, r.buffer.usedBytes = 0, r.buffer;
	}
	insertBuffer(e) {
		let t = !0, n = 0;
		for (; n < this.buffers.length; n++) {
			let r = this.buffers[n];
			if (e.fileStart <= r.fileStart) {
				if (e.fileStart === r.fileStart) {
					if (e.byteLength > r.byteLength) {
						this.buffers.splice(n, 1), n--;
						continue;
					}
					N.warn("MultiBufferStream", "Buffer (fileStart: " + e.fileStart + " - Length: " + e.byteLength + ") already appended, ignoring");
				} else e.fileStart + e.byteLength <= r.fileStart || (e = this.reduceBuffer(e, 0, r.fileStart - e.fileStart)), N.debug("MultiBufferStream", "Appending new buffer (fileStart: " + e.fileStart + " - Length: " + e.byteLength + ")"), this.buffers.splice(n, 0, e), n === 0 && (this.buffer = e);
				t = !1;
				break;
			}
			if (e.fileStart < r.fileStart + r.byteLength) {
				let n = r.fileStart + r.byteLength - e.fileStart, i = e.byteLength - n;
				if (i > 0) e = this.reduceBuffer(e, n, i);
				else {
					t = !1;
					break;
				}
			}
		}
		t && (N.debug("MultiBufferStream", "Appending new buffer (fileStart: " + e.fileStart + " - Length: " + e.byteLength + ")"), this.buffers.push(e), n === 0 && (this.buffer = e));
	}
	logBufferLevel(e) {
		let t = [], n = "", r, i = 0, a = 0;
		for (let e = 0; e < this.buffers.length; e++) {
			let o = this.buffers[e];
			e === 0 ? (r = {
				start: o.fileStart,
				end: o.fileStart + o.byteLength
			}, t.push(r), n += "[" + r.start + "-") : r.end === o.fileStart ? r.end = o.fileStart + o.byteLength : (r = {
				start: o.fileStart,
				end: o.fileStart + o.byteLength
			}, n += t[t.length - 1].end - 1 + "], [" + r.start + "-", t.push(r)), i += o.usedBytes, a += o.byteLength;
		}
		t.length > 0 && (n += r.end - 1 + "]");
		let o = e ? N.info : N.debug;
		this.buffers.length === 0 ? o("MultiBufferStream", "No more buffer in memory") : o("MultiBufferStream", "" + this.buffers.length + " stored buffer(s) (" + i + "/" + a + " bytes), continuous ranges: " + n);
	}
	cleanBuffers() {
		for (let e = 0; e < this.buffers.length; e++) {
			let t = this.buffers[e];
			t.usedBytes === t.byteLength && (N.debug("MultiBufferStream", "Removing buffer #" + e), this.buffers.splice(e, 1), e--);
		}
	}
	mergeNextBuffer() {
		if (this.bufferIndex + 1 < this.buffers.length) {
			let e = this.buffers[this.bufferIndex + 1];
			if (e.fileStart === this.buffer.fileStart + this.buffer.byteLength) {
				let t = this.buffer.byteLength, n = this.buffer.usedBytes, r = this.buffer.fileStart;
				return this.buffers[this.bufferIndex] = Tn(this.buffer, e), this.buffer = this.buffers[this.bufferIndex], this.buffers.splice(this.bufferIndex + 1, 1), this.buffer.usedBytes = n, this.buffer.fileStart = r, N.debug("ISOFile", "Concatenating buffer for box parsing (length: " + t + "->" + this.buffer.byteLength + ")"), !0;
			}
			return !1;
		}
		return !1;
	}
	findPosition(e, t, n) {
		let r = -1, i = e === !0 ? 0 : this.bufferIndex;
		for (; i < this.buffers.length;) {
			let e = this.buffers[i];
			if (e && e.fileStart <= t) r = i, n && (e.usedBytes = e.fileStart + e.byteLength <= t ? e.byteLength : t - e.fileStart, this.logBufferLevel());
			else break;
			i++;
		}
		if (r === -1) return -1;
		let a = this.buffers[r];
		return a.fileStart + a.byteLength >= t ? (N.debug("MultiBufferStream", "Found position in existing buffer #" + r), r) : -1;
	}
	findEndContiguousBuf(e) {
		let t = e === void 0 ? this.bufferIndex : e, n = this.buffers[t];
		if (this.buffers.length > t + 1) for (let e = t + 1; e < this.buffers.length; e++) {
			let t = this.buffers[e];
			if (t.fileStart === n.fileStart + n.byteLength) n = t;
			else break;
		}
		return n.fileStart + n.byteLength;
	}
	getEndFilePositionAfter(e) {
		let t = this.findPosition(!0, e, !1);
		return t === -1 ? e : this.findEndContiguousBuf(t);
	}
	addUsedBytes(e) {
		this.buffer.usedBytes += e, this.logBufferLevel();
	}
	setAllUsedBytes() {
		this.buffer.usedBytes = this.buffer.byteLength, this.logBufferLevel();
	}
	seek(e, t, n) {
		let r = this.findPosition(t, e, n);
		return r === -1 ? (N.debug("MultiBufferStream", "Position " + e + " not found in buffered data"), !1) : (this.buffer = this.buffers[r], this.bufferIndex = r, this.position = e - this.buffer.fileStart, N.debug("MultiBufferStream", "Repositioning parser at buffer position: " + this.position), !0);
	}
	getPosition() {
		return this.bufferIndex === -1 || this.buffers[this.bufferIndex] === void 0 ? 0 : this.buffers[this.bufferIndex].fileStart + this.position;
	}
	getLength() {
		return this.byteLength;
	}
	getEndPosition() {
		return this.bufferIndex === -1 || this.buffers[this.bufferIndex] === void 0 ? 0 : this.buffers[this.bufferIndex].fileStart + this.byteLength;
	}
	getAbsoluteEndPosition() {
		if (this.buffers.length === 0) return 0;
		let e = this.buffers[this.buffers.length - 1];
		return e.fileStart + e.byteLength;
	}
}, F = (f = /* @__PURE__ */ new WeakMap(), p = class {
	get type() {
		return this.constructor.fourcc ?? c(f, this);
	}
	set type(e) {
		l(f, this, e);
	}
	constructor(e = 0) {
		s(this, f, void 0), this.size = e;
	}
	addBox(e) {
		return this.boxes || (this.boxes = []), this.boxes.push(e), this[e.type + "s"] ? this[e.type + "s"].push(e) : this[e.type] = e, e;
	}
	set(e, t) {
		return this[e] = t, this;
	}
	addEntry(e, t) {
		let n = t || "entries";
		return this[n] || (this[n] = []), this[n].push(e), this;
	}
	writeHeader(e, t) {
		if (this.size += 8, (this.size > O || this.original_size === 1) && (this.size += 8), this.type === "uuid" && (this.size += 16), N.debug("BoxWriter", "Writing box " + this.type + " of size: " + this.size + " at position " + e.getPosition() + (t || "")), this.original_size === 0 ? e.writeUint32(0) : this.size > O || this.original_size === 1 ? e.writeUint32(1) : (this.sizePosition = e.getPosition(), e.writeUint32(this.size)), e.writeString(this.type, void 0, 4), this.type === "uuid") {
			let t = /* @__PURE__ */ new Uint8Array(16);
			for (let e = 0; e < 16; e++) t[e] = parseInt(this.uuid.substring(e * 2, e * 2 + 2), 16);
			e.writeUint8Array(t);
		}
		(this.size > O || this.original_size === 1) && (this.sizePosition = e.getPosition(), e.writeUint64(this.size));
	}
	write(e) {
		if (this.type === "mdat") {
			let t = this;
			if (t.stream) {
				this.size = t.stream.getAbsoluteEndPosition(), this.writeHeader(e);
				for (let n of t.stream.buffers) {
					let t = new Uint8Array(n);
					e.writeUint8Array(t);
				}
			} else t.data && (this.size = t.data.length, this.writeHeader(e), e.writeUint8Array(t.data));
		} else this.size = this.data ? this.data.length : 0, this.writeHeader(e), this.data && e.writeUint8Array(this.data);
	}
	printHeader(e) {
		this.size += 8, this.size > O && (this.size += 8), this.type === "uuid" && (this.size += 16), e.log(e.indent + "size:" + this.size), e.log(e.indent + "type:" + this.type);
	}
	print(e) {
		this.printHeader(e);
	}
	parse(e) {
		this.type === "mdat" ? this.size === 0 ? e.seek(e.getEndPosition()) : e.seek(this.start + this.size) : this.data = e.readUint8Array(this.size - this.hdr_size);
	}
	parseDataAndRewind(e) {
		this.data = e.readUint8Array(this.size - this.hdr_size), e.seek(this.start + this.hdr_size);
	}
	parseLanguage(e) {
		this.language = e.readUint16();
		let t = [];
		t[0] = this.language >> 10 & 31, t[1] = this.language >> 5 & 31, t[2] = this.language & 31, this.languageString = String.fromCharCode(t[0] + 96, t[1] + 96, t[2] + 96);
	}
	computeSize(e) {
		let t = e || new P();
		this.write(t);
	}
	isEndOfBox(e) {
		return e.getPosition() === this.start + this.size;
	}
}, p.registryId = Symbol.for("BoxIdentifier"), p), I = class extends F {
	constructor(...e) {
		super(...e), this.flags = 0, this.version = 0;
	}
	writeHeader(e) {
		this.size += 4, super.writeHeader(e, " v=" + this.version + " f=" + this.flags), e.writeUint8(this.version), e.writeUint24(this.flags);
	}
	printHeader(e) {
		this.size += 4, super.printHeader(e), e.log(e.indent + "version:" + this.version), e.log(e.indent + "flags:" + this.flags);
	}
	parseDataAndRewind(e) {
		this.parseFullHeader(e), this.data = e.readUint8Array(this.size - this.hdr_size), this.hdr_size -= 4, e.seek(this.start + this.hdr_size);
	}
	parseFullHeader(e) {
		this.version = e.readUint8(), this.flags = e.readUint24(), this.hdr_size += 4;
	}
	parse(e) {
		this.parseFullHeader(e), this.data = e.readUint8Array(this.size - this.hdr_size);
	}
}, L = (m = class {
	constructor(e) {
		this.grouping_type = e;
	}
	write(e) {
		e.writeUint8Array(this.data);
	}
	parse(e) {
		N.warn("BoxParser", `Unknown sample group type: '${this.grouping_type}'`), this.data = e.readUint8Array(this.description_length);
	}
}, m.registryId = Symbol.for("SampleGroupEntryIdentifier"), m), En = class extends I {
	parse(e) {
		this.parseFullHeader(e), this.track_group_id = e.readUint32();
	}
}, Dn = class extends F {
	constructor(e, t, n, r, i) {
		super(t), this.box_name = n, this.hdr_size = r, this.start = i, this.type = e;
	}
	parse(e) {
		this.from_item_ID = e.readUint16();
		let t = e.readUint16();
		this.references = [];
		for (let n = 0; n < t; n++) this.references[n] = { to_item_ID: e.readUint16() };
	}
}, On = class extends F {
	constructor(e, t, n, r, i) {
		super(t), this.box_name = n, this.hdr_size = r, this.start = i, this.type = e;
	}
	parse(e) {
		this.from_item_ID = e.readUint32();
		let t = e.readUint16();
		this.references = [];
		for (let n = 0; n < t; n++) this.references[n] = { to_item_ID: e.readUint32() };
	}
}, kn = class extends F {
	constructor(e, t, n, r) {
		super(t), this.hdr_size = n, this.start = r, this.type = e;
	}
	parse(e) {
		this.track_ids = e.readUint32Array((this.size - this.hdr_size) / 4);
	}
	write(e) {
		this.size = this.track_ids.length * 4, this.writeHeader(e), e.writeUint32Array(this.track_ids);
	}
}, An = [
	"boxes",
	"entries",
	"references",
	"subsamples",
	"items",
	"item_infos",
	"extents",
	"associations",
	"subsegments",
	"ranges",
	"seekLists",
	"seekPoints",
	"esd",
	"levels"
], jn = [
	"compatible_brands",
	"matrix",
	"opcolor",
	"sample_counts",
	"sample_deltas",
	"first_chunk",
	"samples_per_chunk",
	"sample_sizes",
	"chunk_offsets",
	"sample_offsets",
	"sample_description_index",
	"sample_duration"
];
function Mn(e, t) {
	if (e && !t) return !1;
	let n;
	for (n in e) if (An.find((e) => e === n)) continue;
	else if (e[n] instanceof F || t[n] instanceof F) continue;
	else if (e[n] === void 0 || t[n] === void 0) continue;
	else if (typeof e[n] == "function" || typeof t[n] == "function") continue;
	else if ("subBoxNames" in e && e.subBoxNames.indexOf(n.slice(0, 4)) > -1 || "subBoxNames" in t && t.subBoxNames.indexOf(n.slice(0, 4)) > -1) continue;
	else if (n === "data" || n === "start" || n === "size" || n === "creation_time" || n === "modification_time") continue;
	else if (jn.find((e) => e === n)) continue;
	else if (e[n] !== t[n]) return !1;
	return !0;
}
function Nn(e, t) {
	if (!Mn(e, t)) return !1;
	for (let n = 0; n < An.length; n++) {
		let r = An[n];
		if (e[r] && t[r] && !Nn(e[r], t[r])) return !1;
	}
	return !0;
}
function Pn(e) {
	let t = e;
	for (; t;) {
		if ("registryId" in t) return t.registryId;
		t = Object.getPrototypeOf(t);
	}
}
var Fn = (e) => {
	let t = Symbol.for("SampleGroupEntryIdentifier");
	return Pn(e) === t;
}, In = (e) => {
	let t = Symbol.for("SampleEntryIdentifier");
	return Pn(e) === t;
}, Ln = (e) => {
	let t = Symbol.for("BoxIdentifier");
	return Pn(e) === t;
}, R = {
	uuid: {},
	sampleEntry: {},
	sampleGroupEntry: {},
	box: {}
};
function Rn(e) {
	let t = {
		uuid: {},
		sampleEntry: {},
		sampleGroupEntry: {},
		box: {}
	};
	for (let [n, r] of Object.entries(e)) if (Fn(r)) {
		let e = "grouping_type" in r ? r.grouping_type : void 0;
		if (!e) throw Error(`SampleGroupEntry class ${n} does not have a valid static grouping_type. Please ensure it is defined correctly.`);
		if (e in t.sampleGroupEntry) throw Error(`SampleGroupEntry class ${n} has a grouping_type that is already registered. Please ensure it is unique.`);
		t.sampleGroupEntry[e] = r;
	} else if (In(r)) {
		let e = "fourcc" in r ? r.fourcc : void 0;
		if (!e) throw Error(`SampleEntry class ${n} does not have a valid static fourcc. Please ensure it is defined correctly.`);
		if (e in t.sampleEntry) throw Error(`SampleEntry class ${n} has a fourcc that is already registered. Please ensure it is unique.`);
		t.sampleEntry[e] = r;
	} else if (Ln(r)) {
		let e = "fourcc" in r ? r.fourcc : void 0, i = "uuid" in r ? r.uuid : void 0;
		if (e === "uuid") {
			if (!i) throw Error(`Box class ${n} has a fourcc of 'uuid' but does not have a valid uuid. Please ensure it is defined correctly.`);
			if (i in t.uuid) throw Error(`Box class ${n} has a uuid that is already registered. Please ensure it is unique.`);
			t.uuid[i] = r;
			continue;
		}
		t.box[e] = r;
	} else throw Error(`Box class ${n} does not have a valid static fourcc, uuid, or grouping_type. Please ensure it is defined correctly.`);
	return R.uuid = { ...t.uuid }, R.sampleEntry = { ...t.sampleEntry }, R.sampleGroupEntry = { ...t.sampleGroupEntry }, R.box = { ...t.box }, R;
}
var z = {};
function zn(e) {
	return Object.entries(e).forEach(([e, t]) => z[e] = t), z;
}
function Bn(e) {
	return B(e);
}
function B(e) {
	let t = "";
	for (let n = 0; n < 16; n++) {
		let n = e.readUint8().toString(16);
		t += n.length === 1 ? "0" + n : n;
	}
	return t;
}
function V(e, t, n) {
	let r, i, a = e.getPosition(), o = 0, s;
	if (e.getEndPosition() - a < 8) return N.debug("BoxParser", "Not enough data in stream to parse the type and size of the box"), { code: 0 };
	if (n && n < 8) return N.debug("BoxParser", "Not enough bytes left in the parent box to parse a new box"), { code: 0 };
	let c = e.readUint32(), l = e.readString(4);
	if (l.length !== 4 || !/^[\x20-\x7E]{4}$/.test(l)) return N.error("BoxParser", `Invalid box type: '${l}'`), {
		code: -1,
		start: a,
		type: l
	};
	let u = l;
	if (N.debug("BoxParser", "Found box of type '" + l + "' and size " + c + " at position " + a), o = 8, l === "uuid") {
		if (e.getEndPosition() - e.getPosition() < 16 || n - o < 16) return e.seek(a), N.debug("BoxParser", "Not enough bytes left in the parent box to parse a UUID box"), { code: 0 };
		s = Bn(e), o += 16, u = s;
	}
	if (c === 1) {
		if (e.getEndPosition() - e.getPosition() < 8 || n && n - o < 8) return e.seek(a), N.warn("BoxParser", "Not enough data in stream to parse the extended size of the \"" + l + "\" box"), { code: 0 };
		i = c, c = e.readUint64(), o += 8;
	} else if (c === 0) {
		if (n) c = n;
		else if (l !== "mdat") return N.error("BoxParser", "Unlimited box size not supported for type: '" + l + "'"), r = new F(c), r.type = l, {
			code: 1,
			box: r,
			size: r.size
		};
		else c = e.getEndPosition() - a;
	}
	if (c !== 0 && c < o) return N.error("BoxParser", "Box of type " + l + " has an invalid size " + c + " (too small to be a box)"), {
		code: 0,
		type: l,
		size: c,
		hdr_size: o,
		start: a
	};
	if (c !== 0 && n && c > n) return N.error("BoxParser", "Box of type '" + l + "' has a size " + c + " greater than its container size " + n), {
		code: 0,
		type: l,
		size: c,
		hdr_size: o,
		start: a
	};
	if (c !== 0 && a + c > e.getEndPosition()) return e.seek(a), N.info("BoxParser", "Not enough data in stream to parse the entire '" + l + "' box"), {
		code: 0,
		type: l,
		size: c,
		hdr_size: o,
		start: a,
		original_size: i
	};
	if (t) return {
		code: 1,
		type: l,
		size: c,
		hdr_size: o,
		start: a
	};
	l in R.box ? r = new R.box[l](c) : l === "uuid" ? s in R.uuid ? r = new R.uuid[s](c) : (N.warn("BoxParser", `Unknown UUID box type: '${s}'`), r = new F(c), r.type = l, r.uuid = s, r.has_unparsed_data = !0) : (N.warn("BoxParser", `Unknown box type: '${l}'`), r = new F(c), r.type = l, r.has_unparsed_data = !0), r.original_size = i, r.hdr_size = o, r.start = a, r.write === F.prototype.write && r.type !== "mdat" && (N.info("BoxParser", "'" + u + "' box writing not yet implemented, keeping unparsed data in memory for later write"), r.parseDataAndRewind(e)), r.parse(e);
	let d = e.getPosition() - (r.start + r.size);
	return d < 0 ? (N.warn("BoxParser", "Parsing of box '" + u + "' did not read the entire indicated box data size (missing " + -d + " bytes), seeking forward"), e.seek(r.start + r.size)) : d > 0 && r.size !== 0 && (N.error("BoxParser", "Parsing of box '" + u + "' read " + d + " more bytes than the indicated box data size, seeking backwards"), e.seek(r.start + r.size)), {
		code: 1,
		box: r,
		size: r.size
	};
}
var H = class extends F {
	write(e) {
		if (this.size = 0, this.writeHeader(e), this.boxes) for (let t = 0; t < this.boxes.length; t++) this.boxes[t] && (this.boxes[t].write(e), this.size += this.boxes[t].size);
		N.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size), e.adjustUint32(this.sizePosition, this.size);
	}
	print(e) {
		this.printHeader(e);
		for (let t = 0; t < this.boxes.length; t++) if (this.boxes[t]) {
			let n = e.indent;
			e.indent += " ", this.boxes[t].print(e), e.indent = n;
		}
	}
	parse(e) {
		let t;
		for (; e.getPosition() < this.start + this.size;) if (t = V(e, !1, this.size - (e.getPosition() - this.start)), t.code === 1) {
			let e = t.box;
			if (this.boxes || (this.boxes = []), this.boxes.push(e), this.subBoxNames && this.subBoxNames.indexOf(e.type) !== -1) {
				let t = this.subBoxNames[this.subBoxNames.indexOf(e.type)] + "s";
				this[t] || (this[t] = []), this[t].push(e);
			} else {
				let t = e.type === "uuid" ? e.uuid : e.type;
				this[t] ? N.warn("ContainerBox", `Box of type ${t} already exists in container box ${this.type}.`) : this[t] = e;
			}
		} else return;
	}
}, U = (h = class extends H {
	constructor(e, t, n) {
		super(e), this.hdr_size = t, this.start = n;
	}
	isVideo() {
		return !1;
	}
	isAudio() {
		return !1;
	}
	isSubtitle() {
		return !1;
	}
	isMetadata() {
		return !1;
	}
	isHint() {
		return !1;
	}
	getCodec() {
		return this.type.replace(".", "");
	}
	getWidth() {
		return "";
	}
	getHeight() {
		return "";
	}
	getChannelCount() {
		return "";
	}
	getSampleRate() {
		return "";
	}
	getSampleSize() {
		return "";
	}
	parseHeader(e) {
		e.readUint8Array(6), this.data_reference_index = e.readUint16(), this.hdr_size += 8;
	}
	parse(e) {
		this.parseHeader(e), this.data = e.readUint8Array(this.size - this.hdr_size);
	}
	parseDataAndRewind(e) {
		this.parseHeader(e), this.data = e.readUint8Array(this.size - this.hdr_size), this.hdr_size -= 8, e.seek(this.start + this.hdr_size);
	}
	parseFooter(e) {
		super.parse(e);
	}
	writeHeader(e) {
		this.size = 8, super.writeHeader(e), e.writeUint8(0), e.writeUint8(0), e.writeUint8(0), e.writeUint8(0), e.writeUint8(0), e.writeUint8(0), e.writeUint16(this.data_reference_index);
	}
	writeFooter(e) {
		if (this.boxes) for (let t = 0; t < this.boxes.length; t++) this.boxes[t].write(e), this.size += this.boxes[t].size;
		N.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size), e.adjustUint32(this.sizePosition, this.size);
	}
	write(e) {
		this.writeHeader(e), e.writeUint8Array(this.data), this.size += this.data.length, N.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size), e.adjustUint32(this.sizePosition, this.size);
	}
}, h.registryId = Symbol.for("SampleEntryIdentifier"), h), Vn = class extends U {}, W = class extends U {
	isMetadata() {
		return !0;
	}
}, G = class extends U {
	isSubtitle() {
		return !0;
	}
}, Hn = class extends U {}, K = class extends U {
	parse(e) {
		this.parseHeader(e), e.readUint16(), e.readUint16(), e.readUint32Array(3), this.width = e.readUint16(), this.height = e.readUint16(), this.horizresolution = e.readUint32(), this.vertresolution = e.readUint32(), e.readUint32(), this.frame_count = e.readUint16();
		let t = Math.min(31, e.readUint8());
		this.compressorname = e.readString(t), t < 31 && e.readString(31 - t), this.depth = e.readUint16(), e.readUint16(), this.parseFooter(e);
	}
	isVideo() {
		return !0;
	}
	getWidth() {
		return this.width;
	}
	getHeight() {
		return this.height;
	}
	write(e) {
		this.writeHeader(e), this.size += 70, e.writeUint16(0), e.writeUint16(0), e.writeUint32(0), e.writeUint32(0), e.writeUint32(0), e.writeUint16(this.width), e.writeUint16(this.height), e.writeUint32(this.horizresolution), e.writeUint32(this.vertresolution), e.writeUint32(0), e.writeUint16(this.frame_count), e.writeUint8(Math.min(31, this.compressorname.length)), e.writeString(this.compressorname, void 0, 31), e.writeUint16(this.depth), e.writeInt16(-1), this.writeFooter(e);
	}
}, q = class extends U {
	parse(e) {
		this.parseHeader(e), this.version = e.readUint16(), e.readUint16(), e.readUint32(), this.channel_count = e.readUint16(), this.samplesize = e.readUint16(), e.readUint16(), e.readUint16(), this.samplerate = e.readUint32() / 65536, e.isofile?.ftyp?.major_brand.includes("qt") && (this.version === 1 ? this.extensions = e.readUint8Array(16) : this.version === 2 && (this.extensions = e.readUint8Array(36))), this.parseFooter(e);
	}
	isAudio() {
		return !0;
	}
	getChannelCount() {
		return this.channel_count;
	}
	getSampleRate() {
		return this.samplerate;
	}
	getSampleSize() {
		return this.samplesize;
	}
	write(e) {
		this.writeHeader(e), this.size += 20, e.writeUint32(0), e.writeUint32(0), e.writeUint16(this.channel_count), e.writeUint16(this.samplesize), e.writeUint16(0), e.writeUint16(0), e.writeUint32(this.samplerate << 16), this.writeFooter(e);
	}
}, Un = class extends U {
	parse(e) {
		this.parseHeader(e), this.parseFooter(e);
	}
	write(e) {
		this.writeHeader(e), this.writeFooter(e);
	}
}, Wn = class extends Array {
	toString() {
		let e = "<table class='inner-table'>";
		e += "<thead><tr><th>length</th><th>nalu_data</th></tr></thead>", e += "<tbody>";
		for (let t = 0; t < this.length; t++) {
			let n = this[t];
			e += "<tr>", e += "<td>" + n.length + "</td>", e += "<td>", e += n.data.reduce(function(e, t) {
				return e + t.toString(16).padStart(2, "0");
			}, "0x"), e += "</td></tr>";
		}
		return e += "</tbody></table>", e;
	}
}, Gn = (g = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "AVCConfigurationBox";
	}
	parse(e) {
		this.configurationVersion = e.readUint8(), this.AVCProfileIndication = e.readUint8(), this.profile_compatibility = e.readUint8(), this.AVCLevelIndication = e.readUint8(), this.lengthSizeMinusOne = e.readUint8() & 3, this.nb_SPS_nalus = e.readUint8() & 31;
		let t = this.size - this.hdr_size - 6;
		this.SPS = new Wn();
		for (let n = 0; n < this.nb_SPS_nalus; n++) {
			let n = e.readUint16();
			this.SPS.push({
				length: n,
				data: e.readUint8Array(n)
			}), t -= 2 + n;
		}
		this.nb_PPS_nalus = e.readUint8(), t--, this.PPS = new Wn();
		for (let n = 0; n < this.nb_PPS_nalus; n++) {
			let n = e.readUint16();
			this.PPS.push({
				length: n,
				data: e.readUint8Array(n)
			}), t -= 2 + n;
		}
		t > 0 && (this.ext = e.readUint8Array(t));
	}
	write(e) {
		this.size = 7;
		for (let e = 0; e < this.SPS.length; e++) this.size += 2 + this.SPS[e].length;
		for (let e = 0; e < this.PPS.length; e++) this.size += 2 + this.PPS[e].length;
		this.ext && (this.size += this.ext.length), this.writeHeader(e), e.writeUint8(this.configurationVersion), e.writeUint8(this.AVCProfileIndication), e.writeUint8(this.profile_compatibility), e.writeUint8(this.AVCLevelIndication), e.writeUint8(this.lengthSizeMinusOne + 252), e.writeUint8(this.SPS.length + 224);
		for (let t = 0; t < this.SPS.length; t++) e.writeUint16(this.SPS[t].length), e.writeUint8Array(this.SPS[t].data);
		e.writeUint8(this.PPS.length);
		for (let t = 0; t < this.PPS.length; t++) e.writeUint16(this.PPS[t].length), e.writeUint8Array(this.PPS[t].data);
		this.ext && e.writeUint8Array(this.ext);
	}
}, g.fourcc = "avcC", g), Kn = (_ = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "MediaDataBox";
	}
}, _.fourcc = "mdat", _), qn = (v = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ItemDataBox";
	}
}, v.fourcc = "idat", v), Jn = (y = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "FreeSpaceBox";
	}
}, y.fourcc = "free", y), Yn = (b = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "FreeSpaceBox";
	}
}, b.fourcc = "skip", b), Xn = (x = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "HintMediaHeaderBox";
	}
}, x.fourcc = "hmhd", x), Zn = (S = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "NullMediaHeaderBox";
	}
}, S.fourcc = "nmhd", S), Qn = (C = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ObjectDescriptorBox";
	}
}, C.fourcc = "iods", C), $n = (w = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "XMLBox";
	}
}, w.fourcc = "xml ", w), er = (T = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "BinaryXMLBox";
	}
}, T.fourcc = "bxml", T), tr = (E = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ItemProtectionBox", this.sinfs = [];
	}
	get protections() {
		return this.sinfs;
	}
}, E.fourcc = "ipro", E), nr = (ee = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "MovieBox", this.traks = [], this.psshs = [], this.subBoxNames = ["trak", "pssh"];
	}
}, ee.fourcc = "moov", ee), rr = (te = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "TrackBox", this.samples = [];
	}
}, te.fourcc = "trak", te), ir = (ne = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "EditBox";
	}
}, ne.fourcc = "edts", ne), ar = (re = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "MediaBox";
	}
}, re.fourcc = "mdia", re), or = (ie = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "MediaInformationBox";
	}
}, ie.fourcc = "minf", ie), sr = (ae = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "DataInformationBox";
	}
}, ae.fourcc = "dinf", ae), cr = (oe = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "SampleTableBox", this.sgpds = [], this.sbgps = [], this.subBoxNames = ["sgpd", "sbgp"];
	}
}, oe.fourcc = "stbl", oe), lr = (se = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "MovieExtendsBox", this.trexs = [], this.subBoxNames = ["trex"];
	}
}, se.fourcc = "mvex", se), ur = (ce = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "MovieFragmentBox", this.trafs = [], this.subBoxNames = ["traf"];
	}
}, ce.fourcc = "moof", ce), dr = (le = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "TrackFragmentBox", this.truns = [], this.sgpds = [], this.sbgps = [], this.subBoxNames = [
			"trun",
			"sgpd",
			"sbgp"
		];
	}
}, le.fourcc = "traf", le), fr = (ue = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "VTTCueBox";
	}
}, ue.fourcc = "vttc", ue), pr = (de = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "MovieFragmentRandomAccessBox", this.tfras = [], this.subBoxNames = ["tfra"];
	}
}, de.fourcc = "mfra", de), mr = (fe = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "AdditionalMetadataContainerBox";
	}
}, fe.fourcc = "meco", fe), hr = (pe = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "trackhintinformation", this.subBoxNames = ["sdp ", "rtp "];
	}
}, pe.fourcc = "hnti", pe), gr = (me = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "hintstatisticsbox", this.maxrs = [], this.subBoxNames = ["maxr"];
	}
}, me.fourcc = "hinf", me), _r = (he = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "SubTrackBox";
	}
}, he.fourcc = "strk", he), vr = (ge = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "SubTrackDefinitionBox";
	}
}, ge.fourcc = "strd", ge), yr = (_e = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "ProtectionSchemeInfoBox";
	}
}, _e.fourcc = "sinf", _e), br = (ve = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "RestrictedSchemeInfoBox";
	}
}, ve.fourcc = "rinf", ve), xr = (ye = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "SchemeInformationBox";
	}
}, ye.fourcc = "schi", ye), Sr = (be = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "TrackGroupBox";
	}
}, be.fourcc = "trgr", be), Cr = (xe = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "UserDataBox", this.kinds = [], this.strks = [], this.subBoxNames = ["kind", "strk"];
	}
}, xe.fourcc = "udta", xe), wr = (Se = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "ItemPropertiesBox", this.ipmas = [], this.subBoxNames = ["ipma"];
	}
}, Se.fourcc = "iprp", Se), Tr = (Ce = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "ItemPropertyContainerBox", this.hvcCs = [], this.ispes = [], this.claps = [], this.irots = [], this.subBoxNames = [
			"hvcC",
			"ispe",
			"clap",
			"irot"
		];
	}
}, Ce.fourcc = "ipco", Ce), Er = (we = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "GroupsListBox";
	}
}, we.fourcc = "grpl", we), Dr = (Te = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "J2KHeaderInfoBox";
	}
}, Te.fourcc = "j2kH", Te), Or = (Ee = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "ExtendedTypeBox", this.tycos = [], this.subBoxNames = ["tyco"];
	}
}, Ee.fourcc = "etyp", Ee), kr = (De = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "ProjectedOmniVideoBox", this.subBoxNames = ["prfr"];
	}
}, De.fourcc = "povd", De), Ar = (Oe = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "DataReferenceBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.entries = [];
		let t = e.readUint32();
		for (let n = 0; n < t; n++) {
			let t = V(e, !1, this.size - (e.getPosition() - this.start));
			if (t.code === 1) {
				let e = t.box;
				this.entries.push(e);
			} else return;
		}
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4, this.writeHeader(e), e.writeUint32(this.entries.length);
		for (let t = 0; t < this.entries.length; t++) this.entries[t].write(e), this.size += this.entries[t].size;
		N.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size), e.adjustUint32(this.sizePosition, this.size);
	}
}, Oe.fourcc = "dref", Oe), jr = (ke = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ExtendedLanguageBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.extended_language = e.readString(this.size - this.hdr_size);
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = this.extended_language.length, this.writeHeader(e), e.writeString(this.extended_language);
	}
}, ke.fourcc = "elng", ke), Mr = (Ae = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "FileTypeBox";
	}
	parse(e) {
		let t = this.size - this.hdr_size;
		this.major_brand = e.readString(4), this.minor_version = e.readUint32();
		let n = String.fromCharCode(this.minor_version >> 24, this.minor_version >> 16 & 255, this.minor_version >> 8 & 255, this.minor_version & 255);
		n.match("[a-zA-Z0-9]{4}") && (this.minor_version = n), t -= 8, this.compatible_brands = [];
		let r = 0;
		for (; t >= 4;) this.compatible_brands[r] = e.readString(4), t -= 4, r++;
	}
	write(e) {
		this.size = 8 + 4 * this.compatible_brands.length, this.writeHeader(e), e.writeString(this.major_brand, void 0, 4), typeof this.minor_version == "number" ? e.writeUint32(this.minor_version) : e.writeString(this.minor_version, void 0, 4);
		for (let t = 0; t < this.compatible_brands.length; t++) e.writeString(this.compatible_brands[t], void 0, 4);
	}
}, Ae.fourcc = "ftyp", Ae), Nr = (je = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "HandlerBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.version === 0 && (e.readUint32(), this.handler = e.readString(4), e.readUint32Array(3), !this.isEndOfBox(e))) {
			let t = this.start + this.size - e.getPosition();
			this.name = e.readCString();
			let n = this.start + this.size - 1;
			e.seek(n), e.readUint8() !== 0 && t > 1 && (N.info("BoxParser", "Warning: hdlr name is not null-terminated, possibly length-prefixed string. Trimming first byte."), this.name = this.name.slice(1));
		}
	}
	write(e) {
		this.size = 20 + this.name.length + 1, this.version = 0, this.flags = 0, this.writeHeader(e), e.writeUint32(0), e.writeString(this.handler, void 0, 4), e.writeUint32Array([
			0,
			0,
			0
		]), e.writeCString(this.name);
	}
}, je.fourcc = "hdlr", je), Pr = (Me = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "HEVCConfigurationBox";
	}
	parse(e) {
		this.configurationVersion = e.readUint8();
		let t = e.readUint8();
		this.general_profile_space = t >> 6, this.general_tier_flag = (t & 32) >> 5, this.general_profile_idc = t & 31, this.general_profile_compatibility = e.readUint32(), this.general_constraint_indicator = e.readUint8Array(6), this.general_level_idc = e.readUint8(), this.min_spatial_segmentation_idc = e.readUint16() & 4095, this.parallelismType = e.readUint8() & 3, this.chroma_format_idc = e.readUint8() & 3, this.bit_depth_luma_minus8 = e.readUint8() & 7, this.bit_depth_chroma_minus8 = e.readUint8() & 7, this.avgFrameRate = e.readUint16(), t = e.readUint8(), this.constantFrameRate = t >> 6, this.numTemporalLayers = (t & 13) >> 3, this.temporalIdNested = (t & 4) >> 2, this.lengthSizeMinusOne = t & 3, this.nalu_arrays = [];
		let n = e.readUint8();
		for (let r = 0; r < n; r++) {
			let n = [];
			this.nalu_arrays.push(n), t = e.readUint8(), n.completeness = (t & 128) >> 7, n.nalu_type = t & 63;
			let r = e.readUint16();
			for (let t = 0; t < r; t++) {
				let t = e.readUint16();
				n.push({ data: e.readUint8Array(t) });
			}
		}
	}
	write(e) {
		this.size = 23;
		for (let e = 0; e < this.nalu_arrays.length; e++) {
			this.size += 3;
			for (let t = 0; t < this.nalu_arrays[e].length; t++) this.size += 2 + this.nalu_arrays[e][t].data.length;
		}
		this.writeHeader(e), e.writeUint8(this.configurationVersion), e.writeUint8((this.general_profile_space << 6) + (this.general_tier_flag << 5) + this.general_profile_idc), e.writeUint32(this.general_profile_compatibility), e.writeUint8Array(this.general_constraint_indicator), e.writeUint8(this.general_level_idc), e.writeUint16(this.min_spatial_segmentation_idc + (15 << 24)), e.writeUint8(this.parallelismType + 252), e.writeUint8(this.chroma_format_idc + 252), e.writeUint8(this.bit_depth_luma_minus8 + 248), e.writeUint8(this.bit_depth_chroma_minus8 + 248), e.writeUint16(this.avgFrameRate), e.writeUint8((this.constantFrameRate << 6) + (this.numTemporalLayers << 3) + (this.temporalIdNested << 2) + this.lengthSizeMinusOne), e.writeUint8(this.nalu_arrays.length);
		for (let t = 0; t < this.nalu_arrays.length; t++) {
			e.writeUint8((this.nalu_arrays[t].completeness << 7) + this.nalu_arrays[t].nalu_type), e.writeUint16(this.nalu_arrays[t].length);
			for (let n = 0; n < this.nalu_arrays[t].length; n++) e.writeUint16(this.nalu_arrays[t][n].data.length), e.writeUint8Array(this.nalu_arrays[t][n].data);
		}
	}
}, Me.fourcc = "hvcC", Me), Fr = (Ne = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MediaHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.version === 1 ? (this.creation_time = e.readUint64(), this.modification_time = e.readUint64(), this.timescale = e.readUint32(), this.duration = e.readUint64()) : (this.creation_time = e.readUint32(), this.modification_time = e.readUint32(), this.timescale = e.readUint32(), this.duration = e.readUint32()), this.parseLanguage(e), e.readUint16();
	}
	write(e) {
		let t = this.modification_time > O || this.creation_time > O || this.duration > O || this.version === 1;
		this.version = +!!t, this.size = 20, this.size += t ? 12 : 0, this.flags = 0, this.writeHeader(e), t ? (e.writeUint64(this.creation_time), e.writeUint64(this.modification_time), e.writeUint32(this.timescale), e.writeUint64(this.duration)) : (e.writeUint32(this.creation_time), e.writeUint32(this.modification_time), e.writeUint32(this.timescale), e.writeUint32(this.duration)), e.writeUint16(this.language), e.writeUint16(0);
	}
}, Ne.fourcc = "mdhd", Ne), Ir = (Pe = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MovieExtendsHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.flags & 1 && (N.warn("BoxParser", "mehd box incorrectly uses flags set to 1, converting version to 1"), this.version = 1), this.fragment_duration = this.version === 1 ? e.readUint64() : e.readUint32();
	}
	write(e) {
		let t = this.fragment_duration > O || this.version === 1;
		this.version = +!!t, this.size = 4, this.size += t ? 4 : 0, this.flags = 0, this.writeHeader(e), t ? e.writeUint64(this.fragment_duration) : e.writeUint32(this.fragment_duration);
	}
}, Pe.fourcc = "mehd", Pe), Lr = (Fe = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ItemInfoEntry";
	}
	parse(e) {
		this.parseFullHeader(e), (this.version === 0 || this.version === 1) && (this.item_ID = e.readUint16(), this.item_protection_index = e.readUint16(), this.item_name = e.readCString(), this.content_type = e.readCString(), this.isEndOfBox(e) || (this.content_encoding = e.readCString())), this.version === 1 ? (this.extension_type = e.readString(4), N.warn("BoxParser", "Cannot parse extension type"), e.seek(this.start + this.size)) : this.version >= 2 && (this.version === 2 ? this.item_ID = e.readUint16() : this.version === 3 && (this.item_ID = e.readUint32()), this.item_protection_index = e.readUint16(), this.item_type = e.readString(4), this.item_name = e.readCString(), this.item_type === "mime" ? (this.content_type = e.readCString(), this.content_encoding = e.readCString()) : this.item_type === "uri " && (this.item_uri_type = e.readCString()));
	}
}, Fe.fourcc = "infe", Fe), Rr = (Ie = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ItemInfoBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.entry_count = this.version === 0 ? e.readUint16() : e.readUint32(), this.item_infos = [];
		for (let t = 0; t < this.entry_count; t++) {
			let n = V(e, !1, this.size - (e.getPosition() - this.start));
			if (n.code === 1) {
				let r = n.box;
				r.type === "infe" ? this.item_infos[t] = r : N.error("BoxParser", "Expected 'infe' box, got " + n.box.type, e.isofile);
			} else return;
		}
	}
}, Ie.fourcc = "iinf", Ie), zr = (Le = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ItemLocationBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t;
		t = e.readUint8(), this.offset_size = t >> 4 & 15, this.length_size = t & 15, t = e.readUint8(), this.base_offset_size = t >> 4 & 15, this.index_size = this.version === 1 || this.version === 2 ? t & 15 : 0, this.items = [];
		let n = 0;
		if (this.version < 2) n = e.readUint16();
		else if (this.version === 2) n = e.readUint32();
		else throw Error("version of iloc box not supported");
		for (let t = 0; t < n; t++) {
			let t = 0, n = 0, r = 0;
			if (this.version < 2) t = e.readUint16();
			else if (this.version === 2) t = e.readUint32();
			else throw Error("version of iloc box not supported");
			n = this.version === 1 || this.version === 2 ? e.readUint16() & 15 : 0;
			let i = e.readUint16();
			switch (this.base_offset_size) {
				case 0:
					r = 0;
					break;
				case 4:
					r = e.readUint32();
					break;
				case 8:
					r = e.readUint64();
					break;
				default: throw Error("Error reading base offset size");
			}
			let a = [], o = e.readUint16();
			for (let t = 0; t < o; t++) {
				let t = 0, n = 0, r = 0;
				if (this.version === 1 || this.version === 2) switch (this.index_size) {
					case 0:
						t = 0;
						break;
					case 4:
						t = e.readUint32();
						break;
					case 8:
						t = e.readUint64();
						break;
					default: throw Error("Error reading extent index");
				}
				switch (this.offset_size) {
					case 0:
						n = 0;
						break;
					case 4:
						n = e.readUint32();
						break;
					case 8:
						n = e.readUint64();
						break;
					default: throw Error("Error reading extent index");
				}
				switch (this.length_size) {
					case 0:
						r = 0;
						break;
					case 4:
						r = e.readUint32();
						break;
					case 8:
						r = e.readUint64();
						break;
					default: throw Error("Error reading extent index");
				}
				a.push({
					extent_index: t,
					extent_length: r,
					extent_offset: n
				});
			}
			this.items.push({
				base_offset: r,
				construction_method: n,
				item_ID: t,
				data_reference_index: i,
				extents: a
			});
		}
	}
}, Le.fourcc = "iloc", Le), Br = {
	auxl: "Auxiliary image item",
	base: "Pre-derived image item base",
	cdsc: "Item describes referenced item",
	dimg: "Derived image item",
	dpnd: "Item coding dependency",
	eroi: "Region",
	evir: "EVC slice",
	exbl: "Scalable image item",
	"fdl ": "File delivery",
	font: "Font item",
	iloc: "Item data location",
	mask: "Region mask",
	mint: "Data integrity",
	pred: "Predictively coded item",
	prem: "Pre-multiplied item",
	tbas: "HEVC tile track base item",
	text: "Text item",
	thmb: "Thumbnail image item"
}, Vr = (D = class e extends I {
	constructor(...e) {
		super(...e), this.box_name = "ItemReferenceBox", this.references = [];
	}
	parse(t) {
		for (this.parseFullHeader(t), this.references = []; t.getPosition() < this.start + this.size;) {
			let n = V(t, !0, this.size - (t.getPosition() - this.start));
			if (n.code === 1) {
				let r = "Unknown item reference";
				e.allowed_types.includes(n.type) ? r = Br[n.type] : N.warn("BoxParser", `Unknown item reference type: '${n.type}'`);
				let i = this.version === 0 ? new Dn(n.type, n.size, r, n.hdr_size, n.start) : new On(n.type, n.size, r, n.hdr_size, n.start);
				i.write === F.prototype.write && i.type !== "mdat" && (N.warn("BoxParser", i.type + " box writing not yet implemented, keeping unparsed data in memory for later write"), i.parseDataAndRewind(t)), i.parse(t), this.references.push(i);
			} else return;
		}
	}
}, D.fourcc = "iref", D.allowed_types = [
	"auxl",
	"base",
	"cdsc",
	"dimg",
	"dpnd",
	"eroi",
	"evir",
	"exbl",
	"fdl ",
	"font",
	"iloc",
	"mask",
	"mint",
	"pred",
	"prem",
	"tbas",
	"text",
	"thmb"
], D), Hr = (Re = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "PrimaryItemBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.item_id = this.version === 0 ? e.readUint16() : e.readUint32();
	}
}, Re.fourcc = "pitm", Re), Ur = (ze = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MetaBox", this.isQT = !1;
	}
	parse(e) {
		let t = e.getPosition();
		if (this.size > 8) {
			switch (e.readUint32(), e.readString(4)) {
				case "hdlr":
				case "mhdr":
				case "keys":
				case "ilst":
				case "ctry":
				case "lang": this.isQT = !0;
			}
			e.seek(t);
		}
		this.isQT || this.parseFullHeader(e), H.prototype.parse.call(this, e);
	}
}, ze.fourcc = "meta", ze), Wr = (Be = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MovieFragmentHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.sequence_number = e.readUint32();
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4, this.writeHeader(e), e.writeUint32(this.sequence_number);
	}
}, Be.fourcc = "mfhd", Be), Gr = (Ve = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MovieHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.version === 1 ? (this.creation_time = e.readUint64(), this.modification_time = e.readUint64(), this.timescale = e.readUint32(), this.duration = e.readUint64()) : (this.creation_time = e.readUint32(), this.modification_time = e.readUint32(), this.timescale = e.readUint32(), this.duration = e.readUint32()), this.rate = e.readUint32(), this.volume = e.readUint16() >> 8, e.readUint16(), e.readUint32Array(2), this.matrix = e.readInt32Array(9), e.readUint32Array(6), this.next_track_id = e.readUint32();
	}
	write(e) {
		let t = this.modification_time > O || this.creation_time > O || this.duration > O || this.version === 1;
		this.version = +!!t, this.size = 96, this.size += t ? 12 : 0, this.flags = 0, this.writeHeader(e), t ? (e.writeUint64(this.creation_time), e.writeUint64(this.modification_time), e.writeUint32(this.timescale), e.writeUint64(this.duration)) : (e.writeUint32(this.creation_time), e.writeUint32(this.modification_time), e.writeUint32(this.timescale), e.writeUint32(this.duration)), e.writeUint32(this.rate), e.writeUint16(this.volume << 8), e.writeUint16(0), e.writeUint32(0), e.writeUint32(0), e.writeInt32Array(this.matrix), e.writeUint32(0), e.writeUint32(0), e.writeUint32(0), e.writeUint32(0), e.writeUint32(0), e.writeUint32(0), e.writeUint32(this.next_track_id);
	}
	print(e) {
		super.printHeader(e), e.log(e.indent + "creation_time: " + this.creation_time), e.log(e.indent + "modification_time: " + this.modification_time), e.log(e.indent + "timescale: " + this.timescale), e.log(e.indent + "duration: " + this.duration), e.log(e.indent + "rate: " + this.rate), e.log(e.indent + "volume: " + (this.volume >> 8)), e.log(e.indent + "matrix: " + this.matrix.join(", ")), e.log(e.indent + "next_track_id: " + this.next_track_id);
	}
}, Ve.fourcc = "mvhd", Ve), Kr = (He = class extends W {
	parse(e) {
		this.parseHeader(e), this.content_encoding = e.readCString(), this.mime_format = e.readCString(), this.parseFooter(e);
	}
}, He.fourcc = "mett", He), qr = (Ue = class extends W {
	parse(e) {
		this.parseHeader(e), this.content_encoding = e.readCString(), this.namespace = e.readCString(), this.schema_location = e.readCString(), this.parseFooter(e);
	}
}, Ue.fourcc = "metx", Ue), Jr = (We = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "AV1CodecConfigurationBox";
	}
	parse(e) {
		let t = e.readUint8();
		if ((t >> 7 & 1) != 1) {
			N.error("BoxParser", "av1C marker problem", e.isofile);
			return;
		}
		if (this.version = t & 127, this.version !== 1) {
			N.error("BoxParser", "av1C version " + this.version + " not supported", e.isofile);
			return;
		}
		if (t = e.readUint8(), this.seq_profile = t >> 5 & 7, this.seq_level_idx_0 = t & 31, t = e.readUint8(), this.seq_tier_0 = t >> 7 & 1, this.high_bitdepth = t >> 6 & 1, this.twelve_bit = t >> 5 & 1, this.monochrome = t >> 4 & 1, this.chroma_subsampling_x = t >> 3 & 1, this.chroma_subsampling_y = t >> 2 & 1, this.chroma_sample_position = t & 3, t = e.readUint8(), this.reserved_1 = t >> 5 & 7, this.reserved_1 !== 0) {
			N.error("BoxParser", "av1C reserved_1 parsing problem", e.isofile);
			return;
		}
		if (this.initial_presentation_delay_present = t >> 4 & 1, this.initial_presentation_delay_present === 1) this.initial_presentation_delay_minus_one = t & 15;
		else if (this.reserved_2 = t & 15, this.reserved_2 !== 0) {
			N.error("BoxParser", "av1C reserved_2 parsing problem", e.isofile);
			return;
		}
		let n = this.size - this.hdr_size - 4;
		this.configOBUs = e.readUint8Array(n);
	}
}, We.fourcc = "av1C", We), Yr = (Ge = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ElementaryStreamDescriptorBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint8Array(this.size - this.hdr_size);
		if ("MPEG4DescriptorParser" in z) {
			let e = new z.MPEG4DescriptorParser();
			this.esd = e.parseOneDescriptor(new A(t.buffer, 0));
		}
	}
}, Ge.fourcc = "esds", Ge), Xr = (Ke = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "siDecompressionParamBox";
	}
}, Ke.fourcc = "wave", Ke), Zr = (qe = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "LCEVCConfigurationBox";
	}
	parse(e) {
		if (this.configurationVersion = e.readUint8(), this.configurationVersion !== 1) {
			N.error("BoxParser", "lvcC version " + this.configurationVersion + " not supported", e.isofile);
			return;
		}
		this.LCEVCProfileIndication = e.readUint8(), this.LCEVCLevelIndication = e.readUint8();
		let t = e.readUint8();
		this.chroma_format_idc = t >> 6 & 3, this.bit_depth_luma_minus8 = t >> 3 & 7, this.bit_depth_chroma_minus8 = t & 7, t = e.readUint8(), this.lengthSizeMinusOne = t >> 6 & 3;
		let n = t & 63;
		if (n !== 63 || (this.pic_width_in_luma_samples = e.readUint32(), this.pic_height_in_luma_samples = e.readUint32(), t = e.readUint8(), this.sc_in_stream = t >> 7 & 1, this.gc_in_stream = t >> 6 & 1, this.ai_in_stream = t >> 5 & 1, n = t & 31, n !== 31)) {
			N.error("BoxParser", "lvcC reserved parsing problem", e.isofile);
			return;
		}
		this.nalu_arrays = [];
		let r = e.readUint8();
		for (let i = 0; i < r; i++) {
			let r = [];
			if (this.nalu_arrays.push(r), t = e.readUint8(), n = t >> 6 & 3, n !== 0) {
				N.error("BoxParser", "lvcC reserved parsing problem", e.isofile);
				return;
			}
			r.nalu_type = t & 63;
			let i = e.readUint16();
			for (let t = 0; t < i; t++) {
				let t = e.readUint16();
				r.push({ data: e.readUint8Array(t) });
			}
		}
	}
}, qe.fourcc = "lvcC", qe), Qr = (Je = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "VPCodecConfigurationRecord";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.version === 1) {
			this.profile = e.readUint8(), this.level = e.readUint8();
			let t = e.readUint8();
			this.bitDepth = t >> 4, this.chromaSubsampling = t >> 1 & 7, this.videoFullRangeFlag = t & 1, this.colourPrimaries = e.readUint8(), this.transferCharacteristics = e.readUint8(), this.matrixCoefficients = e.readUint8(), this.codecIntializationDataSize = e.readUint16(), this.codecIntializationData = e.readUint8Array(this.codecIntializationDataSize);
		} else {
			this.profile = e.readUint8(), this.level = e.readUint8();
			let t = e.readUint8();
			this.bitDepth = t >> 4 & 15, this.colorSpace = t & 15, t = e.readUint8(), this.chromaSubsampling = t >> 4 & 15, this.transferFunction = t >> 1 & 7, this.videoFullRangeFlag = t & 1, this.codecIntializationDataSize = e.readUint16(), this.codecIntializationData = e.readUint8Array(this.codecIntializationDataSize);
		}
	}
}, Je.fourcc = "vpcC", Je), $r = (Ye = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "VvcConfigurationBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = {
			held_bits: void 0,
			num_held_bits: 0,
			stream_read_1_bytes: function(e) {
				this.held_bits = e.readUint8(), this.num_held_bits = 8;
			},
			stream_read_2_bytes: function(e) {
				this.held_bits = e.readUint16(), this.num_held_bits = 16;
			},
			extract_bits: function(e) {
				let t = this.held_bits >> this.num_held_bits - e & (1 << e) - 1;
				return this.num_held_bits -= e, t;
			}
		};
		if (t.stream_read_1_bytes(e), t.extract_bits(5), this.lengthSizeMinusOne = t.extract_bits(2), this.ptl_present_flag = t.extract_bits(1), this.ptl_present_flag) {
			if (t.stream_read_2_bytes(e), this.ols_idx = t.extract_bits(9), this.num_sublayers = t.extract_bits(3), this.constant_frame_rate = t.extract_bits(2), this.chroma_format_idc = t.extract_bits(2), t.stream_read_1_bytes(e), this.bit_depth_minus8 = t.extract_bits(3), t.extract_bits(5), t.stream_read_2_bytes(e), t.extract_bits(2), this.num_bytes_constraint_info = t.extract_bits(6), this.general_profile_idc = t.extract_bits(7), this.general_tier_flag = t.extract_bits(1), this.general_level_idc = e.readUint8(), t.stream_read_1_bytes(e), this.ptl_frame_only_constraint_flag = t.extract_bits(1), this.ptl_multilayer_enabled_flag = t.extract_bits(1), this.general_constraint_info = new Uint8Array(this.num_bytes_constraint_info), this.num_bytes_constraint_info) {
				for (let n = 0; n < this.num_bytes_constraint_info - 1; n++) {
					let r = t.extract_bits(6);
					t.stream_read_1_bytes(e);
					let i = t.extract_bits(2);
					this.general_constraint_info[n] = r << 2 | i;
				}
				this.general_constraint_info[this.num_bytes_constraint_info - 1] = t.extract_bits(6);
			} else t.extract_bits(6);
			if (this.num_sublayers > 1) {
				t.stream_read_1_bytes(e), this.ptl_sublayer_present_mask = 0;
				for (let e = this.num_sublayers - 2; e >= 0; --e) {
					let n = t.extract_bits(1);
					this.ptl_sublayer_present_mask |= n << e;
				}
				for (let e = this.num_sublayers; e <= 8 && this.num_sublayers > 1; ++e) t.extract_bits(1);
				this.sublayer_level_idc = [];
				for (let t = this.num_sublayers - 2; t >= 0; --t) this.ptl_sublayer_present_mask & 1 << t && (this.sublayer_level_idc[t] = e.readUint8());
			}
			if (this.ptl_num_sub_profiles = e.readUint8(), this.general_sub_profile_idc = [], this.ptl_num_sub_profiles) for (let t = 0; t < this.ptl_num_sub_profiles; t++) this.general_sub_profile_idc.push(e.readUint32());
			this.max_picture_width = e.readUint16(), this.max_picture_height = e.readUint16(), this.avg_frame_rate = e.readUint16();
		}
		this.nalu_arrays = [];
		let n = e.readUint8();
		for (let r = 0; r < n; r++) {
			let n = [];
			this.nalu_arrays.push(n), t.stream_read_1_bytes(e), n.completeness = t.extract_bits(1), t.extract_bits(2), n.nalu_type = t.extract_bits(5);
			let r = 1;
			n.nalu_type !== 13 && n.nalu_type !== 12 && (r = e.readUint16());
			for (let t = 0; t < r; t++) {
				let t = e.readUint16();
				n.push({
					data: e.readUint8Array(t),
					length: t
				});
			}
		}
	}
}, Ye.fourcc = "vvcC", Ye), ei = (Xe = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ColourInformationBox";
	}
	parse(e) {
		if (this.colour_type = e.readString(4), this.colour_type === "nclx") {
			this.colour_primaries = e.readUint16(), this.transfer_characteristics = e.readUint16(), this.matrix_coefficients = e.readUint16();
			let t = e.readUint8();
			this.full_range_flag = t >> 7;
		} else (this.colour_type === "rICC" || this.colour_type === "prof") && (this.ICC_profile = e.readUint8Array(this.size - 4));
	}
}, Xe.fourcc = "colr", Xe);
function J(e, t) {
	let n = Number(e).toString(16);
	for (t = t === void 0 ? 2 : t; n.length < t;) n = "0" + n;
	return n;
}
var ti = class extends K {
	getCodec() {
		let e = super.getCodec();
		return this.avcC ? `${e}.${J(this.avcC.AVCProfileIndication)}${J(this.avcC.profile_compatibility)}${J(this.avcC.AVCLevelIndication)}` : e;
	}
}, ni = (Ze = class extends ti {
	constructor(...e) {
		super(...e), this.box_name = "AVCSampleEntry";
	}
}, Ze.fourcc = "avc1", Ze), ri = (Qe = class extends ti {
	constructor(...e) {
		super(...e), this.box_name = "AVC2SampleEntry";
	}
}, Qe.fourcc = "avc2", Qe), ii = ($e = class extends ti {
	constructor(...e) {
		super(...e), this.box_name = "AVCSampleEntry";
	}
}, $e.fourcc = "avc3", $e), ai = (et = class extends ti {
	constructor(...e) {
		super(...e), this.box_name = "AVC2SampleEntry";
	}
}, et.fourcc = "avc4", et), oi = (tt = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "AV1SampleEntry";
	}
	getCodec() {
		let e = super.getCodec(), t = this.av1C.seq_level_idx_0, n = t < 10 ? "0" + t : t, r;
		return this.av1C.seq_profile === 2 && this.av1C.high_bitdepth === 1 ? r = this.av1C.twelve_bit === 1 ? "12" : "10" : this.av1C.seq_profile <= 2 && (r = this.av1C.high_bitdepth === 1 ? "10" : "08"), e + "." + this.av1C.seq_profile + "." + n + (this.av1C.seq_tier_0 ? "H" : "M") + "." + r;
	}
}, tt.fourcc = "av01", tt), si = (nt = class extends K {}, nt.fourcc = "dav1", nt), ci = class extends K {
	getCodec() {
		let e = super.getCodec();
		if (this.hvcC) {
			switch (e += ".", this.hvcC.general_profile_space) {
				case 0:
					e += "";
					break;
				case 1:
					e += "A";
					break;
				case 2:
					e += "B";
					break;
				case 3: e += "C";
			}
			e += this.hvcC.general_profile_idc, e += ".";
			let t = this.hvcC.general_profile_compatibility, n = 0;
			for (let e = 0; e < 32 && (n |= t & 1, e !== 31); e++) n <<= 1, t >>= 1;
			e += J(n, 0), e += ".", this.hvcC.general_tier_flag === 0 ? e += "L" : e += "H", e += this.hvcC.general_level_idc;
			let r = !1, i = "";
			for (let e = 5; e >= 0; e--) (this.hvcC.general_constraint_indicator[e] || r) && (i = "." + J(this.hvcC.general_constraint_indicator[e], 0) + i, r = !0);
			e += i;
		}
		return e;
	}
}, li = (rt = class extends ci {
	constructor(...e) {
		super(...e), this.box_name = "HEVCSampleEntry";
	}
}, rt.fourcc = "hvc1", rt), ui = (it = class extends ci {}, it.fourcc = "hvc2", it), di = (at = class extends ci {
	constructor(...e) {
		super(...e), this.box_name = "HEVCSampleEntry", this.colrs = [], this.subBoxNames = ["colr"];
	}
}, at.fourcc = "hev1", at), fi = (ot = class extends ci {}, ot.fourcc = "hev2", ot), pi = (st = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "HEVCTileSampleSampleEntry";
	}
}, st.fourcc = "hvt1", st), mi = (ct = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "LHEVCSampleEntry";
	}
}, ct.fourcc = "lhe1", ct), hi = (lt = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "LHEVCSampleEntry";
	}
}, lt.fourcc = "lhv1", lt), gi = (ut = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "LCEVCSampleEntry";
	}
	getCodec() {
		let e = super.getCodec();
		return this.lvcC && (e += ".", e += "vprf", e += this.lvcC.LCEVCProfileIndication, e += ".", e += "vlev", e += this.lvcC.LCEVCLevelIndication), e;
	}
}, ut.fourcc = "lvc1", ut), _i = (dt = class extends K {}, dt.fourcc = "dvh1", dt), vi = (ft = class extends K {}, ft.fourcc = "dvhe", ft), yi = class extends K {
	getCodec() {
		let e = super.getCodec();
		if (this.vvcC) {
			e += "." + this.vvcC.general_profile_idc, this.vvcC.general_tier_flag ? e += ".H" : e += ".L", e += this.vvcC.general_level_idc;
			let t = "";
			if (this.vvcC.general_constraint_info) {
				let e = [], n = 0;
				n |= this.vvcC.ptl_frame_only_constraint_flag << 7, n |= this.vvcC.ptl_multilayer_enabled_flag << 6;
				let r;
				for (let t = 0; t < this.vvcC.general_constraint_info.length; ++t) n |= this.vvcC.general_constraint_info[t] >> 2 & 63, e.push(n), n && (r = t), n = this.vvcC.general_constraint_info[t] >> 2 & 3;
				if (r === void 0) t = ".CA";
				else {
					t = ".C";
					let n = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", i = 0, a = 0;
					for (let o = 0; o <= r; ++o) for (i = i << 8 | e[o], a += 8; a >= 5;) {
						let e = i >> a - 5 & 31;
						t += n[e], a -= 5, i &= (1 << a) - 1;
					}
					a && (i <<= 5 - a, t += n[i & 31]);
				}
			}
			e += t;
		}
		return e;
	}
}, bi = (pt = class extends yi {
	constructor(...e) {
		super(...e), this.box_name = "VvcSampleEntry";
	}
}, pt.fourcc = "vvc1", pt), xi = (mt = class extends yi {
	constructor(...e) {
		super(...e), this.box_name = "VvcSampleEntry";
	}
}, mt.fourcc = "vvi1", mt), Si = (ht = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "VvcSampleEntry";
	}
}, ht.fourcc = "vvs1", ht), Ci = (gt = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "VvcNonVCLSampleEntry";
	}
}, gt.fourcc = "vvcN", gt), wi = class extends K {
	getCodec() {
		let e = super.getCodec(), t = this.vpcC.level;
		t === 0 && (t = "00");
		let n = this.vpcC.bitDepth;
		return n === 8 && (n = "08"), `${e}.0${this.vpcC.profile}.${t}.${n}`;
	}
}, Ti = (_t = class extends wi {}, _t.fourcc = "vp08", _t), Ei = (vt = class extends wi {}, vt.fourcc = "vp09", vt), Di = (yt = class extends K {}, yt.fourcc = "avs3", yt), Oi = (bt = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "J2KSampleEntry";
	}
}, bt.fourcc = "j2ki", bt), ki = (xt = class extends K {}, xt.fourcc = "mjp2", xt), Ai = (St = class extends K {}, St.fourcc = "mjpg", St), ji = (Ct = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "UncompressedVideoSampleEntry";
	}
}, Ct.fourcc = "uncv", Ct), Mi = (wt = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "MP4VisualSampleEntry";
	}
}, wt.fourcc = "mp4v", wt), Ni = (Tt = class extends q {
	constructor(...e) {
		super(...e), this.box_name = "MP4AudioSampleEntry";
	}
	getCodec() {
		let e = super.getCodec(), t = this.esds ?? this.wave?.esds;
		if (t && t.esd) {
			let n = t.esd.getOTI(), r = t.esd.getAudioConfig();
			return e + "." + J(n) + (r ? "." + r : "");
		}
		return e;
	}
}, Tt.fourcc = "mp4a", Tt), Pi = (Et = class extends q {}, Et.fourcc = "m4ae", Et), Fi = (Dt = class extends q {}, Dt.fourcc = "ac-3", Dt), Ii = (Ot = class extends q {}, Ot.fourcc = "ac-4", Ot), Li = (kt = class extends q {}, kt.fourcc = "ec-3", kt), Ri = (At = class extends q {}, At.fourcc = "Opus", At), zi = (jt = class extends q {}, jt.fourcc = "mha1", jt), Bi = (Mt = class extends q {}, Mt.fourcc = "mha2", Mt), Vi = (Nt = class extends q {}, Nt.fourcc = "mhm1", Nt), Hi = (Pt = class extends q {}, Pt.fourcc = "mhm2", Pt), Ui = (Ft = class extends q {}, Ft.fourcc = "fLaC", Ft), Wi = (It = class extends K {}, It.fourcc = "encv", It), Gi = (Lt = class extends q {}, Lt.fourcc = "enca", Lt), Ki = (Rt = class extends G {
	constructor(...e) {
		super(...e), this.subBoxNames = ["sinf"], this.sinfs = [];
	}
}, Rt.fourcc = "encu", Rt), qi = (zt = class extends Un {
	constructor(...e) {
		super(...e), this.subBoxNames = ["sinf"], this.sinfs = [];
	}
}, zt.fourcc = "encs", zt), Ji = (Bt = class extends Un {}, Bt.fourcc = "mp4s", Bt), Yi = (Vt = class extends Hn {
	constructor(...e) {
		super(...e), this.subBoxNames = ["sinf"], this.sinfs = [];
	}
}, Vt.fourcc = "enct", Vt), Xi = (Ht = class extends W {
	constructor(...e) {
		super(...e), this.subBoxNames = ["sinf"], this.sinfs = [];
	}
}, Ht.fourcc = "encm", Ht), Zi = (Ut = class extends K {
	constructor(...e) {
		super(...e), this.box_name = "RestrictedVideoSampleEntry";
	}
}, Ut.fourcc = "resv", Ut), Qi = (Wt = class extends G {
	parse(e) {
		this.parseHeader(e), this.content_encoding = e.readCString(), this.mime_format = e.readCString(), this.parseFooter(e);
	}
}, Wt.fourcc = "sbtt", Wt), $i = (Gt = class extends G {
	parse(e) {
		this.parseHeader(e), this.namespace = e.readCString(), this.schema_location = e.readCString(), this.auxiliary_mime_types = e.readCString(), this.parseFooter(e);
	}
	write(e) {
		this.writeHeader(e), this.size += this.namespace.length + 1 + this.schema_location.length + 1 + this.auxiliary_mime_types.length + 1, e.writeCString(this.namespace), e.writeCString(this.schema_location), e.writeCString(this.auxiliary_mime_types), this.writeFooter(e);
	}
}, Gt.fourcc = "stpp", Gt), ea = (Kt = class extends G {
	parse(e) {
		this.parseHeader(e), this.content_encoding = e.readCString(), this.mime_format = e.readCString(), this.parseFooter(e);
	}
	getCodec() {
		let e = super.getCodec();
		return this.mime_format ? e + "." + this.mime_format : e;
	}
}, Kt.fourcc = "stxt", Kt), ta = (qt = class extends G {
	parse(e) {
		this.parseHeader(e), this.displayFlags = e.readUint32(), this.horizontal_justification = e.readInt8(), this.vertical_justification = e.readInt8(), this.bg_color_rgba = e.readUint8Array(4), this.box_record = e.readInt16Array(4), this.style_record = e.readUint8Array(12), this.parseFooter(e);
	}
}, qt.fourcc = "tx3g", qt), na = (Jt = class extends W {
	parse(e) {
		this.parseHeader(e), this.parseFooter(e);
	}
}, Jt.fourcc = "wvtt", Jt), ra = (Yt = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleToGroupBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.grouping_type = e.readString(4), this.grouping_type_parameter = this.version === 1 ? e.readUint32() : 0, this.entries = [];
		let t = e.readUint32();
		for (let n = 0; n < t; n++) this.entries.push({
			sample_count: e.readInt32(),
			group_description_index: e.readInt32()
		});
	}
	write(e) {
		this.version = +!!this.grouping_type_parameter, this.flags = 0, this.size = 8 + 8 * this.entries.length + (this.version === 1 ? 4 : 0), this.writeHeader(e), e.writeString(this.grouping_type, void 0, 4), this.version === 1 && e.writeUint32(this.grouping_type_parameter), e.writeUint32(this.entries.length);
		for (let t = 0; t < this.entries.length; t++) {
			let n = this.entries[t];
			e.writeInt32(n.sample_count), e.writeInt32(n.group_description_index);
		}
	}
}, Yt.fourcc = "sbgp", Yt), ia = (Xt = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleDependencyTypeBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = this.size - this.hdr_size;
		this.is_leading = [], this.sample_depends_on = [], this.sample_is_depended_on = [], this.sample_has_redundancy = [];
		for (let n = 0; n < t; n++) {
			let t = e.readUint8();
			this.is_leading[n] = t >> 6, this.sample_depends_on[n] = t >> 4 & 3, this.sample_is_depended_on[n] = t >> 2 & 3, this.sample_has_redundancy[n] = t & 3;
		}
	}
}, Xt.fourcc = "sdtp", Xt), aa = (Zt = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleGroupDescriptionBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.grouping_type = e.readString(4), N.debug("BoxParser", "Found Sample Groups of type " + this.grouping_type), this.default_length = this.version === 1 ? e.readUint32() : 0, this.version >= 2 && (this.default_group_description_index = e.readUint32()), this.entries = [];
		let t = e.readUint32();
		for (let n = 0; n < t; n++) {
			let t;
			t = this.grouping_type in R.sampleGroupEntry ? new R.sampleGroupEntry[this.grouping_type](this.grouping_type) : new L(this.grouping_type), this.entries.push(t), this.version === 1 && this.default_length === 0 ? t.description_length = e.readUint32() : t.description_length = this.default_length, t.write === L.prototype.write && (N.info("BoxParser", "SampleGroup for type " + this.grouping_type + " writing not yet implemented, keeping unparsed data in memory for later write"), t.data = e.readUint8Array(t.description_length), e.seek(e.getPosition() - t.description_length)), t.parse(e);
		}
	}
	write(e) {
		this.flags = 0, this.size = 12;
		for (let e = 0; e < this.entries.length; e++) {
			let t = this.entries[e];
			this.version === 1 && (this.default_length === 0 && (this.size += 4), this.size += t.data.length);
		}
		this.writeHeader(e), e.writeString(this.grouping_type, void 0, 4), this.version === 1 && e.writeUint32(this.default_length), this.version >= 2 && e.writeUint32(this.default_sample_description_index), e.writeUint32(this.entries.length);
		for (let t = 0; t < this.entries.length; t++) {
			let n = this.entries[t];
			this.version === 1 && this.default_length === 0 && e.writeUint32(n.description_length), n.write(e);
		}
	}
}, Zt.fourcc = "sgpd", Zt), oa = (Qt = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompressedSegmentIndexBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.reference_ID = e.readUint32(), this.timescale = e.readUint32(), this.version === 0 ? (this.earliest_presentation_time = e.readUint32(), this.first_offset = e.readUint32()) : (this.earliest_presentation_time = e.readUint64(), this.first_offset = e.readUint64()), e.readUint16(), this.references = [];
		let t = e.readUint16();
		for (let n = 0; n < t; n++) {
			let t = e.readUint32(), n = e.readUint32(), r = e.readUint32();
			this.references.push({
				reference_type: t >> 31 & 1,
				referenced_size: t & 2147483647,
				subsegment_duration: n,
				starts_with_SAP: r >> 31 & 1,
				SAP_type: r >> 28 & 7,
				SAP_delta_time: r & 268435455
			});
		}
	}
	write(e) {
		let t = this.earliest_presentation_time > O || this.first_offset > O || this.version === 1;
		this.version = +!!t, this.size = 12 + 12 * this.references.length, this.size += t ? 16 : 8, this.flags = 0, this.writeHeader(e), e.writeUint32(this.reference_ID), e.writeUint32(this.timescale), t ? (e.writeUint64(this.earliest_presentation_time), e.writeUint64(this.first_offset)) : (e.writeUint32(this.earliest_presentation_time), e.writeUint32(this.first_offset)), e.writeUint16(0), e.writeUint16(this.references.length);
		for (let t = 0; t < this.references.length; t++) {
			let n = this.references[t];
			e.writeUint32(n.reference_type << 31 | n.referenced_size), e.writeUint32(n.subsegment_duration), e.writeUint32(n.starts_with_SAP << 31 | n.SAP_type << 28 | n.SAP_delta_time);
		}
	}
}, Qt.fourcc = "sidx", Qt), sa = ($t = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SoundMediaHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.balance = e.readUint16(), e.readUint16();
	}
	write(e) {
		this.version = 0, this.size = 4, this.writeHeader(e), e.writeUint16(this.balance), e.writeUint16(0);
	}
}, $t.fourcc = "smhd", $t), ca = (en = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ChunkOffsetBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.chunk_offsets = [], this.version === 0) for (let n = 0; n < t; n++) this.chunk_offsets.push(e.readUint32());
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4 + 4 * this.chunk_offsets.length, this.writeHeader(e), e.writeUint32(this.chunk_offsets.length), e.writeUint32Array(this.chunk_offsets);
	}
	unpack(e) {
		for (let t = 0; t < this.chunk_offsets.length; t++) e[t].offset = this.chunk_offsets[t];
	}
}, en.fourcc = "stco", en), la = (tn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SubtitleMediaHeaderBox";
	}
}, tn.fourcc = "sthd", tn), ua = (nn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleToChunkBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.first_chunk = [], this.samples_per_chunk = [], this.sample_description_index = [], this.version === 0) for (let n = 0; n < t; n++) this.first_chunk.push(e.readUint32()), this.samples_per_chunk.push(e.readUint32()), this.sample_description_index.push(e.readUint32());
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4 + 12 * this.first_chunk.length, this.writeHeader(e), e.writeUint32(this.first_chunk.length);
		for (let t = 0; t < this.first_chunk.length; t++) e.writeUint32(this.first_chunk[t]), e.writeUint32(this.samples_per_chunk[t]), e.writeUint32(this.sample_description_index[t]);
	}
	unpack(e) {
		let t = 0, n = 0;
		for (let r = 0; r < this.first_chunk.length; r++) for (let i = 0; i < (r + 1 < this.first_chunk.length ? this.first_chunk[r + 1] : Infinity); i++) {
			n++;
			for (let i = 0; i < this.samples_per_chunk[r]; i++) {
				if (e[t]) e[t].description_index = this.sample_description_index[r], e[t].chunk_index = n;
				else return;
				t++;
			}
		}
	}
}, nn.fourcc = "stsc", nn), da = (rn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleDescriptionBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.entries = [];
		let t = e.readUint32();
		for (let n = 1; n <= t; n++) {
			let t = V(e, !0, this.size - (e.getPosition() - this.start));
			if (t.code === 1) {
				let n;
				t.type in R.sampleEntry ? (n = new R.sampleEntry[t.type](t.size), n.hdr_size = t.hdr_size, n.start = t.start) : (N.warn("BoxParser", `Unknown sample entry type: '${t.type}'`), n = new U(t.size, t.hdr_size, t.start), n.type = t.type), n.write === U.prototype.write && (N.info("BoxParser", "SampleEntry " + n.type + " box writing not yet implemented, keeping unparsed data in memory for later write"), n.parseDataAndRewind(e)), n.parse(e), this.entries.push(n);
			} else return;
		}
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 0, this.writeHeader(e), e.writeUint32(this.entries.length), this.size += 4;
		for (let t = 0; t < this.entries.length; t++) this.entries[t].write(e), this.size += this.entries[t].size;
		N.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size), e.adjustUint32(this.sizePosition, this.size);
	}
}, rn.fourcc = "stsd", rn), fa = (an = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleSizeBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.sample_sizes = [], this.version === 0) {
			this.sample_size = e.readUint32(), this.sample_count = e.readUint32();
			for (let t = 0; t < this.sample_count; t++) this.sample_size === 0 ? this.sample_sizes.push(e.readUint32()) : this.sample_sizes[t] = this.sample_size;
		}
	}
	write(e) {
		let t = !0;
		this.version = 0, this.flags = 0, this.sample_sizes.length > 0 && this.sample_size === 0 && (t = !1), this.size = 8, t || (this.size += 4 * this.sample_sizes.length), this.writeHeader(e), e.writeUint32(this.sample_size), e.writeUint32(this.sample_sizes.length), t || e.writeUint32Array(this.sample_sizes);
	}
	unpack(e) {
		for (let t = 0; t < this.sample_sizes.length; t++) e[t].size = this.sample_sizes[t];
	}
}, an.fourcc = "stsz", an), pa = (on = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TimeToSampleBox", this.sample_counts = [], this.sample_deltas = [];
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.sample_counts.length = 0, this.sample_deltas.length = 0, this.version === 0) for (let n = 0; n < t; n++) {
			this.sample_counts.push(e.readUint32());
			let t = e.readInt32();
			t < 0 && (N.warn("BoxParser", "File uses negative stts sample delta, using value 1 instead, sync may be lost!"), t = 1), this.sample_deltas.push(t);
		}
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4 + 8 * this.sample_counts.length, this.writeHeader(e), e.writeUint32(this.sample_counts.length);
		for (let t = 0; t < this.sample_counts.length; t++) e.writeUint32(this.sample_counts[t]), e.writeUint32(this.sample_deltas[t]);
	}
	unpack(e) {
		let t = 0;
		for (let n = 0; n < this.sample_counts.length; n++) for (let r = 0; r < this.sample_counts[n]; r++) t === 0 ? e[t].dts = 0 : e[t].dts = e[t - 1].dts + this.sample_deltas[n], t++;
	}
}, on.fourcc = "stts", on), ma = (sn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackFragmentBaseMediaDecodeTimeBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.baseMediaDecodeTime = this.version === 1 ? e.readUint64() : e.readUint32();
	}
	write(e) {
		let t = this.baseMediaDecodeTime > O || this.version === 1;
		this.version = +!!t, this.size = 4, this.size += t ? 4 : 0, this.flags = 0, this.writeHeader(e), t ? e.writeUint64(this.baseMediaDecodeTime) : e.writeUint32(this.baseMediaDecodeTime);
	}
}, sn.fourcc = "tfdt", sn), ha = (cn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackFragmentHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = 0;
		this.track_id = e.readUint32(), this.size - this.hdr_size > t && this.flags & 1 ? (this.base_data_offset = e.readUint64(), t += 8) : this.base_data_offset = 0, this.size - this.hdr_size > t && this.flags & 2 ? (this.default_sample_description_index = e.readUint32(), t += 4) : this.default_sample_description_index = 0, this.size - this.hdr_size > t && this.flags & 8 ? (this.default_sample_duration = e.readUint32(), t += 4) : this.default_sample_duration = 0, this.size - this.hdr_size > t && this.flags & 16 ? (this.default_sample_size = e.readUint32(), t += 4) : this.default_sample_size = 0, this.size - this.hdr_size > t && this.flags & 32 ? (this.default_sample_flags = e.readUint32(), t += 4) : this.default_sample_flags = 0;
	}
	write(e) {
		this.version = 0, this.size = 4, this.flags & 1 && (this.size += 8), this.flags & 2 && (this.size += 4), this.flags & 8 && (this.size += 4), this.flags & 16 && (this.size += 4), this.flags & 32 && (this.size += 4), this.writeHeader(e), e.writeUint32(this.track_id), this.flags & 1 && e.writeUint64(this.base_data_offset), this.flags & 2 && e.writeUint32(this.default_sample_description_index), this.flags & 8 && e.writeUint32(this.default_sample_duration), this.flags & 16 && e.writeUint32(this.default_sample_size), this.flags & 32 && e.writeUint32(this.default_sample_flags);
	}
}, cn.fourcc = "tfhd", cn), ga = (ln = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackHeaderBox", this.layer = 0, this.alternate_group = 0;
	}
	parse(e) {
		this.parseFullHeader(e), this.version === 1 ? (this.creation_time = e.readUint64(), this.modification_time = e.readUint64(), this.track_id = e.readUint32(), e.readUint32(), this.duration = e.readUint64()) : (this.creation_time = e.readUint32(), this.modification_time = e.readUint32(), this.track_id = e.readUint32(), e.readUint32(), this.duration = e.readUint32()), e.readUint32Array(2), this.layer = e.readInt16(), this.alternate_group = e.readInt16(), this.volume = e.readInt16() >> 8, e.readUint16(), this.matrix = e.readInt32Array(9), this.width = e.readUint32(), this.height = e.readUint32();
	}
	write(e) {
		let t = this.modification_time > O || this.creation_time > O || this.duration > O || this.version === 1;
		this.version = +!!t, this.size = 80, this.size += t ? 12 : 0, this.flags = this.flags ?? 3, this.writeHeader(e), t ? (e.writeUint64(this.creation_time), e.writeUint64(this.modification_time), e.writeUint32(this.track_id), e.writeUint32(0), e.writeUint64(this.duration)) : (e.writeUint32(this.creation_time), e.writeUint32(this.modification_time), e.writeUint32(this.track_id), e.writeUint32(0), e.writeUint32(this.duration)), e.writeUint32Array([0, 0]), e.writeInt16(this.layer), e.writeInt16(this.alternate_group), e.writeInt16(this.volume << 8), e.writeInt16(0), e.writeInt32Array(this.matrix), e.writeUint32(this.width), e.writeUint32(this.height);
	}
	print(e) {
		super.printHeader(e), e.log(e.indent + "creation_time: " + this.creation_time), e.log(e.indent + "modification_time: " + this.modification_time), e.log(e.indent + "track_id: " + this.track_id), e.log(e.indent + "duration: " + this.duration), e.log(e.indent + "volume: " + (this.volume >> 8)), e.log(e.indent + "matrix: " + this.matrix.join(", ")), e.log(e.indent + "layer: " + this.layer), e.log(e.indent + "alternate_group: " + this.alternate_group), e.log(e.indent + "width: " + this.width), e.log(e.indent + "height: " + this.height);
	}
}, ln.fourcc = "tkhd", ln), _a = (un = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackExtendsBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.track_id = e.readUint32(), this.default_sample_description_index = e.readUint32(), this.default_sample_duration = e.readUint32(), this.default_sample_size = e.readUint32(), this.default_sample_flags = e.readUint32();
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 20, this.writeHeader(e), e.writeUint32(this.track_id), e.writeUint32(this.default_sample_description_index), e.writeUint32(this.default_sample_duration), e.writeUint32(this.default_sample_size), e.writeUint32(this.default_sample_flags);
	}
}, un.fourcc = "trex", un), va = (dn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackRunBox", this.sample_duration = [], this.sample_size = [], this.sample_flags = [], this.sample_composition_time_offset = [];
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = 0;
		if (this.sample_count = e.readUint32(), t += 4, this.size - this.hdr_size > t && this.flags & 1 ? (this.data_offset = e.readInt32(), t += 4) : this.data_offset = 0, this.size - this.hdr_size > t && this.flags & 4 ? (this.first_sample_flags = e.readUint32(), t += 4) : this.first_sample_flags = 0, this.sample_duration = [], this.sample_size = [], this.sample_flags = [], this.sample_composition_time_offset = [], this.size - this.hdr_size > t) for (let t = 0; t < this.sample_count; t++) this.flags & 256 && (this.sample_duration[t] = e.readUint32()), this.flags & 512 && (this.sample_size[t] = e.readUint32()), this.flags & 1024 && (this.sample_flags[t] = e.readUint32()), this.flags & 2048 && (this.version === 0 ? this.sample_composition_time_offset[t] = e.readUint32() : this.sample_composition_time_offset[t] = e.readInt32());
	}
	write(e) {
		this.size = 4, this.flags & 1 && (this.size += 4), this.flags & 4 && (this.size += 4), this.flags & 256 && (this.size += 4 * this.sample_duration.length), this.flags & 512 && (this.size += 4 * this.sample_size.length), this.flags & 1024 && (this.size += 4 * this.sample_flags.length), this.flags & 2048 && (this.size += 4 * this.sample_composition_time_offset.length), this.writeHeader(e), e.writeUint32(this.sample_count), this.flags & 1 && (this.data_offset_position = e.getPosition(), e.writeInt32(this.data_offset)), this.flags & 4 && e.writeUint32(this.first_sample_flags);
		for (let t = 0; t < this.sample_count; t++) this.flags & 256 && e.writeUint32(this.sample_duration[t]), this.flags & 512 && e.writeUint32(this.sample_size[t]), this.flags & 1024 && e.writeUint32(this.sample_flags[t]), this.flags & 2048 && (this.version === 0 ? e.writeUint32(this.sample_composition_time_offset[t]) : e.writeInt32(this.sample_composition_time_offset[t]));
	}
}, dn.fourcc = "trun", dn), ya = (fn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "DataEntryUrlBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.flags !== 1 && (this.location = e.readCString());
	}
	write(e) {
		this.version = 0, this.location ? (this.flags = 0, this.size = this.location.length + 1) : (this.flags = 1, this.size = 0), this.writeHeader(e), this.location && e.writeCString(this.location);
	}
}, fn.fourcc = "url ", fn), ba = (pn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "VideoMediaHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.graphicsmode = e.readUint16(), this.opcolor = e.readUint16Array(3);
	}
	write(e) {
		this.version = 0, this.size = 8, this.writeHeader(e), e.writeUint16(this.graphicsmode), e.writeUint16Array(this.opcolor);
	}
}, pn.fourcc = "vmhd", pn), xa = class {
	constructor(e, t, n) {
		this.grouping_type = e, this.grouping_type_parameter = t, this.sbgp = n, this.last_sample_in_run = -1, this.entry_index = -1;
	}
}, Sa = class e {
	constructor(e, t = !0) {
		this.boxes = [], this.mdats = [], this.moofs = [], this.isProgressive = !1, this.moovStartFound = !1, this.moovStartSent = !1, this.readySent = !1, this.sampleListBuilt = !1, this.fragmentedTracks = [], this.extractedTracks = [], this.isFragmentationInitialized = !1, this.sampleProcessingStarted = !1, this.nextMoofNumber = 0, this.itemListBuilt = !1, this.sidxSent = !1, this.items = [], this.entity_groups = [], this.itemsDataSize = 0, this.lastMoofIndex = 0, this.samplesDataSize = 0, this.lastBoxStartPosition = 0, this.nextParsePosition = 0, this.discardMdatData = !0, this.discardMdatData = t, e ? (this.stream = e, this.parse()) : this.stream = new P(), this.stream.isofile = this;
	}
	setSegmentOptions(e, t, n) {
		let { sizePerSegment: r = 2 ** 53 - 1, rapAlignement: i = !0, normalizeAudioSampleEntriesForMSE: a = !0 } = n, o = n.nbSamples ?? n.nbSamplesPerFragment ?? 1e3, s = n.nbSamplesPerFragment ?? o;
		if (o <= 0 || s <= 0 || r <= 0) {
			N.error("ISOFile", `Invalid segment options: nbSamples=${o}, nbSamplesPerFragment=${s}, sizePerSegment=${r}`);
			return;
		}
		if (o < s && (N.warn("ISOFile", `nbSamples (${o}) is less than nbSamplesPerFragment (${s}), setting nbSamples to nbSamplesPerFragment`), o = s), this.fragmentedTracks.some((e) => e.nb_samples !== o)) {
			N.error("ISOFile", `Cannot set segment options for track ${e}: nbSamples (${o}) does not match existing tracks`);
			return;
		}
		let c = this.getTrackById(e);
		if (c) {
			let n = {
				id: e,
				user: t,
				trak: c,
				segmentStream: void 0,
				nb_samples: o,
				nb_samples_per_fragment: s,
				size_per_segment: r,
				rapAlignement: i,
				normalizeAudioSampleEntriesForMSE: a,
				state: {
					lastFragmentSampleNumber: 0,
					lastSegmentSampleNumber: 0,
					accumulatedSize: 0
				}
			};
			this.fragmentedTracks.push(n), c.nextSample = 0;
		}
		this.discardMdatData && N.warn("ISOFile", "Segmentation options set but discardMdatData is true, samples will not be segmented");
	}
	unsetSegmentOptions(e) {
		let t = -1;
		for (let n = 0; n < this.fragmentedTracks.length; n++) this.fragmentedTracks[n].id === e && (t = n);
		t > -1 && this.fragmentedTracks.splice(t, 1);
	}
	setExtractionOptions(e, t, { nbSamples: n = 1e3 } = {}) {
		let r = this.getTrackById(e);
		r && (this.extractedTracks.push({
			id: e,
			user: t,
			trak: r,
			nb_samples: n,
			samples: []
		}), r.nextSample = 0), this.discardMdatData && N.warn("ISOFile", "Extraction options set but discardMdatData is true, samples will not be extracted");
	}
	unsetExtractionOptions(e) {
		let t = -1;
		for (let n = 0; n < this.extractedTracks.length; n++) this.extractedTracks[n].id === e && (t = n);
		t > -1 && this.extractedTracks.splice(t, 1);
	}
	parse() {
		if (!this.restoreParsePosition || this.restoreParsePosition()) for (;;) if (this.hasIncompleteMdat && this.hasIncompleteMdat()) {
			if (this.processIncompleteMdat()) continue;
			return;
		} else {
			this.saveParsePosition && this.saveParsePosition();
			let e = V(this.stream, !1);
			if (e.code === 0) {
				if (this.processIncompleteBox) {
					if (this.processIncompleteBox(e)) continue;
					return;
				}
				return;
			}
			if (e.code === 1) {
				let t = e.box;
				if (this.boxes.push(t), t.type === "uuid") this[t.uuid] !== void 0 && N.warn("ISOFile", "Duplicate Box of uuid: " + t.uuid + ", overriding previous occurrence"), this[t.uuid] = t;
				else switch (t.type) {
					case "mdat":
						this.mdats.push(t), this.transferMdatData(t);
						break;
					case "moof":
						this.moofs.push(t);
						break;
					case "free":
					case "skip": break;
					case "moov": this.moovStartFound = !0, this.mdats.length === 0 && (this.isProgressive = !0);
					default: this[t.type] === void 0 ? (this[t.type] = t, Array.isArray(this[t.type + "s"]) && this[t.type + "s"].push(t)) : Array.isArray(this[t.type + "s"]) ? (N.info("ISOFile", `Found multiple boxes of type ${t.type} in ISOFile, adding to array`), this[t.type + "s"].push(t)) : (N.warn("ISOFile", `Found multiple boxes of type ${t.type} but no array exists. Creating array dynamically.`), this[t.type + "s"] = [this[t.type], t]);
				}
				this.updateUsedBytes && this.updateUsedBytes(t, e);
			} else if (e.code === -1) {
				N.error("ISOFile", `Invalid data found while parsing box of type '${e.type}' at position ${e.start}. Aborting parsing.`, this);
				break;
			}
		}
	}
	checkBuffer(e) {
		if (!e) throw Error("Buffer must be defined and non empty");
		return e.byteLength === 0 ? (N.warn("ISOFile", "Ignoring empty buffer (fileStart: " + e.fileStart + ")"), this.stream.logBufferLevel(), !1) : (N.info("ISOFile", "Processing buffer (fileStart: " + e.fileStart + ")"), e.usedBytes = 0, this.stream.insertBuffer(e), this.stream.logBufferLevel(), this.stream.initialized() ? !0 : (N.warn("ISOFile", "Not ready to start parsing"), !1));
	}
	appendBuffer(e, t) {
		let n;
		if (this.checkBuffer(e)) return this.parse(), this.moovStartFound && !this.moovStartSent && (this.moovStartSent = !0, this.onMoovStart && this.onMoovStart()), this.moov ? (this.sampleListBuilt || (this.buildSampleLists(), this.sampleListBuilt = !0), this.updateSampleLists(), this.onReady && !this.readySent && (this.readySent = !0, this.onReady(this.getInfo())), this.processSamples(t), this.nextSeekPosition ? (n = this.nextSeekPosition, this.nextSeekPosition = void 0) : n = this.nextParsePosition, this.stream.getEndFilePositionAfter && (n = this.stream.getEndFilePositionAfter(n))) : n = this.nextParsePosition ? this.nextParsePosition : 0, this.sidx && this.onSidx && !this.sidxSent && (this.onSidx(this.sidx), this.sidxSent = !0), this.meta && (this.flattenItemInfo && !this.itemListBuilt && (this.flattenItemInfo(), this.itemListBuilt = !0), this.processItems && this.processItems(this.onItem)), this.stream.cleanBuffers && (N.info("ISOFile", "Done processing buffer (fileStart: " + e.fileStart + ") - next buffer to fetch should have a fileStart position of " + n), this.stream.logBufferLevel(), this.stream.cleanBuffers(), this.stream.logBufferLevel(!0), N.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize())), n;
	}
	getFragmentDuration() {
		let e = this.getBox("mvex");
		if (!e) return;
		if (e.mehd) return {
			num: e.mehd.fragment_duration,
			den: this.moov.mvhd.timescale
		};
		let t = this.getBoxes("trak", !1), n = {
			num: 0,
			den: 1
		};
		for (let e of t) {
			let t = e.samples_duration, r = e.mdia.mdhd.timescale;
			t && r && t / r > n.num / n.den && (n = {
				num: t,
				den: r
			});
		}
		return n;
	}
	getInfo() {
		if (!this.moov) return {
			hasMoov: !1,
			mime: ""
		};
		let e = (/* @__PURE__ */ new Date("1904-01-01T00:00:00Z")).getTime(), t = this.getBox("mvex") !== void 0, n = {
			hasMoov: !0,
			duration: this.moov.mvhd.duration,
			timescale: this.moov.mvhd.timescale,
			isFragmented: t,
			fragment_duration: this.getFragmentDuration(),
			isProgressive: this.isProgressive,
			hasIOD: this.moov.iods !== void 0,
			brands: [this.ftyp.major_brand].concat(this.ftyp.compatible_brands),
			created: new Date(e + this.moov.mvhd.creation_time * 1e3),
			modified: new Date(e + this.moov.mvhd.modification_time * 1e3),
			tracks: [],
			audioTracks: [],
			videoTracks: [],
			subtitleTracks: [],
			metadataTracks: [],
			hintTracks: [],
			otherTracks: [],
			mime: ""
		};
		for (let t = 0; t < this.moov.traks.length; t++) {
			let r = this.moov.traks[t], i = r.mdia.minf.stbl.stsd.entries[0], a = r.samples_size, o = r.mdia.mdhd.timescale, s = r.samples_duration, c = {
				samples_duration: s,
				bitrate: a * 8 * o / s,
				size: a,
				timescale: o,
				alternate_group: r.tkhd.alternate_group,
				codec: i.getCodec(),
				created: new Date(e + r.tkhd.creation_time * 1e3),
				cts_shift: r.mdia.minf.stbl.cslg,
				duration: r.mdia.mdhd.duration,
				id: r.tkhd.track_id,
				kind: r.udta && r.udta.kinds.length ? r.udta.kinds[0] : {
					schemeURI: "",
					value: ""
				},
				language: r.mdia.elng ? r.mdia.elng.extended_language : r.mdia.mdhd.languageString,
				layer: r.tkhd.layer,
				matrix: r.tkhd.matrix,
				modified: new Date(e + r.tkhd.modification_time * 1e3),
				movie_duration: r.tkhd.duration,
				movie_timescale: n.timescale,
				name: r.mdia.hdlr.name,
				nb_samples: r.samples.length,
				references: [],
				track_height: r.tkhd.height / 65536,
				track_width: r.tkhd.width / 65536,
				volume: r.tkhd.volume
			};
			if (n.tracks.push(c), r.tref) for (let e = 0; e < r.tref.references.length; e++) c.references.push({
				type: r.tref.references[e].type,
				track_ids: r.tref.references[e].track_ids
			});
			r.edts !== void 0 && r.edts.elst !== void 0 && (c.edits = r.edts.elst.entries), i instanceof q ? (c.type = "audio", n.audioTracks.push(c), c.audio = {
				sample_rate: i.getSampleRate(),
				channel_count: i.getChannelCount(),
				sample_size: i.getSampleSize()
			}) : i instanceof K ? (c.type = "video", n.videoTracks.push(c), c.video = {
				width: i.getWidth(),
				height: i.getHeight()
			}) : i instanceof G ? (c.type = "subtitles", n.subtitleTracks.push(c)) : i instanceof Vn ? (c.type = "metadata", n.hintTracks.push(c)) : i instanceof W ? (c.type = "metadata", n.metadataTracks.push(c)) : (c.type = "metadata", n.otherTracks.push(c));
		}
		n.videoTracks && n.videoTracks.length > 0 ? n.mime += "video/mp4; codecs=\"" : n.audioTracks && n.audioTracks.length > 0 ? n.mime += "audio/mp4; codecs=\"" : n.mime += "application/mp4; codecs=\"";
		for (let e = 0; e < n.tracks.length; e++) e !== 0 && (n.mime += ","), n.mime += n.tracks[e].codec;
		return n.mime += "\"; profiles=\"", n.mime += this.ftyp.compatible_brands.join(), n.mime += "\"", n;
	}
	setNextSeekPositionFromSample(e) {
		e && (this.nextSeekPosition = this.nextSeekPosition ? Math.min(e.offset + e.alreadyRead, this.nextSeekPosition) : e.offset + e.alreadyRead);
	}
	processSamples(e) {
		if (this.sampleProcessingStarted) {
			if (this.isFragmentationInitialized && this.onSegment !== void 0) {
				let t = /* @__PURE__ */ new Set();
				for (; t.size < this.fragmentedTracks.length && this.fragmentedTracks.some((e) => e.trak.nextSample < e.trak.samples.length) && this.sampleProcessingStarted;) for (let n of this.fragmentedTracks) {
					let r = n.trak;
					if (!t.has(n.id)) {
						let i = r.nextSample < r.samples.length ? this.getSample(r, r.nextSample) : void 0;
						if (!i) {
							this.setNextSeekPositionFromSample(r.samples[r.nextSample]), t.add(n.id);
							continue;
						}
						n.state.accumulatedSize += i.size;
						let a = r.nextSample + 1, o = a - n.state.lastFragmentSampleNumber > n.nb_samples_per_fragment, s = a - n.state.lastSegmentSampleNumber > n.nb_samples, c = o || a % n.nb_samples_per_fragment === 0, l = s || a % n.nb_samples === 0, u = n.state.accumulatedSize >= n.size_per_segment, d = !n.rapAlignement || i.is_sync, f = e || r.nextSample + 1 >= r.samples.length;
						if (f && !d && N.warn("ISOFile", "Flushing track #" + n.id + " at sample #" + r.nextSample + " which is not a RAP, this may lead to playback issues"), c = c && d, l = l && d, u = u && d, c || u || f) {
							o ? N.warn("ISOFile", "Fragment on track #" + n.id + " is overdue, creating it with samples [" + n.state.lastFragmentSampleNumber + ", " + r.nextSample + "]") : N.debug("ISOFile", "Creating media fragment on track #" + n.id + " for samples [" + n.state.lastFragmentSampleNumber + ", " + r.nextSample + "]");
							let e = this.createFragment(n.id, n.state.lastFragmentSampleNumber, r.nextSample, n.segmentStream);
							if (e) n.segmentStream = e, n.state.lastFragmentSampleNumber = r.nextSample + 1;
							else {
								t.add(n.id);
								continue;
							}
						}
						(l || u || f) && (s ? N.warn("ISOFile", "Segment on track #" + n.id + " is overdue, sending it with samples [" + Math.max(0, r.nextSample - n.nb_samples) + ", " + (r.nextSample - 1) + "]") : N.info("ISOFile", "Sending fragmented data on track #" + n.id + " for samples [" + Math.max(0, r.nextSample - n.nb_samples) + ", " + (r.nextSample - 1) + "]"), N.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize()), this.onSegment && this.onSegment(n.id, n.user, n.segmentStream.buffer, r.nextSample + 1, e || r.nextSample + 1 >= r.samples.length), n.segmentStream = void 0, n.state.accumulatedSize = 0, n.state.lastSegmentSampleNumber = r.nextSample + 1), r.nextSample++;
					}
				}
			}
			if (this.onSamples !== void 0) for (let e = 0; e < this.extractedTracks.length; e++) {
				let t = this.extractedTracks[e], n = t.trak;
				for (; n.nextSample < n.samples.length && this.sampleProcessingStarted;) {
					N.debug("ISOFile", "Exporting on track #" + t.id + " sample #" + n.nextSample);
					let r = this.getSample(n, n.nextSample);
					if (r) n.nextSample++, t.samples.push(r);
					else {
						this.setNextSeekPositionFromSample(n.samples[n.nextSample]);
						break;
					}
					if ((n.nextSample % t.nb_samples === 0 || n.nextSample >= n.samples.length) && (N.debug("ISOFile", "Sending samples on track #" + t.id + " for sample " + n.nextSample), this.onSamples && this.onSamples(t.id, t.user, t.samples), t.samples = [], t !== this.extractedTracks[e])) break;
				}
			}
		}
	}
	getBox(e) {
		let t = this.getBoxes(e, !0);
		return t.length ? t[0] : void 0;
	}
	getBoxes(e, t) {
		let n = [], r = (i) => {
			i instanceof F && i.type && i.type === e && n.push(i);
			let a = [];
			i.boxes && a.push(...i.boxes), i.entries && a.push(...i.entries), i.item_infos && a.push(...i.item_infos), i.references && a.push(...i.references);
			for (let e of a) {
				if (n.length && t) return;
				r(e);
			}
		};
		return r(this), n;
	}
	getTrackSamplesInfo(e) {
		let t = this.getTrackById(e);
		if (t) return t.samples;
	}
	getTrackSample(e, t) {
		let n = this.getTrackById(e);
		return this.getSample(n, t);
	}
	releaseUsedSamples(e, t) {
		let n = 0, r = this.getTrackById(e);
		r.lastValidSample || (r.lastValidSample = 0);
		for (let e = r.lastValidSample; e < t; e++) n += this.releaseSample(r, e);
		N.info("ISOFile", "Track #" + e + " released samples up to " + t + " (released size: " + n + ", remaining: " + this.samplesDataSize + ")"), r.lastValidSample = t;
	}
	start() {
		this.sampleProcessingStarted = !0, this.processSamples(!1);
	}
	stop() {
		this.sampleProcessingStarted = !1;
	}
	flush() {
		N.info("ISOFile", "Flushing remaining samples"), this.updateSampleLists(), this.processSamples(!0), this.stream.cleanBuffers(), this.stream.logBufferLevel(!0);
	}
	seekTrack(e, t, n) {
		let r = 0, i = 0, a;
		if (n.samples.length === 0) return N.info("ISOFile", "No sample in track, cannot seek! Using time " + N.getDurationString(0, 1) + " and offset: 0"), {
			offset: 0,
			time: 0
		};
		for (let o = 0; o < n.samples.length; o++) {
			let s = n.samples[o];
			if (o === 0) i = 0, a = s.timescale;
			else if (s.cts > e * s.timescale) {
				i = o - 1;
				break;
			}
			t && s.is_sync && (r = o);
		}
		for (t && (i = r), e = n.samples[i].cts, n.nextSample = i, this.resetFragmentedTrackStateAfterSeek(n, i), this.resetExtractedTrackStateAfterSeek(n); n.samples[i].alreadyRead === n.samples[i].size && n.samples[i + 1];) i++;
		let o = n.samples[i].offset + n.samples[i].alreadyRead;
		return N.info("ISOFile", "Seeking to " + (t ? "RAP" : "") + " sample #" + n.nextSample + " on track " + n.tkhd.track_id + ", time " + N.getDurationString(e, a) + " and offset: " + o), {
			offset: o,
			time: e / a
		};
	}
	resetFragmentedTrackStateAfterSeek(e, t) {
		let n = this.fragmentedTracks.find((t) => t.trak === e);
		n && (n.state.lastFragmentSampleNumber = t, n.state.lastSegmentSampleNumber = t, n.state.accumulatedSize = 0, n.segmentStream = void 0);
	}
	resetExtractedTrackStateAfterSeek(e) {
		let t = this.extractedTracks.find((t) => t.trak === e);
		t && (t.samples = []);
	}
	getTrackDuration(e) {
		if (!e.samples) return Infinity;
		let t = e.samples[e.samples.length - 1];
		return (t.cts + t.duration) / t.timescale;
	}
	seek(e, t) {
		let n = this.moov, r = {
			offset: Infinity,
			time: Infinity
		};
		if (this.moov) {
			for (let i = 0; i < n.traks.length; i++) {
				let a = n.traks[i];
				if (e > this.getTrackDuration(a)) continue;
				let o = this.seekTrack(e, t, a);
				o.offset < r.offset && (r.offset = o.offset), o.time < r.time && (r.time = o.time);
			}
			return N.info("ISOFile", "Seeking at time " + N.getDurationString(r.time, 1) + " needs a buffer with a fileStart position of " + r.offset), r.offset === Infinity ? r = {
				offset: this.nextParsePosition,
				time: 0
			} : r.offset = this.stream.getEndFilePositionAfter(r.offset), N.info("ISOFile", "Adjusted seek position (after checking data already in buffer): " + r.offset), r;
		}
		throw Error("Cannot seek: moov not received!");
	}
	equal(e) {
		let t = 0;
		for (; t < this.boxes.length && t < e.boxes.length;) {
			let n = this.boxes[t], r = e.boxes[t];
			if (!Nn(n, r)) return !1;
			t++;
		}
		return !0;
	}
	write(e) {
		for (let t = 0; t < this.boxes.length; t++) this.boxes[t].write(e);
	}
	createFragment(e, t, n, r) {
		if (n < t) return N.warn("ISOFile", `Skipping fragment creation on track #${e}: invalid sample range [${t}, ${n}]`), r || new A();
		let i = [];
		for (let r = t; r <= n; r++) {
			let t = this.getTrackById(e), n = this.getSample(t, r);
			if (!n) {
				this.setNextSeekPositionFromSample(t.samples[r]);
				return;
			}
			i.push(n);
		}
		let a = r || new A(), o = this.createMoof(i);
		o.write(a), o.trafs[0].truns[0].data_offset = o.size + 8, N.debug("MP4Box", "Adjusting data_offset with new value " + o.trafs[0].truns[0].data_offset), a.adjustUint32(o.trafs[0].truns[0].data_offset_position, o.trafs[0].truns[0].data_offset);
		let s = new Kn();
		s.stream = new P();
		let c = 0;
		for (let e of i) if (e.data) {
			let t = k.fromArrayBuffer(e.data.buffer, c);
			s.stream.insertBuffer(t), c += e.data.byteLength;
		}
		return s.write(a), a;
	}
	static writeInitializationSegment(t, n, r, i) {
		N.debug("ISOFile", "Generating initialization segment");
		let a = new A();
		t.write(a);
		let o = e.normalizeAudioSampleEntriesForMSEFragmentedInit(n.traks, i);
		try {
			let e = n.addBox(new lr());
			if (r) {
				let t = e.addBox(new Ir());
				t.fragment_duration = r;
			}
			for (let t = 0; t < n.traks.length; t++) {
				let r = e.addBox(new _a());
				r.track_id = n.traks[t].tkhd.track_id, r.default_sample_description_index = 1, r.default_sample_duration = n.traks[t].samples[0]?.duration ?? 0, r.default_sample_size = 0, r.default_sample_flags = 65536;
			}
			n.write(a);
		} finally {
			for (let e = o.length - 1; e >= 0; e--) o[e]();
		}
		return a.buffer;
	}
	save(e) {
		let t = new A();
		return t.isofile = this, this.write(t), t.save(e);
	}
	getBuffer() {
		let e = new A();
		return e.isofile = this, this.write(e), e;
	}
	static normalizeAudioSampleEntriesForMSEFragmentedInit(e, t) {
		let n = [];
		for (let r of e) if (t?.has(r.tkhd.track_id)) for (let e of r.mdia.minf.stbl.stsd?.entries ?? []) {
			if (!(e instanceof Ni)) continue;
			let t = e.wave?.esds;
			if (e.esds || !t) continue;
			let r = e.esds, i = e.wave, a = e.boxes;
			n.push(() => {
				e.esds = r, e.wave = i, e.boxes = a;
			});
			let o = Array.isArray(e.boxes) ? e.boxes.filter((e) => e?.type !== "wave" && e?.type !== "esds") : [];
			e.esds = t, e.boxes = [...o, t], e.wave = void 0;
		}
		return n;
	}
	initializeSegmentation(t) {
		if (this.onSegment || N.warn("MP4Box", "No segmentation callback set!"), t !== void 0 && t !== "combined" && t !== "per-track") throw Error(`Invalid segmentation mode: ${t}`);
		this.isFragmentationInitialized || (this.isFragmentationInitialized = !0, this.resetTables());
		let n = [];
		for (let e of this.fragmentedTracks) {
			let t = this.getTrackById(e.id);
			t ? n.push({
				id: e.id,
				user: e.user,
				trak: t
			}) : N.warn("ISOFile", `Track with id ${e.id} not found, skipping fragmentation initialization`);
		}
		let r = this.moov?.mvex?.mehd?.fragment_duration, i = new Set(this.fragmentedTracks.filter((e) => e.normalizeAudioSampleEntriesForMSE !== !1).map((e) => e.id));
		if (t === "per-track") return n.map(({ id: t, user: n, trak: a }) => {
			let o = new nr();
			return o.addBox(this.moov.mvhd), o.addBox(a), {
				id: t,
				user: n,
				buffer: e.writeInitializationSegment(this.ftyp, o, r, i)
			};
		});
		let a = new nr();
		a.addBox(this.moov.mvhd);
		for (let e of n) a.addBox(e.trak);
		return {
			tracks: n.map(({ id: e, user: t }) => ({
				id: e,
				user: t
			})),
			buffer: e.writeInitializationSegment(this.ftyp, a, r, i)
		};
	}
	resetTables() {
		this.initial_duration = this.moov.mvhd.duration, this.moov.mvhd.duration = 0;
		for (let e = 0; e < this.moov.traks.length; e++) {
			let t = this.moov.traks[e];
			t.tkhd.duration = 0, t.mdia.mdhd.duration = 0;
			let n = t.mdia.minf.stbl.stco || t.mdia.minf.stbl.co64;
			n.chunk_offsets = [];
			let r = t.mdia.minf.stbl.stsc;
			r.first_chunk = [], r.samples_per_chunk = [], r.sample_description_index = [];
			let i = t.mdia.minf.stbl.stsz || t.mdia.minf.stbl.stz2;
			i.sample_sizes = [];
			let a = t.mdia.minf.stbl.stts;
			a.sample_counts = [], a.sample_deltas = [];
			let o = t.mdia.minf.stbl.ctts;
			o && (o.sample_counts = [], o.sample_offsets = []);
			let s = t.mdia.minf.stbl.stss, c = t.mdia.minf.stbl.boxes.indexOf(s);
			c !== -1 && (t.mdia.minf.stbl.boxes[c] = void 0);
		}
	}
	static initSampleGroups(e, t, n, r, i) {
		t && (t.sample_groups_info = []), e.sample_groups_info || (e.sample_groups_info = []);
		for (let a = 0; a < n.length; a++) {
			let o = n[a].grouping_type + "/" + n[a].grouping_type_parameter, s = new xa(n[a].grouping_type, n[a].grouping_type_parameter, n[a]);
			t && (t.sample_groups_info[o] = s), e.sample_groups_info[o] || (e.sample_groups_info[o] = s);
			for (let e = 0; e < r.length; e++) r[e].grouping_type === n[a].grouping_type && (s.description = r[e], s.description.used = !0);
			if (i) for (let e = 0; e < i.length; e++) i[e].grouping_type === n[a].grouping_type && (s.fragment_description = i[e], s.fragment_description.used = !0, s.is_fragment = !0);
		}
		if (!t) {
			for (let t = 0; t < r.length; t++) if (!r[t].used && r[t].version >= 2) {
				let n = r[t].grouping_type + "/0", i = new xa(r[t].grouping_type, 0);
				e.sample_groups_info[n] || (e.sample_groups_info[n] = i);
			}
		} else if (i) {
			for (let e = 0; e < i.length; e++) if (!i[e].used && i[e].version >= 2) {
				let n = i[e].grouping_type + "/0", r = new xa(i[e].grouping_type, 0);
				r.is_fragment = !0, t.sample_groups_info[n] || (t.sample_groups_info[n] = r);
			}
		}
	}
	static setSampleGroupProperties(e, t, n, r) {
		t.sample_groups = [];
		for (let e in r) if (t.sample_groups[e] = {
			grouping_type: r[e].grouping_type,
			grouping_type_parameter: r[e].grouping_type_parameter
		}, n >= r[e].last_sample_in_run && (r[e].last_sample_in_run < 0 && (r[e].last_sample_in_run = 0), r[e].entry_index++, r[e].entry_index <= r[e].sbgp.entries.length - 1 && (r[e].last_sample_in_run += r[e].sbgp.entries[r[e].entry_index].sample_count)), r[e].entry_index <= r[e].sbgp.entries.length - 1 ? t.sample_groups[e].group_description_index = r[e].sbgp.entries[r[e].entry_index].group_description_index : t.sample_groups[e].group_description_index = -1, t.sample_groups[e].group_description_index !== 0) {
			let n;
			if (n = r[e].fragment_description ? r[e].fragment_description : r[e].description, t.sample_groups[e].group_description_index > 0) {
				let r;
				r = t.sample_groups[e].group_description_index > 65535 ? (t.sample_groups[e].group_description_index >> 16) - 1 : t.sample_groups[e].group_description_index - 1, n && r >= 0 && (t.sample_groups[e].description = n.entries[r]);
			} else n && n.version >= 2 && n.default_group_description_index > 0 && (t.sample_groups[e].description = n.entries[n.default_group_description_index - 1]);
		}
	}
	static process_sdtp(e, t, n) {
		t && (e ? (t.is_leading = e.is_leading[n], t.depends_on = e.sample_depends_on[n], t.is_depended_on = e.sample_is_depended_on[n], t.has_redundancy = e.sample_has_redundancy[n]) : (t.is_leading = 0, t.depends_on = 0, t.is_depended_on = 0, t.has_redundancy = 0));
	}
	buildSampleLists() {
		for (let e = 0; e < this.moov.traks.length; e++) this.buildTrakSampleLists(this.moov.traks[e]);
	}
	buildTrakSampleLists(t) {
		let n, r, i, a, o, s;
		t.samples = [], t.samples_duration = 0, t.samples_size = 0;
		let c = t.mdia.minf.stbl.stco || t.mdia.minf.stbl.co64, l = t.mdia.minf.stbl.stsc, u = t.mdia.minf.stbl.stsz || t.mdia.minf.stbl.stz2, d = t.mdia.minf.stbl.stts, f = t.mdia.minf.stbl.ctts, p = t.mdia.minf.stbl.stss, m = t.mdia.minf.stbl.stsd, h = t.mdia.minf.stbl.subs, g = t.mdia.minf.stbl.stdp, _ = t.mdia.minf.stbl.sbgps, v = t.mdia.minf.stbl.sgpds, y = -1, b = -1, x = -1, S = -1, C = 0, w = 0, T = 0;
		if (e.initSampleGroups(t, void 0, _, v), u !== void 0) {
			for (n = 0; n < u.sample_sizes.length; n++) {
				let E = {
					number: n,
					track_id: t.tkhd.track_id,
					timescale: t.mdia.mdhd.timescale,
					alreadyRead: 0,
					size: u.sample_sizes[n]
				};
				t.samples[n] = E, t.samples_size += E.size, n === 0 ? (i = 1, r = 0, E.chunk_index = i, E.chunk_run_index = r, s = l.samples_per_chunk[r], o = 0, a = r + 1 < l.first_chunk.length ? l.first_chunk[r + 1] - 1 : Infinity) : n < s ? (E.chunk_index = i, E.chunk_run_index = r) : (i++, E.chunk_index = i, o = 0, i <= a || (r++, a = r + 1 < l.first_chunk.length ? l.first_chunk[r + 1] - 1 : Infinity), E.chunk_run_index = r, s += l.samples_per_chunk[r]), E.description_index = l.sample_description_index[E.chunk_run_index] - 1, E.description = m.entries[E.description_index], E.offset = c.chunk_offsets[E.chunk_index - 1] + o, o += E.size, n > y && (b++, y < 0 && (y = 0), y += d.sample_counts[b]), n > 0 ? (t.samples[n - 1].duration = d.sample_deltas[b], t.samples_duration += t.samples[n - 1].duration, E.dts = t.samples[n - 1].dts + t.samples[n - 1].duration) : E.dts = 0, f ? (n >= x && (S++, x < 0 && (x = 0), x += f.sample_counts[S]), E.cts = t.samples[n].dts + f.sample_offsets[S]) : E.cts = E.dts, p ? (n === p.sample_numbers[C] - 1 ? (E.is_sync = !0, C++) : (E.is_sync = !1, E.degradation_priority = 0), h && h.entries[w].sample_delta + T === n + 1 && (E.subsamples = h.entries[w].subsamples, T += h.entries[w].sample_delta, w++)) : E.is_sync = !0, e.process_sdtp(t.mdia.minf.stbl.sdtp, E, E.number), E.degradation_priority = g ? g.priority[n] : 0, h && h.entries[w].sample_delta + T === n && (E.subsamples = h.entries[w].subsamples, T += h.entries[w].sample_delta), (_.length > 0 || v.length > 0) && e.setSampleGroupProperties(t, E, n, t.sample_groups_info);
			}
			n > 0 && (t.samples[n - 1].duration = Math.max(t.mdia.mdhd.duration - t.samples[n - 1].dts, 0), t.samples_duration += t.samples[n - 1].duration);
		}
	}
	updateSampleLists() {
		let t, n, r, i, a;
		if (this.moov !== void 0) for (; this.lastMoofIndex < this.moofs.length;) {
			let o = this.moofs[this.lastMoofIndex];
			if (this.lastMoofIndex++, o.type === "moof") {
				let s = o;
				for (let o = 0; o < s.trafs.length; o++) {
					let c = s.trafs[o], l = this.getTrackById(c.tfhd.track_id), u = this.getTrexById(c.tfhd.track_id);
					t = c.tfhd.flags & 2 ? c.tfhd.default_sample_description_index : u ? u.default_sample_description_index : 1, n = c.tfhd.flags & 8 ? c.tfhd.default_sample_duration : u ? u.default_sample_duration : 0, r = c.tfhd.flags & 16 ? c.tfhd.default_sample_size : u ? u.default_sample_size : 0, i = c.tfhd.flags & 32 ? c.tfhd.default_sample_flags : u ? u.default_sample_flags : 0, c.sample_number = 0, c.sbgps.length > 0 && e.initSampleGroups(l, c, c.sbgps, l.mdia.minf.stbl.sgpds, c.sgpds);
					for (let o = 0; o < c.truns.length; o++) {
						let u = c.truns[o];
						for (let d = 0; d < u.sample_count; d++) {
							let f = t - 1, p = i;
							u.flags & 1024 ? p = u.sample_flags[d] : d === 0 && u.flags & 4 && (p = u.first_sample_flags);
							let m = r;
							u.flags & 512 && (m = u.sample_size[d]), l.samples_size += m;
							let h = n;
							u.flags & 256 && (h = u.sample_duration[d]), l.samples_duration += h;
							let g;
							l.first_traf_merged || d > 0 ? g = l.samples[l.samples.length - 1].dts + l.samples[l.samples.length - 1].duration : (g = c.tfdt ? c.tfdt.baseMediaDecodeTime : 0, l.first_traf_merged = !0);
							let _ = g;
							u.flags & 2048 && (_ = g + u.sample_composition_time_offset[d]);
							let v = !!(c.tfhd.flags & 1), y = !!(c.tfhd.flags & 131072), b = !!(u.flags & 1), x = 0;
							x = v ? c.tfhd.base_data_offset : y || o === 0 ? s.start : a;
							let S;
							S = o === 0 && d === 0 ? b ? x + u.data_offset : x : a, a = S + m;
							let C = c.sample_number;
							c.sample_number++;
							let w = {
								cts: _,
								description_index: f,
								description: l.mdia.minf.stbl.stsd.entries[f],
								dts: g,
								duration: h,
								moof_number: this.lastMoofIndex,
								number_in_traf: C,
								number: l.samples.length,
								offset: S,
								size: m,
								timescale: l.mdia.mdhd.timescale,
								track_id: l.tkhd.track_id,
								is_sync: !(p >> 16 & 1),
								is_leading: p >> 26 & 3,
								depends_on: p >> 24 & 3,
								is_depended_on: p >> 22 & 3,
								has_redundancy: p >> 20 & 3,
								degradation_priority: p & 65535
							};
							c.first_sample_index = l.samples.length, l.samples.push(w), (c.sbgps.length > 0 || c.sgpds.length > 0 || l.mdia.minf.stbl.sbgps.length > 0 || l.mdia.minf.stbl.sgpds.length > 0) && e.setSampleGroupProperties(l, w, w.number_in_traf, c.sample_groups_info);
						}
					}
					if (c.subs) {
						l.has_fragment_subsamples = !0;
						let e = c.first_sample_index;
						for (let t = 0; t < c.subs.entries.length; t++) {
							e += c.subs.entries[t].sample_delta;
							let n = l.samples[e - 1];
							n.subsamples = c.subs.entries[t].subsamples;
						}
					}
				}
			}
		}
	}
	getSample(e, t) {
		let n = e.samples[t];
		if (this.moov) {
			if (!n.data) n.data = new Uint8Array(n.size), n.alreadyRead = 0, this.samplesDataSize += n.size, N.debug("ISOFile", "Allocating sample #" + t + " on track #" + e.tkhd.track_id + " of size " + n.size + " (total: " + this.samplesDataSize + ")");
			else if (n.alreadyRead === n.size) return n;
			for (;;) {
				let e = this.stream, r = e.findPosition(!0, n.offset + n.alreadyRead, !1), i, a;
				if (r > -1) i = e.buffers[r], a = i.fileStart;
				else for (let t of this.mdats) if (!t.stream) N.debug("ISOFile", "mdat stream not yet fully read for #" + this.mdats.indexOf(t) + " mdat");
				else if (r = t.stream.findPosition(!0, n.offset + n.alreadyRead - t.start - t.hdr_size, !1), r > -1) {
					e = t.stream, i = t.stream.buffers[r], a = t.start + t.hdr_size + i.fileStart;
					break;
				}
				if (i) {
					let r = i.byteLength - (n.offset + n.alreadyRead - a);
					if (n.size - n.alreadyRead <= r) return N.debug("ISOFile", "Getting sample #" + t + " data (alreadyRead: " + n.alreadyRead + " offset: " + (n.offset + n.alreadyRead - a) + " read size: " + (n.size - n.alreadyRead) + " full size: " + n.size + ")"), A.memcpy(n.data.buffer, n.alreadyRead, i, n.offset + n.alreadyRead - a, n.size - n.alreadyRead), i.usedBytes += n.size - n.alreadyRead, e.logBufferLevel(), n.alreadyRead = n.size, n;
					if (r === 0) return;
					N.debug("ISOFile", "Getting sample #" + t + " partial data (alreadyRead: " + n.alreadyRead + " offset: " + (n.offset + n.alreadyRead - a) + " read size: " + r + " full size: " + n.size + ")"), A.memcpy(n.data.buffer, n.alreadyRead, i, n.offset + n.alreadyRead - a, r), n.alreadyRead += r, i.usedBytes += r, e.logBufferLevel();
				} else return;
			}
		}
	}
	releaseSample(e, t) {
		let n = e.samples[t];
		return n.data ? (this.samplesDataSize -= n.size, n.data = void 0, n.alreadyRead = 0, n.size) : 0;
	}
	getAllocatedSampleDataSize() {
		return this.samplesDataSize;
	}
	getCodecs() {
		let e = "";
		for (let t = 0; t < this.moov.traks.length; t++) {
			let n = this.moov.traks[t];
			t > 0 && (e += ","), e += n.mdia.minf.stbl.stsd.entries[0].getCodec();
		}
		return e;
	}
	getTrexById(e) {
		if (this.moov && this.moov.mvex) for (let t = 0; t < this.moov.mvex.trexs.length; t++) {
			let n = this.moov.mvex.trexs[t];
			if (n.track_id === e) return n;
		}
	}
	getTrackById(e) {
		if (this.moov) for (let t = 0; t < this.moov.traks.length; t++) {
			let n = this.moov.traks[t];
			if (n.tkhd.track_id === e) return n;
		}
	}
	flattenItemInfo() {
		let e = this.items, t = this.entity_groups, n = this.meta;
		if (n && n.hdlr && n.iinf) {
			for (let t = 0; t < n.iinf.item_infos.length; t++) {
				let r = n.iinf.item_infos[t].item_ID;
				e[r] = {
					id: r,
					name: n.iinf.item_infos[t].item_name,
					ref_to: [],
					content_type: n.iinf.item_infos[t].content_type,
					content_encoding: n.iinf.item_infos[t].content_encoding,
					item_uri_type: n.iinf.item_infos[t].item_uri_type,
					type: n.iinf.item_infos[t].item_type ? n.iinf.item_infos[t].item_type : "mime",
					protection: n.iinf.item_infos[t].item_protection_index > 0 ? n.ipro.protections[n.iinf.item_infos[t].item_protection_index - 1] : void 0
				};
			}
			if (n.grpl) for (let e = 0; e < n.grpl.boxes.length; e++) {
				let r = n.grpl.boxes[e];
				t[r.group_id] = {
					id: r.group_id,
					entity_ids: r.entity_ids,
					type: r.type
				};
			}
			if (n.iloc) for (let t = 0; t < n.iloc.items.length; t++) {
				let r = n.iloc.items[t], i = e[r.item_ID];
				r.data_reference_index !== 0 && (N.warn("Item storage with reference to other files: not supported"), i.source = n.dinf.boxes[r.data_reference_index - 1]), i.extents = [], i.size = 0;
				for (let e = 0; e < r.extents.length; e++) i.extents[e] = {
					offset: r.extents[e].extent_offset + r.base_offset,
					length: r.extents[e].extent_length,
					alreadyRead: 0
				}, r.construction_method === 1 && (i.extents[e].offset += n.idat.start + n.idat.hdr_size), i.size += i.extents[e].length;
			}
			if (n.pitm) {
				let t = n.pitm.item_id;
				e[t] ? e[t].primary = !0 : N.warn("ISOFile", "Primary item_id #" + t + " does not exist in items");
			}
			if (n.iref) for (let t = 0; t < n.iref.references.length; t++) {
				let r = n.iref.references[t];
				for (let t = 0; t < r.references.length; t++) e[r.from_item_ID].ref_to.push({
					type: r.type,
					id: r.references[t]
				});
			}
			if (n.iprp) for (let r = 0; r < n.iprp.ipmas.length; r++) {
				let i = n.iprp.ipmas[r];
				for (let r = 0; r < i.associations.length; r++) {
					let a = i.associations[r], o = e[a.id] ?? t[a.id];
					if (o) {
						o.properties === void 0 && (o.properties = { boxes: [] });
						for (let e = 0; e < a.props.length; e++) {
							let t = a.props[e];
							if (t.property_index > 0 && t.property_index - 1 < n.iprp.ipco.boxes.length) {
								let e = n.iprp.ipco.boxes[t.property_index - 1];
								o.properties[e.type] = e, o.properties.boxes.push(e);
							}
						}
					}
				}
			}
		}
	}
	getItem(e) {
		if (!this.meta) return;
		let t = this.items[e];
		if (!t.data && t.size) t.data = new Uint8Array(t.size), t.alreadyRead = 0, this.itemsDataSize += t.size, N.debug("ISOFile", "Allocating item #" + e + " of size " + t.size + " (total: " + this.itemsDataSize + ")");
		else if (t.alreadyRead === t.size) return t;
		for (let n = 0; n < t.extents.length; n++) {
			let r = t.extents[n];
			if (r.alreadyRead !== r.length) {
				let i = this.stream.findPosition(!0, r.offset + r.alreadyRead, !1);
				if (i > -1) {
					let a = this.stream.buffers[i], o = a.byteLength - (r.offset + r.alreadyRead - a.fileStart);
					if (r.length - r.alreadyRead <= o) N.debug("ISOFile", "Getting item #" + e + " extent #" + n + " data (alreadyRead: " + r.alreadyRead + " offset: " + (r.offset + r.alreadyRead - a.fileStart) + " read size: " + (r.length - r.alreadyRead) + " full extent size: " + r.length + " full item size: " + t.size + ")"), A.memcpy(t.data.buffer, t.alreadyRead, a, r.offset + r.alreadyRead - a.fileStart, r.length - r.alreadyRead), (!this.parsingMdat || this.discardMdatData) && (a.usedBytes += r.length - r.alreadyRead), this.stream.logBufferLevel(), t.alreadyRead += r.length - r.alreadyRead, r.alreadyRead = r.length;
					else {
						N.debug("ISOFile", "Getting item #" + e + " extent #" + n + " partial data (alreadyRead: " + r.alreadyRead + " offset: " + (r.offset + r.alreadyRead - a.fileStart) + " read size: " + o + " full extent size: " + r.length + " full item size: " + t.size + ")"), A.memcpy(t.data.buffer, t.alreadyRead, a, r.offset + r.alreadyRead - a.fileStart, o), r.alreadyRead += o, t.alreadyRead += o, (!this.parsingMdat || this.discardMdatData) && (a.usedBytes += o), this.stream.logBufferLevel();
						return;
					}
				} else return;
			}
		}
		if (t.alreadyRead === t.size) return t;
	}
	releaseItem(e) {
		let t = this.items[e];
		if (t.data) {
			this.itemsDataSize -= t.size, t.data = void 0, t.alreadyRead = 0;
			for (let e = 0; e < t.extents.length; e++) {
				let n = t.extents[e];
				n.alreadyRead = 0;
			}
			return t.size;
		}
		return 0;
	}
	processItems(e) {
		for (let t in this.items) {
			let n = this.items[t];
			this.getItem(n.id), e && !n.sent && (e(n), n.sent = !0, n.data = void 0);
		}
	}
	hasItem(e) {
		for (let t in this.items) {
			let n = this.items[t];
			if (n.name === e) return n.id;
		}
		return -1;
	}
	getMetaHandler() {
		if (this.meta) return this.meta.hdlr.handler;
	}
	getPrimaryItem() {
		if (this.meta && this.meta.pitm) return this.getItem(this.meta.pitm.item_id);
	}
	itemToFragmentedTrackFile({ itemId: t } = {}) {
		let n;
		if (n = t ? this.getItem(t) : this.getPrimaryItem(), !n) return;
		let r = new e();
		r.discardMdatData = !1;
		let i = {
			type: n.type,
			description_boxes: n.properties.boxes
		};
		n.properties.ispe && (i.width = n.properties.ispe.image_width, i.height = n.properties.ispe.image_height);
		let a = r.addTrack(i);
		if (a) return r.addSample(a, n.data), r;
	}
	processIncompleteBox(e) {
		if (e.type === "mdat") {
			let t = new Kn(e.size);
			return this.parsingMdat = t, this.boxes.push(t), this.mdats.push(t), t.start = e.start, t.hdr_size = e.hdr_size, t.original_size = e.original_size, this.stream.addUsedBytes(t.hdr_size), this.lastBoxStartPosition = t.start + t.size, this.stream.seek(t.start + t.size, !1, this.discardMdatData) ? (this.transferMdatData(), this.parsingMdat = void 0, !0) : (this.nextParsePosition = this.moovStartFound ? this.stream.findEndContiguousBuf() : t.start + t.size, !1);
		}
		return e.type === "moov" && (this.moovStartFound = !0, this.mdats.length === 0 && (this.isProgressive = !0)), this.stream.mergeNextBuffer && this.stream.mergeNextBuffer() ? (this.nextParsePosition = this.stream.getEndPosition(), !0) : (this.nextParsePosition = e.type ? this.moovStartFound ? this.stream.getEndPosition() : this.stream.getPosition() + e.size : this.stream.getEndPosition(), !1);
	}
	hasIncompleteMdat() {
		return this.parsingMdat !== void 0;
	}
	transferMdatData(e) {
		let t = e ?? this.parsingMdat;
		if (this.discardMdatData) {
			N.debug("ISOFile", "Discarding 'mdat' data, not transferring it to the mdat box stream");
			return;
		}
		if (!t) {
			N.warn("ISOFile", "Cannot transfer 'mdat' data, no mdat box is being parsed");
			return;
		}
		let n = this.stream.findPosition(!0, t.start + t.hdr_size, !1), r = this.stream.findPosition(!0, t.start + t.size, !1);
		if (n === -1 || r === -1) N.warn("ISOFile", "Cannot transfer 'mdat' data, start or end buffer not found");
		else {
			t.stream = new P();
			for (let e = n; e <= r; e++) {
				let i = this.stream.buffers[e], a = e === n ? t.start + t.hdr_size - i.fileStart : 0, o = e === r ? t.start + t.size - i.fileStart : i.byteLength;
				if (o > a) {
					N.debug("ISOFile", "Transferring 'mdat' data from buffer #" + e + " (" + a + " to " + o + ")");
					let n = o - a, r = new k(n), s = t.stream.getAbsoluteEndPosition();
					A.memcpy(r, 0, i, a, n), r.fileStart = s, t.stream.insertBuffer(r), i.usedBytes += n;
				}
			}
		}
	}
	processIncompleteMdat() {
		let e = this.parsingMdat;
		return this.stream.seek(e.start + e.size, !1, this.discardMdatData) ? (N.debug("ISOFile", "Found 'mdat' end in buffered data"), this.transferMdatData(), this.parsingMdat = void 0, !0) : (this.nextParsePosition = this.stream.findEndContiguousBuf(), !1);
	}
	restoreParsePosition() {
		return this.stream.seek(this.lastBoxStartPosition, !0, this.discardMdatData);
	}
	saveParsePosition() {
		this.lastBoxStartPosition = this.stream.getPosition();
	}
	updateUsedBytes(e, t) {
		this.stream.addUsedBytes && (e.type === "mdat" ? (this.stream.addUsedBytes(e.hdr_size), this.discardMdatData && this.stream.addUsedBytes(e.size - e.hdr_size)) : this.stream.addUsedBytes(e.size));
	}
	addBox(e) {
		return F.prototype.addBox.call(this, e);
	}
	init(e = {}) {
		let t = this.addBox(new Mr());
		t.major_brand = e.brands && e.brands[0] || "iso4", t.minor_version = 0, t.compatible_brands = e.brands || ["iso4"];
		let n = this.addBox(new nr());
		n.addBox(new lr());
		let r = n.addBox(new Gr());
		return r.timescale = e.timescale || 600, r.rate = e.rate || 65536, r.creation_time = 0, r.modification_time = 0, r.duration = e.duration || 0, r.volume = e.width ? 0 : 256, r.matrix = [
			65536,
			0,
			0,
			0,
			65536,
			0,
			0,
			0,
			1073741824
		], r.next_track_id = 1, this;
	}
	addTrack(e = {}) {
		this.moov || this.init(e);
		let t = e || {};
		t.width = t.width || 320, t.height = t.height || 320, t.id = t.id || this.moov.mvhd.next_track_id, t.type = t.type || "avc1";
		let n = this.moov.addBox(new rr());
		this.moov.mvhd.next_track_id = t.id + 1;
		let r = n.addBox(new ga());
		r.flags = 7, r.creation_time = 0, r.modification_time = 0, r.track_id = t.id, r.duration = t.duration || 0, r.layer = t.layer || 0, r.alternate_group = 0, r.volume = 1, r.matrix = [
			65536,
			0,
			0,
			0,
			65536,
			0,
			0,
			0,
			1073741824
		], r.width = t.width << 16, r.height = t.height << 16;
		let i = n.addBox(new ar()), a = i.addBox(new Fr());
		a.creation_time = 0, a.modification_time = 0, a.timescale = t.timescale || 1, a.duration = t.media_duration || 0, a.language = t.language || "und";
		let o = i.addBox(new Nr());
		o.handler = t.hdlr || "vide", o.name = t.name || "Track created with MP4Box.js";
		let s = i.addBox(new jr());
		s.extended_language = t.language || "fr-FR";
		let c = i.addBox(new or()), l = R.sampleEntry[t.type];
		if (!l) return;
		let u = new l();
		if (u.data_reference_index = 1, u instanceof K) {
			let e = u, n = c.addBox(new ba());
			n.graphicsmode = 0, n.opcolor = [
				0,
				0,
				0
			], e.width = t.width, e.height = t.height, e.horizresolution = 72 << 16, e.vertresolution = 72 << 16, e.frame_count = 1, e.compressorname = t.type + " Compressor", e.depth = 24, t.avcDecoderConfigRecord ? e.addBox(new Gn(t.avcDecoderConfigRecord.byteLength)).parse(new A(t.avcDecoderConfigRecord)) : t.hevcDecoderConfigRecord && e.addBox(new Pr(t.hevcDecoderConfigRecord.byteLength)).parse(new A(t.hevcDecoderConfigRecord));
		} else if (u instanceof q) {
			let e = u, n = c.addBox(new sa());
			n.balance = t.balance || 0, e.channel_count = t.channel_count || 2, e.samplesize = t.samplesize || 16, e.samplerate = t.samplerate || 65536;
		} else u instanceof Vn ? c.addBox(new Xn()) : u instanceof G ? (c.addBox(new la()), u instanceof $i && (u.namespace = t.namespace || "nonamespace", u.schema_location = t.schema_location || "", u.auxiliary_mime_types = t.auxiliary_mime_types || "")) : (u instanceof W || u instanceof Un, c.addBox(new Zn()));
		t.description && u.addBox.call(u, t.description), t.description_boxes && t.description_boxes.forEach(function(e) {
			u.addBox.call(u, e);
		});
		let d = c.addBox(new sr()).addBox(new Ar()), f = new ya();
		f.flags = 1, d.addEntry(f);
		let p = c.addBox(new cr());
		p.addBox(new da()).addEntry(u);
		let m = p.addBox(new pa());
		m.sample_counts = [], m.sample_deltas = [];
		let h = p.addBox(new ua());
		h.first_chunk = [], h.samples_per_chunk = [], h.sample_description_index = [];
		let g = p.addBox(new ca());
		g.chunk_offsets = [];
		let _ = p.addBox(new fa());
		_.sample_sizes = [];
		let v = this.moov.mvex.addBox(new _a());
		return v.track_id = t.id, v.default_sample_description_index = t.default_sample_description_index || 1, v.default_sample_duration = t.default_sample_duration || 0, v.default_sample_size = t.default_sample_size || 0, v.default_sample_flags = t.default_sample_flags || 0, this.buildTrakSampleLists(n), t.id;
	}
	addSample(e, t, { sample_description_index: n, duration: r = 1, cts: i = 0, dts: a = 0, is_sync: o = !1, is_leading: s = 0, depends_on: c = 0, is_depended_on: l = 0, has_redundancy: u = 0, degradation_priority: d = 0, subsamples: f, offset: p = 0 } = {}) {
		let m = this.getTrackById(e);
		if (m === void 0) return;
		let h = n ? n - 1 : 0, g = {
			number: m.samples.length,
			track_id: m.tkhd.track_id,
			timescale: m.mdia.mdhd.timescale,
			description_index: h,
			description: m.mdia.minf.stbl.stsd.entries[h],
			data: t,
			size: t.byteLength,
			alreadyRead: t.byteLength,
			duration: r,
			cts: i,
			dts: a,
			is_sync: o,
			is_leading: s,
			depends_on: c,
			is_depended_on: l,
			has_redundancy: u,
			degradation_priority: d,
			offset: p,
			subsamples: f
		};
		m.samples.push(g), m.samples_size += g.size, m.samples_duration += g.duration, m.first_dts === void 0 && (m.first_dts = a), this.processSamples();
		let _ = this.addBox(this.createMoof([g]));
		_.computeSize(), _.trafs[0].truns[0].data_offset = _.size + 8;
		let v = this.addBox(new Kn());
		return v.data = new Uint8Array(t), g;
	}
	createMoof(e) {
		if (e.length === 0) return;
		if (e.some((t) => t.track_id !== e[0].track_id)) throw Error("Cannot create moof for samples from different tracks: " + e.map((e) => e.track_id).join(", "));
		let t = e[0].track_id, n = this.getTrackById(t);
		if (!n) throw Error("Cannot create moof for non-existing track: " + t);
		let r = new ur(), i = r.addBox(new Wr());
		i.sequence_number = ++this.nextMoofNumber;
		let a = r.addBox(new dr()), o = a.addBox(new ha());
		o.track_id = t, o.flags = vn;
		let s = a.addBox(new ma());
		s.baseMediaDecodeTime = e[0].dts - (n.first_dts || 0);
		let c = a.addBox(new va());
		c.flags = 3841, c.data_offset = 0, c.first_sample_flags = 0, c.sample_count = e.length;
		for (let t of e) {
			let e = 0;
			e = t.is_sync ? 1 << 25 : 65536, c.sample_duration.push(t.duration), c.sample_size.push(t.size), c.sample_flags.push(e), c.sample_composition_time_offset.push(t.cts - t.dts);
		}
		return r;
	}
	print(e) {
		e.indent = "";
		for (let t = 0; t < this.boxes.length; t++) this.boxes[t] && this.boxes[t].print(e);
	}
};
function Ca(e = !1, t) {
	return new Sa(t, !e);
}
var wa = (mn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "EventMessageBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.version === 1 ? (this.timescale = e.readUint32(), this.presentation_time = e.readUint64(), this.event_duration = e.readUint32(), this.id = e.readUint32(), this.scheme_id_uri = e.readCString(), this.value = e.readCString()) : (this.scheme_id_uri = e.readCString(), this.value = e.readCString(), this.timescale = e.readUint32(), this.presentation_time_delta = e.readUint32(), this.event_duration = e.readUint32(), this.id = e.readUint32());
		let t = this.size - this.hdr_size - (16 + (this.scheme_id_uri.length + 1) + (this.value.length + 1));
		this.version === 1 && (t -= 4), this.message_data = e.readUint8Array(t);
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 16 + this.message_data.length + (this.scheme_id_uri.length + 1) + (this.value.length + 1), this.writeHeader(e), e.writeCString(this.scheme_id_uri), e.writeCString(this.value), e.writeUint32(this.timescale), e.writeUint32(this.presentation_time_delta), e.writeUint32(this.event_duration), e.writeUint32(this.id), e.writeUint8Array(this.message_data);
	}
}, mn.fourcc = "emsg", mn), Ta = (hn = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompressedSubsegmentIndexBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.subsegments = [];
		let t = e.readUint32();
		for (let n = 0; n < t; n++) {
			let t = {};
			this.subsegments.push(t), t.ranges = [];
			let n = e.readUint32();
			for (let r = 0; r < n; r++) {
				let n = {};
				t.ranges.push(n), n.level = e.readUint8(), n.range_size = e.readUint24();
			}
		}
	}
}, hn.fourcc = "ssix", hn), Ea = (gn = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "SegmentTypeBox";
	}
	parse(e) {
		let t = this.size - this.hdr_size;
		this.major_brand = e.readString(4), this.minor_version = e.readUint32(), t -= 8, this.compatible_brands = [];
		let n = 0;
		for (; t >= 4;) this.compatible_brands[n] = e.readString(4), t -= 4, n++;
	}
	write(e) {
		this.size = 8 + 4 * this.compatible_brands.length, this.writeHeader(e), e.writeString(this.major_brand, void 0, 4), e.writeUint32(this.minor_version);
		for (let t = 0; t < this.compatible_brands.length; t++) e.writeString(this.compatible_brands[t], void 0, 4);
	}
}, gn.fourcc = "styp", gn), Da = /* @__PURE__ */ t({
	Box: () => F,
	DataStream: () => A,
	Descriptor: () => Y,
	ES_Descriptor: () => _c,
	FullBox: () => I,
	Log: () => N,
	MPEG4DescriptorParser: () => bc,
	SampleGroupEntry: () => L,
	TrackGroupTypeBox: () => En,
	TrackReferenceTypeBox: () => kn,
	createFile: () => Ca
}), Oa, ka, Aa, ja, Ma, Na, Pa, Fa, Ia, La, Ra, za, Ba, Va, Ha, Ua, Wa, Ga, Ka, qa, Ja, Ya, Xa, Za, Qa, $a, eo, to, no, ro, io, ao, oo, so, co, lo, uo, fo, po, mo, ho, go, _o, vo, yo, bo, xo, So, Co, wo, To, Eo, Do, Oo, ko, Ao, jo, Mo, No, Po, Fo, Io, Lo, Ro, zo, Bo, Vo, Ho, Uo, Wo, Go, Ko, qo, Jo, Yo, Xo, Zo, Qo, $o, es, ts, ns, rs, is, as, os, ss, cs, ls, us, ds, fs, ps, ms, hs, gs, _s, vs, ys, bs, xs, Ss, Cs, ws, Ts, Es, Ds, Os, ks, As, js, Ms, Ns, Ps, Fs, Is, Ls, Rs, zs, Bs, Vs, Hs, Us, Ws, Gs, Ks, qs, Js, Ys, Xs, Zs, Qs, $s, ec, tc, nc, rc, ic, ac, oc, sc, cc, lc, uc, dc, fc = /* @__PURE__ */ r({
	Descriptor: () => Y,
	ES_Descriptor: () => _c,
	MPEG4DescriptorParser: () => bc
}), pc = 3, mc = 4, hc = 5, gc = 6, Y = class e {
	constructor(e, t) {
		this.tag = e, this.size = t, this.descs = [];
	}
	parse(e) {
		this.data = e.readUint8Array(this.size);
	}
	findDescriptor(e) {
		for (let t = 0; t < this.descs.length; t++) if (this.descs[t].tag === e) return this.descs[t];
	}
	parseOneDescriptor(t) {
		let n = 0, r = t.readUint8(), i = t.readUint8();
		for (; i & 128;) n = (n << 7) + (i & 127), i = t.readUint8();
		n = (n << 7) + (i & 127), N.debug("Descriptor", "Found " + (yc[r] || "Descriptor " + r) + ", size " + n + " at position " + t.getPosition());
		let a = yc[r] ? new vc[yc[r]](n) : new e(n);
		return a.parse(t), a;
	}
	parseRemainingDescriptors(e) {
		let t = e.getPosition();
		for (; e.getPosition() < t + this.size;) {
			let t = this.parseOneDescriptor?.(e);
			this.descs.push(t);
		}
	}
}, _c = class extends Y {
	constructor(e) {
		super(pc, e);
	}
	parse(e) {
		if (this.ES_ID = e.readUint16(), this.flags = e.readUint8(), this.size -= 3, this.flags & 128 ? (this.dependsOn_ES_ID = e.readUint16(), this.size -= 2) : this.dependsOn_ES_ID = 0, this.flags & 64) {
			let t = e.readUint8();
			this.URL = e.readString(t), this.size -= t + 1;
		} else this.URL = "";
		this.flags & 32 ? (this.OCR_ES_ID = e.readUint16(), this.size -= 2) : this.OCR_ES_ID = 0, this.parseRemainingDescriptors(e);
	}
	getOTI() {
		let e = this.findDescriptor(mc);
		return e ? e.oti : 0;
	}
	getAudioConfig() {
		let e = this.findDescriptor(mc);
		if (!e) return;
		let t = e.findDescriptor(hc);
		if (t && t.data) {
			let e = (t.data[0] & 248) >> 3;
			return e === 31 && t.data.length >= 2 && (e = 32 + ((t.data[0] & 7) << 3) + ((t.data[1] & 224) >> 5)), e;
		}
	}
}, vc = {
	Descriptor: Y,
	ES_Descriptor: _c,
	DecoderConfigDescriptor: class extends Y {
		constructor(e) {
			super(mc, e);
		}
		parse(e) {
			this.oti = e.readUint8(), this.streamType = e.readUint8(), this.upStream = !!(this.streamType >> 1 & 1), this.streamType >>>= 2, this.bufferSize = e.readUint24(), this.maxBitrate = e.readUint32(), this.avgBitrate = e.readUint32(), this.size -= 13, this.parseRemainingDescriptors(e);
		}
	},
	DecoderSpecificInfo: class extends Y {
		constructor(e) {
			super(hc, e);
		}
	},
	SLConfigDescriptor: class extends Y {
		constructor(e) {
			super(gc, e);
		}
	}
}, yc = {
	[pc]: "ES_Descriptor",
	[mc]: "DecoderConfigDescriptor",
	[hc]: "DecoderSpecificInfo",
	[gc]: "SLConfigDescriptor"
}, bc = class {
	constructor() {
		this.parseOneDescriptor = Y.prototype.parseOneDescriptor;
	}
	getDescriptorName(e) {
		return yc[e];
	}
}, xc = (Oa = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "AV1LayeredImageIndexingProperty";
	}
	parse(e) {
		let t = ((e.readUint8() & 1) + 1) * 16;
		this.layer_size = [];
		for (let n = 0; n < 3; n++) t === 16 ? this.layer_size[n] = e.readUint16() : this.layer_size[n] = e.readUint32();
	}
}, Oa.fourcc = "a1lx", Oa), Sc = (ka = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "OperatingPointSelectorProperty";
	}
	parse(e) {
		this.op_index = e.readUint8();
	}
}, ka.fourcc = "a1op", ka), Cc = (Aa = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "AuxiliaryTypeProperty";
	}
	parse(e) {
		this.parseFullHeader(e), this.aux_type = e.readCString();
		let t = this.size - this.hdr_size - (this.aux_type.length + 1);
		this.aux_subtype = e.readUint8Array(t);
	}
}, Aa.fourcc = "auxC", Aa), wc = (ja = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "BitRateBox";
	}
	parse(e) {
		this.bufferSizeDB = e.readUint32(), this.maxBitrate = e.readUint32(), this.avgBitrate = e.readUint32();
	}
}, ja.fourcc = "btrt", ja), Tc = (Ma = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CodingConstraintsBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint8();
		this.all_ref_pics_intra = (t & 128) == 128, this.intra_pred_used = (t & 64) == 64, this.max_ref_per_pic = (t & 63) >> 2, e.readUint24();
	}
}, Ma.fourcc = "ccst", Ma), Ec = (Na = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ComponentDefinitionBox";
	}
	parse(e) {
		this.channel_count = e.readUint16(), this.channel_indexes = [], this.channel_types = [], this.channel_associations = [];
		for (let t = 0; t < this.channel_count; t++) this.channel_indexes.push(e.readUint16()), this.channel_types.push(e.readUint16()), this.channel_associations.push(e.readUint16());
	}
}, Na.fourcc = "cdef", Na), Dc = (Pa = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "CleanApertureBox";
	}
	parse(e) {
		this.cleanApertureWidthN = e.readUint32(), this.cleanApertureWidthD = e.readUint32(), this.cleanApertureHeightN = e.readUint32(), this.cleanApertureHeightD = e.readUint32(), this.horizOffN = e.readUint32(), this.horizOffD = e.readUint32(), this.vertOffN = e.readUint32(), this.vertOffD = e.readUint32();
	}
}, Pa.fourcc = "clap", Pa), Oc = (Fa = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ContentLightLevelBox";
	}
	parse(e) {
		this.max_content_light_level = e.readUint16(), this.max_pic_average_light_level = e.readUint16();
	}
}, Fa.fourcc = "clli", Fa), kc = (Ia = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "CameraExtrinsicMatrixProperty";
	}
	parse(e) {
		this.flags & 1 && (this.pos_x = e.readInt32()), this.flags & 2 && (this.pos_y = e.readInt32()), this.flags & 4 && (this.pos_z = e.readInt32()), this.flags & 8 && (this.version === 0 ? this.flags & 16 ? (this.quat_x = e.readInt32(), this.quat_y = e.readInt32(), this.quat_z = e.readInt32()) : (this.quat_x = e.readInt16(), this.quat_y = e.readInt16(), this.quat_z = e.readInt16()) : this.version), this.flags & 32 && (this.id = e.readUint32());
	}
}, Ia.fourcc = "cmex", Ia), Ac = (La = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "CameraIntrinsicMatrixProperty";
	}
	parse(e) {
		this.focal_length_x = e.readInt32(), this.principal_point_x = e.readInt32(), this.principal_point_y = e.readInt32(), this.flags & 1 && (this.focal_length_y = e.readInt32(), this.skew_factor = e.readInt32());
	}
}, La.fourcc = "cmin", La), jc = (Ra = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompressionConfigurationBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.compression_type = e.readString(4), this.compressed_unit_type = e.readUint8();
	}
}, Ra.fourcc = "cmpC", Ra), Mc = (za = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ComponentDefinitionBox";
	}
	parse(e) {
		this.component_count = e.readUint32(), this.component_types = [], this.component_type_urls = [];
		for (let t = 0; t < this.component_count; t++) {
			let t = e.readUint16();
			this.component_types.push(t), t >= 32768 && this.component_type_urls.push(e.readCString());
		}
	}
}, za.fourcc = "cmpd", za), Nc = (Ba = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ChunkLargeOffsetBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.chunk_offsets = [], this.version === 0) for (let n = 0; n < t; n++) this.chunk_offsets.push(e.readUint64());
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4 + 8 * this.chunk_offsets.length, this.writeHeader(e), e.writeUint32(this.chunk_offsets.length);
		for (let t = 0; t < this.chunk_offsets.length; t++) e.writeUint64(this.chunk_offsets[t]);
	}
}, Ba.fourcc = "co64", Ba), Pc = (Va = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ContentLightLevelBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.maxCLL = e.readUint16(), this.maxFALL = e.readUint16();
	}
}, Va.fourcc = "CoLL", Va), Fc = class {
	toString() {
		let e = "centre_azimuth: ";
		return e += this.centre_azimuth, e += " (", e += this.centre_azimuth * 2 ** -16, e += "°), centre_elevation: ", e += this.centre_elevation, e += " (", e += this.centre_elevation * 2 ** -16, e += "°), centre_tilt: ", e += this.centre_tilt, e += " (", e += this.centre_tilt * 2 ** -16, e += "°)", this.range_included_flag && (e += ", azimuth_range: ", e += this.azimuth_range, e += " (", e += this.azimuth_range * 2 ** -16, e += "°), elevation_range: ", e += this.elevation_range, e += " (", e += this.elevation_range * 2 ** -16, e += "°)"), this.interpolate_included_flag && (e += ", interpolate: ", e += this.interpolate), e;
	}
}, Ic = class {
	toString() {
		let e = "";
		return this.view_idc && (e += "view_idc: ", e += this.view_idc, e += ", "), e += "sphere_region: {", e += this.sphere_region, e += "}", e;
	}
}, Lc = (Ha = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CoverageInformationBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.coverage_shape_type = e.readUint8();
		let t = e.readUint8(), n = e.readInt8(), r = n & 128;
		r && (this.default_view_idc = (n & 96) >> 5), this.coverage_regions = [];
		for (let n = 0; n < t; n++) {
			let t = new Ic();
			r && (t.view_idc = e.readUint8() >> 6), t.sphere_region = this.parseSphereRegion(e, !0, !0), this.coverage_regions.push(t);
		}
	}
	parseSphereRegion(e, t, n) {
		let r = new Fc();
		return r.centre_azimuth = e.readInt32(), r.centre_elevation = e.readInt32(), r.centre_tilt = e.readInt32(), r.range_included_flag = t, t && (r.azimuth_range = e.readUint32(), r.elevation_range = e.readUint32()), r.interpolate_included_flag = n, n && (r.interpolate = (e.readUint8() & 128) == 128), r;
	}
}, Ha.fourcc = "covi", Ha), Rc = (Ua = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CopyrightBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.parseLanguage(e), this.notice = e.readCString();
	}
}, Ua.fourcc = "cprt", Ua), zc = (Wa = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompatibleSchemeTypeBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.scheme_type = e.readString(4), this.scheme_version = e.readUint32(), this.flags & 1 && (this.scheme_uri = e.readCString());
	}
}, Wa.fourcc = "csch", Wa), X = 2147483647, Bc = (Ga = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompositionToDecodeBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.version === 0 ? (this.compositionToDTSShift = e.readInt32(), this.leastDecodeToDisplayDelta = e.readInt32(), this.greatestDecodeToDisplayDelta = e.readInt32(), this.compositionStartTime = e.readInt32(), this.compositionEndTime = e.readInt32()) : this.version === 1 && (this.compositionToDTSShift = e.readInt64(), this.leastDecodeToDisplayDelta = e.readInt64(), this.greatestDecodeToDisplayDelta = e.readInt64(), this.compositionStartTime = e.readInt64(), this.compositionEndTime = e.readInt64());
	}
	write(e) {
		this.version = 0, (this.compositionToDTSShift > X || this.leastDecodeToDisplayDelta > X || this.greatestDecodeToDisplayDelta > X || this.compositionStartTime > X || this.compositionEndTime > X) && (this.version = 1), this.flags = 0, this.version === 0 ? (this.size = 20, this.writeHeader(e), e.writeInt32(this.compositionToDTSShift), e.writeInt32(this.leastDecodeToDisplayDelta), e.writeInt32(this.greatestDecodeToDisplayDelta), e.writeInt32(this.compositionStartTime), e.writeInt32(this.compositionEndTime)) : this.version === 1 && (this.size = 40, this.writeHeader(e), e.writeInt64(this.compositionToDTSShift), e.writeInt64(this.leastDecodeToDisplayDelta), e.writeInt64(this.greatestDecodeToDisplayDelta), e.writeInt64(this.compositionStartTime), e.writeInt64(this.compositionEndTime));
	}
}, Ga.fourcc = "cslg", Ga), Vc = (Ka = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompositionOffsetBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.sample_counts = [], this.sample_offsets = [], this.version === 0) for (let n = 0; n < t; n++) {
			this.sample_counts.push(e.readUint32());
			let t = e.readInt32();
			t < 0 && N.warn("BoxParser", "ctts box uses negative values without using version 1"), this.sample_offsets.push(t);
		}
		else if (this.version === 1) for (let n = 0; n < t; n++) this.sample_counts.push(e.readUint32()), this.sample_offsets.push(e.readInt32());
	}
	write(e) {
		this.version = +!!this.sample_offsets.some((e) => e < 0), this.flags = 0, this.size = 4 + 8 * this.sample_counts.length, this.writeHeader(e), e.writeUint32(this.sample_counts.length);
		for (let t = 0; t < this.sample_counts.length; t++) e.writeUint32(this.sample_counts[t]), this.version === 1 ? e.writeInt32(this.sample_offsets[t]) : e.writeUint32(this.sample_offsets[t]);
	}
	unpack(e) {
		let t = 0;
		for (let n = 0; n < this.sample_counts.length; n++) for (let r = 0; r < this.sample_counts[n]; r++) e[t].pts = e[t].dts + this.sample_offsets[n], t++;
	}
}, Ka.fourcc = "ctts", Ka), Hc = (qa = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "AC3SpecificBox";
	}
	parse(e) {
		let t = e.readUint8(), n = e.readUint8(), r = e.readUint8();
		this.fscod = t >> 6, this.bsid = t >> 1 & 31, this.bsmod = (t & 1) << 2 | n >> 6 & 3, this.acmod = n >> 3 & 7, this.lfeon = n >> 2 & 1, this.bit_rate_code = n & 3 | r >> 5 & 7;
	}
}, qa.fourcc = "dac3", qa), Uc = (Ja = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "EC3SpecificBox";
	}
	parse(e) {
		let t = e.readUint16();
		this.data_rate = t >> 3, this.num_ind_sub = t & 7, this.ind_subs = [];
		for (let t = 0; t < this.num_ind_sub + 1; t++) {
			let t = e.readUint8(), n = e.readUint8(), r = e.readUint8(), i = {
				fscod: t >> 6,
				bsid: t >> 1 & 31,
				bsmod: (t & 1) << 4 | n >> 4 & 15,
				acmod: n >> 1 & 7,
				lfeon: n & 1,
				num_dep_sub: r >> 1 & 15
			};
			this.ind_subs.push(i), i.num_dep_sub > 0 && (i.chan_loc = (r & 1) << 8 | e.readUint8());
		}
	}
}, Ja.fourcc = "dec3", Ja), Wc = (Ya = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "FLACSpecificBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = [], n = [
			"STREAMINFO",
			"PADDING",
			"APPLICATION",
			"SEEKTABLE",
			"VORBIS_COMMENT",
			"CUESHEET",
			"PICTURE",
			"RESERVED"
		], r;
		do {
			r = e.readUint8();
			let i = Math.min(r & 127, n.length - 1);
			i ? e.readUint8Array(e.readUint24()) : (e.readUint8Array(13), this.samplerate = e.readUint32() >> 12, e.readUint8Array(20)), t.push(n[i]);
		} while (r & 128);
		this.numMetadataBlocks = t.length + " (" + t.join(", ") + ")";
	}
}, Ya.fourcc = "dfLa", Ya), Gc = (Xa = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintimmediateBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint64();
	}
}, Xa.fourcc = "dimm", Xa), Kc = (Za = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintlongestpacket";
	}
	parse(e) {
		this.time = e.readUint32();
	}
}, Za.fourcc = "dmax", Za), qc = (Qa = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintmediaBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint64();
	}
}, Qa.fourcc = "dmed", Qa), Jc = ($a = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "OpusSpecificBox";
	}
	parse(e) {
		if (this.Version = e.readUint8(), this.OutputChannelCount = e.readUint8(), this.PreSkip = e.readUint16(), this.InputSampleRate = e.readUint32(), this.OutputGain = e.readInt16(), this.ChannelMappingFamily = e.readUint8(), this.ChannelMappingFamily !== 0) {
			this.StreamCount = e.readUint8(), this.CoupledCount = e.readUint8(), this.ChannelMapping = [];
			for (let t = 0; t < this.OutputChannelCount; t++) this.ChannelMapping[t] = e.readUint8();
		}
	}
	write(e) {
		if (this.size = 11, this.ChannelMappingFamily !== 0 && (this.size += 2 + this.OutputChannelCount), this.writeHeader(e), e.writeUint8(this.Version), e.writeUint8(this.OutputChannelCount), e.writeUint16(this.PreSkip), e.writeUint32(this.InputSampleRate), e.writeInt16(this.OutputGain), e.writeUint8(this.ChannelMappingFamily), this.ChannelMappingFamily !== 0) {
			e.writeUint8(this.StreamCount), e.writeUint8(this.CoupledCount);
			for (let t = 0; t < this.OutputChannelCount; t++) e.writeUint8(this.ChannelMapping[t]);
		}
	}
}, $a.fourcc = "dOps", $a), Yc = (eo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintrepeatedBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint64();
	}
}, eo.fourcc = "drep", eo), Xc = (to = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "EditListBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.entries = [];
		let t = e.readUint32();
		for (let n = 0; n < t; n++) {
			let t = {
				segment_duration: this.version === 1 ? e.readUint64() : e.readUint32(),
				media_time: this.version === 1 ? e.readInt64() : e.readInt32(),
				media_rate_integer: e.readInt16(),
				media_rate_fraction: e.readInt16()
			};
			this.entries.push(t);
		}
	}
	write(e) {
		let t = this.entries.some((e) => e.segment_duration > O || e.media_time > O) || this.version === 1;
		this.version = +!!t, this.size = 4 + 12 * this.entries.length, this.size += t ? 8 * this.entries.length : 0, this.writeHeader(e), e.writeUint32(this.entries.length);
		for (let n = 0; n < this.entries.length; n++) {
			let r = this.entries[n];
			t ? (e.writeUint64(r.segment_duration), e.writeInt64(r.media_time)) : (e.writeUint32(r.segment_duration), e.writeInt32(r.media_time)), e.writeInt16(r.media_rate_integer), e.writeInt16(r.media_rate_fraction);
		}
	}
}, to.fourcc = "elst", to), Z = class extends I {
	parse(e) {
		this.parseFullHeader(e), this.group_id = e.readUint32(), this.num_entities_in_group = e.readUint32(), this.entity_ids = [];
		for (let t = 0; t < this.num_entities_in_group; t++) {
			let t = e.readUint32();
			this.entity_ids.push(t);
		}
	}
}, Zc = (no = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Auto exposure bracketing";
	}
}, no.fourcc = "aebr", no), Qc = (ro = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Flash exposure information";
	}
}, ro.fourcc = "afbr", ro), $c = (io = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Album collection";
	}
}, io.fourcc = "albc", io), el = (ao = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Alternative entity";
	}
}, ao.fourcc = "altr", ao), tl = (oo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Burst image";
	}
}, oo.fourcc = "brst", oo), nl = (so = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Depth of field bracketing";
	}
}, so.fourcc = "dobr", so), rl = (co = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Equivalent entity";
	}
}, co.fourcc = "eqiv", co), il = (lo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Favorites collection";
	}
}, lo.fourcc = "favc", lo), al = (uo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Focus bracketing";
	}
}, uo.fourcc = "fobr", uo), ol = (fo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Image item with an audio track";
	}
}, fo.fourcc = "iaug", fo), sl = (po = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Panorama";
	}
}, po.fourcc = "pano", po), cl = (mo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Slideshow";
	}
}, mo.fourcc = "slid", mo), ll = (ho = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Stereo";
	}
}, ho.fourcc = "ster", ho), ul = (go = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Time-synchronized capture";
	}
}, go.fourcc = "tsyn", go), dl = (_o = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "White balance bracketing";
	}
}, _o.fourcc = "wbbr", _o), fl = (vo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Progressive rendering";
	}
}, vo.fourcc = "prgr", vo), pl = (yo = class extends Z {
	constructor(...e) {
		super(...e), this.box_name = "Image pyramid";
	}
	parse(e) {
		this.parseFullHeader(e), this.group_id = e.readUint32(), this.num_entities_in_group = e.readUint32(), this.entity_ids = [];
		for (let t = 0; t < this.num_entities_in_group; t++) {
			let t = e.readUint32();
			this.entity_ids.push(t);
		}
		this.tile_size_x = e.readUint16(), this.tile_size_y = e.readUint16(), this.layer_binning = [], this.tiles_in_layer_column_minus1 = [], this.tiles_in_layer_row_minus1 = [];
		for (let t = 0; t < this.num_entities_in_group; t++) this.layer_binning[t] = e.readUint16(), this.tiles_in_layer_row_minus1[t] = e.readUint16(), this.tiles_in_layer_column_minus1[t] = e.readUint16();
	}
}, yo.fourcc = "pymd", yo), ml = (bo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "FieldHandlingBox";
	}
	parse(e) {
		this.fieldCount = e.readUint8(), this.fieldOrdering = e.readUint8();
	}
}, bo.fourcc = "fiel", bo), hl = (xo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "OriginalFormatBox";
	}
	parse(e) {
		this.data_format = e.readString(4);
	}
}, xo.fourcc = "frma", xo), gl = (So = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ImageMirror";
	}
	parse(e) {
		let t = e.readUint8();
		this.reserved = t >> 7, this.axis = t & 1;
	}
}, So.fourcc = "imir", So), _l = (Co = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ItemPropertyAssociationBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		this.associations = [];
		for (let n = 0; n < t; n++) {
			let t = this.version < 1 ? e.readUint16() : e.readUint32(), n = [], r = e.readUint8();
			for (let t = 0; t < r; t++) {
				let t = e.readUint8();
				n.push({
					essential: (t & 128) >> 7 == 1,
					property_index: this.flags & 1 ? (t & 127) << 8 | e.readUint8() : t & 127
				});
			}
			this.associations.push({
				id: t,
				props: n
			});
		}
	}
}, Co.fourcc = "ipma", Co), vl = (wo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "ImageRotation";
	}
	parse(e) {
		this.angle = e.readUint8() & 3;
	}
}, wo.fourcc = "irot", wo), yl = (To = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ImageSpatialExtentsProperty";
	}
	parse(e) {
		this.parseFullHeader(e), this.image_width = e.readUint32(), this.image_height = e.readUint32();
	}
}, To.fourcc = "ispe", To), bl = (Eo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TAITimestampBox";
	}
	parse(e) {
		this.TAI_timestamp = e.readUint64();
		let t = e.readUint8();
		this.sychronization_state = t >> 7 & 1, this.timestamp_generation_failure = t >> 6 & 1, this.timestamp_is_modified = t >> 5 & 1;
	}
}, Eo.fourcc = "itai", Eo), xl = (Do = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "KindBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.schemeURI = e.readCString(), this.isEndOfBox(e) || (this.value = e.readCString());
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = this.schemeURI.length + 1 + (this.value ? this.value.length + 1 : 0), this.writeHeader(e), e.writeCString(this.schemeURI), this.value && e.writeCString(this.value);
	}
}, Do.fourcc = "kind", Do), Sl = (Oo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "LevelAssignmentBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint8();
		this.levels = [];
		for (let n = 0; n < t; n++) {
			let t = {};
			this.levels[n] = t, t.track_ID = e.readUint32();
			let r = e.readUint8();
			switch (t.padding_flag = r >> 7, t.assignment_type = r & 127, t.assignment_type) {
				case 0:
					t.grouping_type = e.readString(4);
					break;
				case 1:
					t.grouping_type = e.readString(4), t.grouping_type_parameter = e.readUint32();
					break;
				case 2: break;
				case 3: break;
				case 4:
					t.sub_track_id = e.readUint32();
					break;
				default: N.warn("BoxParser", `Unknown level assignment type: ${t.assignment_type}`);
			}
		}
	}
}, Oo.fourcc = "leva", Oo), Cl = (ko = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "LHEVCConfigurationBox";
	}
	parse(e) {
		this.configurationVersion = e.readUint8(), this.min_spatial_segmentation_idc = e.readUint16() & 4095, this.parallelismType = e.readUint8() & 3;
		let t = e.readUint8();
		this.numTemporalLayers = (t & 13) >> 3, this.temporalIdNested = (t & 4) >> 2, this.lengthSizeMinusOne = t & 3, this.nalu_arrays = [];
		let n = e.readUint8();
		for (let r = 0; r < n; r++) {
			let n = [];
			this.nalu_arrays.push(n), t = e.readUint8(), n.completeness = (t & 128) >> 7, n.nalu_type = t & 63;
			let r = e.readUint16();
			for (let t = 0; t < r; t++) {
				let t = e.readUint16();
				n.push({ data: e.readUint8Array(t) });
			}
		}
	}
}, ko.fourcc = "lhvC", ko), wl = (Ao = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "LayerSelectorProperty";
	}
	parse(e) {
		this.layer_id = e.readUint16();
	}
}, Ao.fourcc = "lsel", Ao), Tl = (jo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintmaxrate";
	}
	parse(e) {
		this.period = e.readUint32(), this.bytes = e.readUint32();
	}
}, jo.fourcc = "maxr", jo), El = class {
	constructor(e, t) {
		this.x = e, this.y = t;
	}
	toString() {
		return "(" + this.x + "," + this.y + ")";
	}
}, Dl = (Mo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "MasteringDisplayColourVolumeBox";
	}
	parse(e) {
		this.display_primaries = [], this.display_primaries[0] = new El(e.readUint16(), e.readUint16()), this.display_primaries[1] = new El(e.readUint16(), e.readUint16()), this.display_primaries[2] = new El(e.readUint16(), e.readUint16()), this.white_point = new El(e.readUint16(), e.readUint16()), this.max_display_mastering_luminance = e.readUint32(), this.min_display_mastering_luminance = e.readUint32();
	}
}, Mo.fourcc = "mdcv", Mo), Ol = (No = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MovieFragmentRandomAccessOffsetBox";
	}
	parse(e) {
		this.parseFullHeader(e), this._size = e.readUint32();
	}
}, No.fourcc = "mfro", No), kl = (Po = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "MaskConfigurationProperty";
	}
	parse(e) {
		this.parseFullHeader(e), this.bits_per_pixel = e.readUint8();
	}
}, Po.fourcc = "mskC", Po), Al = (Fo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintPacketsSent";
	}
	parse(e) {
		this.packetssent = e.readUint32();
	}
}, Fo.fourcc = "npck", Fo), jl = (Io = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintPacketsSent";
	}
	parse(e) {
		this.packetssent = e.readUint64();
	}
}, Io.fourcc = "nump", Io), Ml = class {
	constructor(e, t) {
		this.pad1 = e, this.pad2 = t;
	}
}, Nl = (Lo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "PaddingBitsBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		this.padbits = [];
		for (let n = 0; n < Math.floor((t + 1) / 2); n++) {
			let t = e.readUint8(), n = (t & 112) >> 4, r = t & 7;
			this.padbits.push(new Ml(n, r));
		}
	}
}, Lo.fourcc = "padb", Lo), Pl = (Ro = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "PixelAspectRatioBox";
	}
	parse(e) {
		this.hSpacing = e.readUint32(), this.vSpacing = e.readUint32();
	}
}, Ro.fourcc = "pasp", Ro), Fl = (zo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "CuePayloadBox";
	}
	parse(e) {
		this.text = e.readString(this.size - this.hdr_size);
	}
}, zo.fourcc = "payl", zo), Il = (Bo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintpayloadID";
	}
	parse(e) {
		this.payloadID = e.readUint32();
		let t = e.readUint8();
		this.rtpmap_string = e.readString(t);
	}
}, Bo.fourcc = "payt", Bo), Ll = (Vo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ProgressiveDownloadInfoBox", this.rate = [], this.initial_delay = [];
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = (this.size - this.hdr_size) / 8;
		for (let n = 0; n < t; n++) this.rate[n] = e.readUint32(), this.initial_delay[n] = e.readUint32();
	}
}, Vo.fourcc = "pdin", Vo), Rl = (Ho = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "PixelInformationProperty";
	}
	parse(e) {
		this.parseFullHeader(e), this.num_channels = e.readUint8(), this.bits_per_channels = [];
		for (let t = 0; t < this.num_channels; t++) this.bits_per_channels[t] = e.readUint8();
	}
}, Ho.fourcc = "pixi", Ho), zl = (Uo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintlargestpacket";
	}
	parse(e) {
		this.bytes = e.readUint32();
	}
}, Uo.fourcc = "pmax", Uo), Bl = (Wo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ProgressiveDerivedImageItemInformationProperty";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.step_count = e.readUint16(), this.item_count = [], this.flags & 2) for (let t = 0; t < this.step_count; t++) this.item_count[t] = e.readUint16();
	}
}, Wo.fourcc = "prdi", Wo), Vl = (Go = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ProjectionFormatBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.projection_type = e.readUint8() & 31;
	}
}, Go.fourcc = "prfr", Go), Hl = (Ko = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ProducerReferenceTimeBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.ref_track_id = e.readUint32(), this.ntp_timestamp = e.readUint64(), this.media_time = this.version === 0 ? e.readUint32() : e.readUint64();
	}
}, Ko.fourcc = "prft", Ko), Ul = (qo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ProtectionSystemSpecificHeaderBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.system_id = B(e), this.kid = [], this.version > 0) {
			let t = e.readUint32();
			for (let n = 0; n < t; n++) this.kid[n] = B(e);
		}
		let t = e.readUint32();
		t > 0 && (this.protection_data = e.readUint8Array(t));
	}
}, qo.fourcc = "pssh", qo), Wl = (Jo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackCleanApertureDimensionsBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.width = e.readUint32(), this.height = e.readUint32();
	}
}, Jo.fourcc = "clef", Jo);
function Gl(e, t) {
	if (e === Q.Types.UTF8) return new TextDecoder("utf-8").decode(t);
	let n = new DataView(t.buffer);
	if (e === Q.Types.BE_UNSIGNED_INT) {
		if (t.length === 1) return n.getUint8(0);
		if (t.length === 2) return n.getUint16(0, !1);
		if (t.length === 4) return n.getUint32(0, !1);
		if (t.length === 8) return n.getBigUint64(0, !1);
		throw Error("Unsupported ITIF_TYPE_BE_UNSIGNED_INT length " + t.length);
	}
	if (e === Q.Types.BE_SIGNED_INT) {
		if (t.length === 1) return n.getInt8(0);
		if (t.length === 2) return n.getInt16(0, !1);
		if (t.length === 4) return n.getInt32(0, !1);
		if (t.length === 8) return n.getBigInt64(0, !1);
		throw Error("Unsupported ITIF_TYPE_BE_SIGNED_INT length " + t.length);
	}
	if (e === Q.Types.BE_FLOAT32) return n.getFloat32(0, !1);
	N.warn("DataBox", "Unsupported or unimplemented itif data type: " + e);
}
var Q = (Yo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "DataBox";
	}
	parse(e) {
		this.valueType = e.readUint32(), this.country = e.readUint16(), this.country > 255 && (e.seek(e.getPosition() - 2), this.countryString = e.readString(2)), this.language = e.readUint16(), this.language > 255 && (e.seek(e.getPosition() - 2), this.parseLanguage(e)), this.raw = e.readUint8Array(this.size - this.hdr_size - 8), this.value = Gl(this.valueType, this.raw);
	}
}, Yo.fourcc = "data", Yo.Types = {
	RESERVED: 0,
	UTF8: 1,
	UTF16: 2,
	SJIS: 3,
	UTF8_SORT: 4,
	UTF16_SORT: 5,
	JPEG: 13,
	PNG: 14,
	BE_SIGNED_INT: 21,
	BE_UNSIGNED_INT: 22,
	BE_FLOAT32: 23,
	BE_FLOAT64: 24,
	BMP: 27,
	QT_ATOM: 28,
	BE_SIGNED_INT8: 65,
	BE_SIGNED_INT16: 66,
	BE_SIGNED_INT32: 67,
	BE_FLOAT32_POINT: 70,
	BE_FLOAT32_DIMENSIONS: 71,
	BE_FLOAT32_RECT: 72,
	BE_SIGNED_INT64: 74,
	BE_UNSIGNED_INT8: 75,
	BE_UNSIGNED_INT16: 76,
	BE_UNSIGNED_INT32: 77,
	BE_UNSIGNED_INT64: 78,
	BE_FLOAT64_AFFINE_TRANSFORM: 79
}, Yo), Kl = (Xo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackEncodedPixelsDimensionsBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.width = e.readUint32(), this.height = e.readUint32();
	}
}, Xo.fourcc = "enof", Xo), ql = (Zo = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "IlstBox";
	}
	parse(e) {
		this.list = {};
		let t = this.size - this.hdr_size;
		for (; t > 0;) {
			let n = e.readUint32(), r = e.readUint32(), i = V(e, !1, n - 8);
			i.code === 1 && (this.list[r] = i.box), t -= n;
		}
	}
}, Zo.fourcc = "ilst", Zo), Jl = (Qo = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "KeysBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.count = e.readUint32(), this.keys = {};
		for (let t = 0; t < this.count; t++) {
			let n = e.readUint32();
			this.keys[t + 1] = e.readString(n - 4);
		}
	}
}, Qo.fourcc = "keys", Qo), Yl = ($o = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackProductionApertureDimensionsBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.width = e.readUint32(), this.height = e.readUint32();
	}
}, $o.fourcc = "prof", $o), Xl = (es = class extends H {
	constructor(...e) {
		super(...e), this.box_name = "TrackApertureModeDimensionsBox", this.clefs = [], this.profs = [], this.enofs = [], this.subBoxNames = [
			"clef",
			"prof",
			"enof"
		];
	}
}, es.fourcc = "tapt", es), Zl = (ts = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "rtpmoviehintinformation";
	}
	parse(e) {
		this.descriptionformat = e.readString(4), this.sdptext = e.readString(this.size - this.hdr_size - 4);
	}
}, ts.fourcc = "rtp ", ts), Ql = (ns = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleAuxiliaryInformationOffsetsBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.flags & 1 && (this.aux_info_type = e.readString(4), this.aux_info_type_parameter = e.readUint32()), this.entry_count = e.readUint32(), this.offset = [];
		for (let t = 0; t < this.entry_count; t++) this.version === 0 ? this.offset[t] = e.readUint32() : this.offset[t] = e.readUint64();
	}
}, ns.fourcc = "saio", ns), $l = (rs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleAuxiliaryInformationSizesBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.flags & 1 && (this.aux_info_type = e.readString(4), this.aux_info_type_parameter = e.readUint32()), this.default_sample_info_size = e.readUint8(), this.sample_count = e.readUint32(), this.sample_info_size = [], this.default_sample_info_size === 0) for (let t = 0; t < this.sample_count; t++) this.sample_info_size[t] = e.readUint8();
	}
}, rs.fourcc = "saiz", rs), eu = class {
	constructor(e, t) {
		this.bad_pixel_row = e, this.bad_pixel_column = t;
	}
	toString() {
		return "[row: " + this.bad_pixel_row + ", column: " + this.bad_pixel_column + "]";
	}
}, tu = (is = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SensorBadPixelsMapBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.component_count = e.readUint16(), this.component_index = [];
		for (let t = 0; t < this.component_count; t++) this.component_index.push(e.readUint16());
		let t = e.readUint8();
		this.correction_applied = (t & 128) == 128, this.num_bad_rows = e.readUint32(), this.num_bad_cols = e.readUint32(), this.num_bad_pixels = e.readUint32(), this.bad_rows = [], this.bad_columns = [], this.bad_pixels = [];
		for (let t = 0; t < this.num_bad_rows; t++) this.bad_rows.push(e.readUint32());
		for (let t = 0; t < this.num_bad_cols; t++) this.bad_columns.push(e.readUint32());
		for (let t = 0; t < this.num_bad_pixels; t++) {
			let t = e.readUint32(), n = e.readUint32();
			this.bad_pixels.push(new eu(t, n));
		}
	}
}, is.fourcc = "sbpm", is), nu = (as = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SchemeTypeBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.scheme_type = e.readString(4), this.scheme_version = e.readUint32(), this.flags & 1 && (this.scheme_uri = e.readString(this.size - this.hdr_size - 8));
	}
}, as.fourcc = "schm", as), ru = (os = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "rtptracksdphintinformation";
	}
	parse(e) {
		this.sdptext = e.readString(this.size - this.hdr_size);
	}
}, os.fourcc = "sdp ", os), iu = (ss = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SampleEncryptionBox";
	}
}, ss.fourcc = "senc", ss), au = (cs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SMPTE2086MasteringDisplayMetadataBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.primaryRChromaticity_x = e.readUint16(), this.primaryRChromaticity_y = e.readUint16(), this.primaryGChromaticity_x = e.readUint16(), this.primaryGChromaticity_y = e.readUint16(), this.primaryBChromaticity_x = e.readUint16(), this.primaryBChromaticity_y = e.readUint16(), this.whitePointChromaticity_x = e.readUint16(), this.whitePointChromaticity_y = e.readUint16(), this.luminanceMax = e.readUint32(), this.luminanceMin = e.readUint32();
	}
}, cs.fourcc = "SmDm", cs), ou = (ls = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SamplingRateBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.sampling_rate = e.readUint32();
	}
}, ls.fourcc = "srat", ls), su = (us = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "DegradationPriorityBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = (this.size - this.hdr_size) / 2;
		this.priority = [];
		for (let n = 0; n < t; n++) this.priority[n] = e.readUint16();
	}
}, us.fourcc = "stdp", us), cu = (ds = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SubTrackInformationBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.switch_group = e.readUint16(), this.alternate_group = e.readUint16(), this.sub_track_id = e.readUint32();
		let t = (this.size - this.hdr_size - 8) / 4;
		this.attribute_list = [];
		for (let n = 0; n < t; n++) this.attribute_list[n] = e.readUint32();
	}
}, ds.fourcc = "stri", ds), lu = (fs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SubTrackSampleGroupBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.grouping_type = e.readUint32();
		let t = e.readUint16();
		this.group_description_index = [];
		for (let n = 0; n < t; n++) this.group_description_index[n] = e.readUint32();
	}
}, fs.fourcc = "stsg", fs), uu = (ps = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "ShadowSyncSampleBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.shadowed_sample_numbers = [], this.sync_sample_numbers = [], this.version === 0) for (let n = 0; n < t; n++) this.shadowed_sample_numbers.push(e.readUint32()), this.sync_sample_numbers.push(e.readUint32());
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4 + 8 * this.shadowed_sample_numbers.length, this.writeHeader(e), e.writeUint32(this.shadowed_sample_numbers.length);
		for (let t = 0; t < this.shadowed_sample_numbers.length; t++) e.writeUint32(this.shadowed_sample_numbers[t]), e.writeUint32(this.sync_sample_numbers[t]);
	}
}, ps.fourcc = "stsh", ps), du = (ms = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SyncSampleBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		if (this.version === 0) {
			this.sample_numbers = [];
			for (let n = 0; n < t; n++) this.sample_numbers.push(e.readUint32());
		}
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = 4 + 4 * this.sample_numbers.length, this.writeHeader(e), e.writeUint32(this.sample_numbers.length), e.writeUint32Array(this.sample_numbers);
	}
}, ms.fourcc = "stss", ms), fu = (hs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "StereoVideoBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		this.single_view_allowed = t & 3, this.stereo_scheme = e.readUint32();
		let n = e.readUint32();
		for (this.stereo_indication_type = e.readString(n), this.boxes = []; e.getPosition() < this.start + this.size;) {
			let t = V(e, !1, this.size - (e.getPosition() - this.start));
			if (t.code === 1) {
				let e = t.box;
				this.boxes.push(e), this[e.type] = e;
			} else return;
		}
	}
}, hs.fourcc = "stvi", hs), pu = (gs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "CompactSampleSizeBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.sample_sizes = [], this.version === 0) {
			this.reserved = e.readUint24(), this.field_size = e.readUint8();
			let t = e.readUint32();
			if (this.field_size === 4) for (let n = 0; n < t; n += 2) {
				let t = e.readUint8();
				this.sample_sizes[n] = t >> 4 & 15, this.sample_sizes[n + 1] = t & 15;
			}
			else if (this.field_size === 8) for (let n = 0; n < t; n++) this.sample_sizes[n] = e.readUint8();
			else if (this.field_size === 16) for (let n = 0; n < t; n++) this.sample_sizes[n] = e.readUint16();
			else N.error("BoxParser", "Error in length field in stz2 box", e.isofile);
		}
	}
}, gs.fourcc = "stz2", gs), mu = (_s = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "SubSampleInformationBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint32();
		this.entries = [];
		let n;
		for (let r = 0; r < t; r++) {
			let t = {};
			if (this.entries[r] = t, t.sample_delta = e.readUint32(), t.subsamples = [], n = e.readUint16(), n > 0) for (let r = 0; r < n; r++) {
				let n = {};
				t.subsamples.push(n), n.size = this.version === 1 ? e.readUint32() : e.readUint16(), n.priority = e.readUint8(), n.discardable = e.readUint8(), n.codec_specific_parameters = e.readUint32();
			}
		}
	}
}, _s.fourcc = "subs", _s), hu = (vs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TAIClockInfoBox";
	}
	parse(e) {
		this.time_uncertainty = e.readUint64(), this.clock_resolution = e.readUint32(), this.clock_drift_rate = e.readInt32();
		let t = e.readUint8();
		this.clock_type = (t & 192) >> 6;
	}
}, vs.fourcc = "taic", vs), gu = (ys = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackEncryptionBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), e.readUint8(), this.version === 0) e.readUint8();
		else {
			let t = e.readUint8();
			this.default_crypt_byte_block = t >> 4 & 15, this.default_skip_byte_block = t & 15;
		}
		this.default_isProtected = e.readUint8(), this.default_Per_Sample_IV_Size = e.readUint8(), this.default_KID = B(e), this.default_isProtected === 1 && this.default_Per_Sample_IV_Size === 0 && (this.default_constant_IV_size = e.readUint8(), this.default_constant_IV = e.readUint8Array(this.default_constant_IV_size));
	}
}, ys.fourcc = "tenc", ys), _u = class {}, vu = (bs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackFragmentRandomAccessBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.track_ID = e.readUint32(), e.readUint24();
		let t = e.readUint8();
		this.length_size_of_traf_num = t >> 4 & 3, this.length_size_of_trun_num = t >> 2 & 3, this.length_size_of_sample_num = t & 3, this.entries = [];
		let n = e.readUint32();
		for (let t = 0; t < n; t++) {
			let t = new _u();
			this.version === 1 ? (t.time = e.readUint64(), t.moof_offset = e.readUint64()) : (t.time = e.readUint32(), t.moof_offset = e.readUint32()), t.traf_number = e["readUint" + 8 * (this.length_size_of_traf_num + 1)](), t.trun_number = e["readUint" + 8 * (this.length_size_of_trun_num + 1)](), t.sample_delta = e["readUint" + 8 * (this.length_size_of_sample_num + 1)](), this.entries.push(t);
		}
	}
}, bs.fourcc = "tfra", bs), yu = (xs = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintmaxrelativetime";
	}
	parse(e) {
		this.time = e.readUint32();
	}
}, xs.fourcc = "tmax", xs), bu = (Ss = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintminrelativetime";
	}
	parse(e) {
		this.time = e.readUint32();
	}
}, Ss.fourcc = "tmin", Ss), xu = (Cs = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint32();
	}
}, Cs.fourcc = "totl", Cs), Su = (ws = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint32();
	}
}, ws.fourcc = "tpay", ws), Cu = (Ts = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint64();
	}
}, Ts.fourcc = "tpyl", Ts), wu = (Es = class extends En {}, Es.fourcc = "msrc", Es), Tu = (Ds = class e extends F {
	constructor(...e) {
		super(...e), this.box_name = "TrackReferenceBox", this.references = [];
	}
	parse(t) {
		for (; t.getPosition() < this.start + this.size;) {
			let n = V(t, !0, this.size - (t.getPosition() - this.start));
			if (n.code === 1) {
				e.allowed_types.includes(n.type) || N.warn("BoxParser", `Unknown track reference type: '${n.type}'`);
				let r = new kn(n.type, n.size, n.hdr_size, n.start);
				r.write === F.prototype.write && r.type !== "mdat" && (N.info("BoxParser", "TrackReference " + r.type + " box writing not yet implemented, keeping unparsed data in memory for later write"), r.parseDataAndRewind(t)), r.parse(t), this.references.push(r);
			} else return;
		}
	}
}, Ds.fourcc = "tref", Ds.allowed_types = [
	"hint",
	"cdsc",
	"font",
	"hind",
	"vdep",
	"vplx",
	"subt",
	"thmb",
	"auxl",
	"cdtg",
	"shsc",
	"aest"
], Ds), Eu = (Os = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackExtensionPropertiesBox";
	}
	parse(e) {
		for (this.parseFullHeader(e), this.track_ID = e.readUint32(), this.boxes = []; e.getPosition() < this.start + this.size;) {
			let t = V(e, !1, this.size - (e.getPosition() - this.start));
			if (t.code === 1) {
				let e = t.box;
				this.boxes.push(e);
			} else return;
		}
	}
}, Os.fourcc = "trep", Os), Du = (ks = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "hintBytesSent";
	}
	parse(e) {
		this.bytessent = e.readUint64();
	}
}, ks.fourcc = "trpy", ks), Ou = (As = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TrackSelectionBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.switch_group = e.readUint32();
		let t = (this.size - this.hdr_size - 4) / 4;
		this.attribute_list = [];
		for (let n = 0; n < t; n++) this.attribute_list[n] = e.readUint32();
	}
}, As.fourcc = "tsel", As), ku = (js = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "TextConfigBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.config = e.readCString();
	}
}, js.fourcc = "txtc", js), Au = (Ms = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "TypeCombinationBox";
	}
	parse(e) {
		let t = (this.size - this.hdr_size) / 4;
		this.compatible_brands = [];
		for (let n = 0; n < t; n++) this.compatible_brands[n] = e.readString(4);
	}
}, Ms.fourcc = "tyco", Ms), ju = (Ns = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "UserDescriptionProperty";
	}
	parse(e) {
		this.parseFullHeader(e), this.lang = e.readCString(), this.name = e.readCString(), this.description = e.readCString(), this.tags = e.readCString();
	}
}, Ns.fourcc = "udes", Ns), Mu = (Ps = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "UncompressedFrameConfigBox";
	}
	parse(e) {
		if (this.parseFullHeader(e), this.profile = e.readString(4), this.version !== 1 && this.version === 0) {
			this.component_count = e.readUint32(), this.component_index = [], this.component_bit_depth_minus_one = [], this.component_format = [], this.component_align_size = [];
			for (let t = 0; t < this.component_count; t++) this.component_index.push(e.readUint16()), this.component_bit_depth_minus_one.push(e.readUint8()), this.component_format.push(e.readUint8()), this.component_align_size.push(e.readUint8());
			this.sampling_type = e.readUint8(), this.interleave_type = e.readUint8(), this.block_size = e.readUint8();
			let t = e.readUint8();
			this.component_little_endian = t >> 7 & 1, this.block_pad_lsb = t >> 6 & 1, this.block_little_endian = t >> 5 & 1, this.block_reversed = t >> 4 & 1, this.pad_unknown = t >> 3 & 1, this.pixel_size = e.readUint32(), this.row_align_size = e.readUint32(), this.tile_align_size = e.readUint32(), this.num_tile_cols_minus_one = e.readUint32(), this.num_tile_rows_minus_one = e.readUint32();
		}
	}
}, Ps.fourcc = "uncC", Ps), Nu = (Fs = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "DataEntryUrnBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.name = e.readCString(), this.size - this.hdr_size - this.name.length - 1 > 0 && (this.location = e.readCString());
	}
	write(e) {
		this.version = 0, this.flags = 0, this.size = this.name.length + 1 + (this.location ? this.location.length + 1 : 0), this.writeHeader(e), e.writeCString(this.name), this.location && e.writeCString(this.location);
	}
}, Fs.fourcc = "urn ", Fs), Pu = (Is = class extends F {
	constructor(...e) {
		super(...e), this.box_name = "WebVTTConfigurationBox";
	}
	parse(e) {
		this.text = e.readString(this.size - this.hdr_size);
	}
}, Is.fourcc = "vttC", Is), Fu = (Ls = class extends I {
	constructor(...e) {
		super(...e), this.box_name = "VvcNALUConfigBox";
	}
	parse(e) {
		this.parseFullHeader(e);
		let t = e.readUint8();
		this.lengthSizeMinusOne = t & 3;
	}
}, Ls.fourcc = "vvnC", Ls), Iu = (Rs = class extends L {
	parse(e) {
		let t = e.readUint16();
		this.first_output_sample = e.readUint16(), this.sample_offset = [];
		for (let n = 0; n < t; n++) this.sample_offset[n] = e.readUint32();
		let n = this.description_length - 4 - 4 * t;
		this.num_output_samples = [], this.num_total_samples = [];
		for (let t = 0; t < n / 4; t++) this.num_output_samples[t] = e.readUint16(), this.num_total_samples[t] = e.readUint16();
	}
}, Rs.grouping_type = "alst", Rs), Lu = (zs = class extends L {
	parse(e) {
		this.layerNumber = e.readUint8(), this.accurateStatisticsFlag = e.readUint8(), this.avgBitRate = e.readUint16(), this.avgFrameRate = e.readUint16();
	}
}, zs.grouping_type = "avll", zs), Ru = (Bs = class extends L {
	parse(e) {
		this.subSequenceIdentifier = e.readUint16(), this.layerNumber = e.readUint8();
		let t = e.readUint8();
		this.durationFlag = t >> 7, this.avgRateFlag = t >> 6 & 1, this.durationFlag && (this.duration = e.readUint32()), this.avgRateFlag && (this.accurateStatisticsFlag = e.readUint8(), this.avgBitRate = e.readUint16(), this.avgFrameRate = e.readUint16()), this.dependency = [];
		let n = e.readUint8();
		for (let t = 0; t < n; t++) this.dependency.push({
			subSeqDirectionFlag: e.readUint8(),
			layerNumber: e.readUint8(),
			subSequenceIdentifier: e.readUint16()
		});
	}
}, Bs.grouping_type = "avss", Bs), zu = (Vs = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, Vs.grouping_type = "dtrt", Vs), Bu = (Hs = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, Hs.grouping_type = "mvif", Hs), Vu = (Us = class extends L {
	parse(e) {
		this.roll_distance = e.readInt16();
	}
}, Us.grouping_type = "prol", Us), Hu = (Ws = class extends L {
	parse(e) {
		let t = e.readUint8();
		this.num_leading_samples_known = t >> 7, this.num_leading_samples = t & 127;
	}
}, Ws.grouping_type = "rap ", Ws), Uu = (Gs = class extends L {
	parse(e) {
		if (this.operation_point_count = e.readUint16(), this.description_length !== 2 + (this.operation_point_count === 1 ? 2 : this.operation_point_count * 6) + 9) N.warn("BoxParser", "Mismatch in " + this.grouping_type + " sample group length"), this.data = e.readUint8Array(this.description_length - 2);
		else {
			if (this.operation_point_count === 1) this.target_rate_share = e.readUint16();
			else {
				this.target_rate_share = [], this.available_bitrate = [];
				for (let t = 0; t < this.operation_point_count; t++) this.available_bitrate[t] = e.readUint32(), this.target_rate_share[t] = e.readUint16();
			}
			this.maximum_bitrate = e.readUint32(), this.minimum_bitrate = e.readUint32(), this.discard_priority = e.readUint8();
		}
	}
}, Gs.grouping_type = "rash", Gs), Wu = (Ks = class extends L {
	parse(e) {
		this.roll_distance = e.readInt16();
	}
}, Ks.grouping_type = "roll", Ks), Gu = (qs = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, qs.grouping_type = "scif", qs), Ku = (Js = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, Js.grouping_type = "scnm", Js), qu = (Ys = class extends L {
	parse(e) {
		this.reserved = e.readUint8();
		let t = e.readUint8();
		this.crypt_byte_block = t >> 4, this.skip_byte_block = t & 15, this.isProtected = e.readUint8(), this.Per_Sample_IV_Size = e.readUint8(), this.KID = B(e), this.constant_IV_size = 0, this.constant_IV = 0, this.isProtected === 1 && this.Per_Sample_IV_Size === 0 && (this.constant_IV_size = e.readUint8(), this.constant_IV = e.readUint8Array(this.constant_IV_size));
	}
}, Ys.grouping_type = "seig", Ys), Ju = (Xs = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, Xs.grouping_type = "stsa", Xs), Yu = (Zs = class extends L {
	parse(e) {
		let t = e.readUint8();
		this.NAL_unit_type = t & 63;
	}
}, Zs.grouping_type = "sync", Zs), Xu = (Qs = class extends L {
	parse(e) {
		let t = e.readUint8();
		this.level_independently_decodable = t >> 7;
	}
}, Qs.grouping_type = "tele", Qs), Zu = ($s = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, $s.grouping_type = "tsas", $s), Qu = (ec = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, ec.grouping_type = "tscl", ec), $u = (tc = class extends L {
	parse(e) {
		N.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
	}
}, tc.grouping_type = "vipr", tc), ed = (nc = class extends F {}, nc.fourcc = "uuid", nc), $ = (rc = class extends I {}, rc.fourcc = "uuid", rc), td = (ic = class extends $ {
	constructor(...e) {
		super(...e), this.box_name = "LiveServerManifestBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.LiveServerManifest = e.readString(this.size - this.hdr_size).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
	}
}, ic.uuid = "a5d40b30e81411ddba2f0800200c9a66", ic), nd = (ac = class extends $ {
	constructor(...e) {
		super(...e), this.box_name = "PiffProtectionSystemSpecificHeaderBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.system_id = B(e);
		let t = e.readUint32();
		t > 0 && (this.data = e.readUint8Array(t));
	}
}, ac.uuid = "d08a4f1810f34a82b6c832d8aba183d3", ac), rd = (oc = class extends $ {
	constructor(...e) {
		super(...e), this.box_name = "PiffSampleEncryptionBox";
	}
}, oc.uuid = "a2394f525a9b4f14a2446c427c648df4", oc), id = (sc = class extends $ {
	constructor(...e) {
		super(...e), this.box_name = "PiffTrackEncryptionBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.default_AlgorithmID = e.readUint24(), this.default_IV_size = e.readUint8(), this.default_KID = B(e);
	}
}, sc.uuid = "8974dbce7be74c5184f97148f9882554", sc), ad = (cc = class extends $ {
	constructor(...e) {
		super(...e), this.box_name = "TfrfBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.fragment_count = e.readUint8(), this.entries = [];
		for (let t = 0; t < this.fragment_count; t++) {
			let t = 0, n = 0;
			this.version === 1 ? (t = e.readUint64(), n = e.readUint64()) : (t = e.readUint32(), n = e.readUint32()), this.entries.push({
				absolute_time: t,
				absolute_duration: n
			});
		}
	}
}, cc.uuid = "d4807ef2ca3946958e5426cb9e46a79f", cc), od = (lc = class extends $ {
	constructor(...e) {
		super(...e), this.box_name = "TfxdBox";
	}
	parse(e) {
		this.parseFullHeader(e), this.version === 1 ? (this.absolute_time = e.readUint64(), this.duration = e.readUint64()) : (this.absolute_time = e.readUint32(), this.duration = e.readUint32());
	}
}, lc.uuid = "6d1d9b0542d544e680e2141daff757b2", lc), sd = (uc = class extends ed {
	constructor(...e) {
		super(...e), this.box_name = "ItemContentIDProperty";
	}
	parse(e) {
		this.content_id = e.readCString();
	}
}, uc.uuid = "261ef3741d975bbaacbd9d2c8ea73522", uc), cd = (dc = class extends ed {
	constructor(...e) {
		super(...e), this.box_name = "ItemComponentContentIDProperty";
	}
	parse(e) {
		this.number_of_components = e.readUint32(), this.content_ids = [];
		for (let t = 0; t < this.number_of_components; t++) {
			let t = e.readCString();
			this.content_ids.push(t);
		}
	}
}, dc.uuid = "9db9dd6e373c5a4e811021fc83a911fd", dc);
Rn(/* @__PURE__ */ r({
	CoLLBox: () => Pc,
	ItemComponentContentIDPropertyBox: () => cd,
	ItemContentIDPropertyBox: () => sd,
	OpusSampleEntry: () => Ri,
	SmDmBox: () => au,
	a1lxBox: () => xc,
	a1opBox: () => Sc,
	ac_3SampleEntry: () => Fi,
	ac_4SampleEntry: () => Ii,
	aebrBox: () => Zc,
	afbrBox: () => Qc,
	albcBox: () => $c,
	alstSampleGroupEntry: () => Iu,
	altrBox: () => el,
	auxCBox: () => Cc,
	av01SampleEntry: () => oi,
	av1CBox: () => Jr,
	avc1SampleEntry: () => ni,
	avc2SampleEntry: () => ri,
	avc3SampleEntry: () => ii,
	avc4SampleEntry: () => ai,
	avcCBox: () => Gn,
	avllSampleGroupEntry: () => Lu,
	avs3SampleEntry: () => Di,
	avssSampleGroupEntry: () => Ru,
	brstBox: () => tl,
	btrtBox: () => wc,
	bxmlBox: () => er,
	ccstBox: () => Tc,
	cdefBox: () => Ec,
	clapBox: () => Dc,
	clefBox: () => Wl,
	clliBox: () => Oc,
	cmexBox: () => kc,
	cminBox: () => Ac,
	cmpCBox: () => jc,
	cmpdBox: () => Mc,
	co64Box: () => Nc,
	colrBox: () => ei,
	coviBox: () => Lc,
	cprtBox: () => Rc,
	cschBox: () => zc,
	cslgBox: () => Bc,
	cttsBox: () => Vc,
	dOpsBox: () => Jc,
	dac3Box: () => Hc,
	dataBox: () => Q,
	dav1SampleEntry: () => si,
	dec3Box: () => Uc,
	dfLaBox: () => Wc,
	dimmBox: () => Gc,
	dinfBox: () => sr,
	dmax: () => Kc,
	dmedBox: () => qc,
	dobrBox: () => nl,
	drefBox: () => Ar,
	drepBox: () => Yc,
	dtrtSampleGroupEntry: () => zu,
	dvh1SampleEntry: () => _i,
	dvheSampleEntry: () => vi,
	ec_3SampleEntry: () => Li,
	edtsBox: () => ir,
	elngBox: () => jr,
	elstBox: () => Xc,
	emsgBox: () => wa,
	encaSampleEntry: () => Gi,
	encmSampleEntry: () => Xi,
	encsSampleEntry: () => qi,
	enctSampleEntry: () => Yi,
	encuSampleEntry: () => Ki,
	encvSampleEntry: () => Wi,
	enofBox: () => Kl,
	eqivBox: () => rl,
	esdsBox: () => Yr,
	etypBox: () => Or,
	fLaCSampleEntry: () => Ui,
	favcBox: () => il,
	fielBox: () => ml,
	fobrBox: () => al,
	freeBox: () => Jn,
	frmaBox: () => hl,
	ftypBox: () => Mr,
	grplBox: () => Er,
	hdlrBox: () => Nr,
	hev1SampleEntry: () => di,
	hev2SampleEntry: () => fi,
	hinfBox: () => gr,
	hmhdBox: () => Xn,
	hntiBox: () => hr,
	hvc1SampleEntry: () => li,
	hvc2SampleEntry: () => ui,
	hvcCBox: () => Pr,
	hvt1SampleEntry: () => pi,
	iaugBox: () => ol,
	idatBox: () => qn,
	iinfBox: () => Rr,
	ilocBox: () => zr,
	ilstBox: () => ql,
	imirBox: () => gl,
	infeBox: () => Lr,
	iodsBox: () => Qn,
	ipcoBox: () => Tr,
	ipmaBox: () => _l,
	iproBox: () => tr,
	iprpBox: () => wr,
	irefBox: () => Vr,
	irotBox: () => vl,
	ispeBox: () => yl,
	itaiBox: () => bl,
	j2kHBox: () => Dr,
	j2kiSampleEntry: () => Oi,
	keysBox: () => Jl,
	kindBox: () => xl,
	levaBox: () => Sl,
	lhe1SampleEntry: () => mi,
	lhv1SampleEntry: () => hi,
	lhvCBox: () => Cl,
	lselBox: () => wl,
	lvc1SampleEntry: () => gi,
	lvcCBox: () => Zr,
	m4aeSampleEntry: () => Pi,
	maxrBox: () => Tl,
	mdatBox: () => Kn,
	mdcvBox: () => Dl,
	mdhdBox: () => Fr,
	mdiaBox: () => ar,
	mecoBox: () => mr,
	mehdBox: () => Ir,
	metaBox: () => Ur,
	mettSampleEntry: () => Kr,
	metxSampleEntry: () => qr,
	mfhdBox: () => Wr,
	mfraBox: () => pr,
	mfroBox: () => Ol,
	mha1SampleEntry: () => zi,
	mha2SampleEntry: () => Bi,
	mhm1SampleEntry: () => Vi,
	mhm2SampleEntry: () => Hi,
	minfBox: () => or,
	mjp2SampleEntry: () => ki,
	mjpgSampleEntry: () => Ai,
	moofBox: () => ur,
	moovBox: () => nr,
	mp4aSampleEntry: () => Ni,
	mp4sSampleEntry: () => Ji,
	mp4vSampleEntry: () => Mi,
	mskCBox: () => kl,
	msrcTrackGroupTypeBox: () => wu,
	mvexBox: () => lr,
	mvhdBox: () => Gr,
	mvifSampleGroupEntry: () => Bu,
	nmhdBox: () => Zn,
	npckBox: () => Al,
	numpBox: () => jl,
	padbBox: () => Nl,
	panoBox: () => sl,
	paspBox: () => Pl,
	paylBox: () => Fl,
	paytBox: () => Il,
	pdinBox: () => Ll,
	piffLsmBox: () => td,
	piffPsshBox: () => nd,
	piffSencBox: () => rd,
	piffTencBox: () => id,
	piffTfrfBox: () => ad,
	piffTfxdBox: () => od,
	pitmBox: () => Hr,
	pixiBox: () => Rl,
	pmaxBox: () => zl,
	povdBox: () => kr,
	prdiBox: () => Bl,
	prfrBox: () => Vl,
	prftBox: () => Hl,
	prgrBox: () => fl,
	profBox: () => Yl,
	prolSampleGroupEntry: () => Vu,
	psshBox: () => Ul,
	pymdBox: () => pl,
	rapSampleGroupEntry: () => Hu,
	rashSampleGroupEntry: () => Uu,
	resvSampleEntry: () => Zi,
	rinfBox: () => br,
	rollSampleGroupEntry: () => Wu,
	rtp_Box: () => Zl,
	saioBox: () => Ql,
	saizBox: () => $l,
	sbgpBox: () => ra,
	sbpmBox: () => tu,
	sbttSampleEntry: () => Qi,
	schiBox: () => xr,
	schmBox: () => nu,
	scifSampleGroupEntry: () => Gu,
	scnmSampleGroupEntry: () => Ku,
	sdp_Box: () => ru,
	sdtpBox: () => ia,
	seigSampleGroupEntry: () => qu,
	sencBox: () => iu,
	sgpdBox: () => aa,
	sidxBox: () => oa,
	sinfBox: () => yr,
	skipBox: () => Yn,
	slidBox: () => cl,
	smhdBox: () => sa,
	sratBox: () => ou,
	ssixBox: () => Ta,
	stblBox: () => cr,
	stcoBox: () => ca,
	stdpBox: () => su,
	sterBox: () => ll,
	sthdBox: () => la,
	stppSampleEntry: () => $i,
	strdBox: () => vr,
	striBox: () => cu,
	strkBox: () => _r,
	stsaSampleGroupEntry: () => Ju,
	stscBox: () => ua,
	stsdBox: () => da,
	stsgBox: () => lu,
	stshBox: () => uu,
	stssBox: () => du,
	stszBox: () => fa,
	sttsBox: () => pa,
	stviBox: () => fu,
	stxtSampleEntry: () => ea,
	stypBox: () => Ea,
	stz2Box: () => pu,
	subsBox: () => mu,
	syncSampleGroupEntry: () => Yu,
	taicBox: () => hu,
	taptBox: () => Xl,
	teleSampleGroupEntry: () => Xu,
	tencBox: () => gu,
	tfdtBox: () => ma,
	tfhdBox: () => ha,
	tfraBox: () => vu,
	tkhdBox: () => ga,
	tmaxBox: () => yu,
	tminBox: () => bu,
	totlBox: () => xu,
	tpayBox: () => Su,
	tpylBox: () => Cu,
	trafBox: () => dr,
	trakBox: () => rr,
	trefBox: () => Tu,
	trepBox: () => Eu,
	trexBox: () => _a,
	trgrBox: () => Sr,
	trpyBox: () => Du,
	trunBox: () => va,
	tsasSampleGroupEntry: () => Zu,
	tsclSampleGroupEntry: () => Qu,
	tselBox: () => Ou,
	tsynBox: () => ul,
	tx3gSampleEntry: () => ta,
	txtcBox: () => ku,
	tycoBox: () => Au,
	udesBox: () => ju,
	udtaBox: () => Cr,
	uncCBox: () => Mu,
	uncvSampleEntry: () => ji,
	urlBox: () => ya,
	urnBox: () => Nu,
	viprSampleGroupEntry: () => $u,
	vmhdBox: () => ba,
	vp08SampleEntry: () => Ti,
	vp09SampleEntry: () => Ei,
	vpcCBox: () => Qr,
	vttCBox: () => Pu,
	vttcBox: () => fr,
	vvc1SampleEntry: () => bi,
	vvcCBox: () => $r,
	vvcNSampleEntry: () => Ci,
	vvi1SampleEntry: () => xi,
	vvnCBox: () => Fu,
	vvs1SampleEntry: () => Si,
	waveBox: () => Xr,
	wbbrBox: () => dl,
	wvttSampleEntry: () => na,
	xmlBox: () => $n
})), zn(fc);
export { t as i, A as n, Ca as r, Da as t };

//# sourceMappingURL=mp4box.all-Bw_Tlr0T.mjs.map