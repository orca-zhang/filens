/** libheif 1.23.5's wasm32 C ABI. Parsing and pixel decoding stay inside WASM. */
export interface HeifModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _heif_context_alloc(): number;
  _heif_context_free(context: number): void;
  _heif_context_get_security_limits(context: number): number;
  _heif_context_set_max_decoding_threads(context: number, count: number): void;
  _heif_context_read_from_memory_without_copy(error: number, context: number, input: number, length: number, options: number): void;
  _heif_context_get_primary_image_handle(error: number, context: number, output: number): void;
  _heif_image_handle_release(handle: number): void;
  _heif_image_handle_get_item_id(handle: number): number;
  _heif_image_handle_get_width(handle: number): number;
  _heif_image_handle_get_height(handle: number): number;
  _heif_image_handle_get_ispe_width(handle: number): number;
  _heif_image_handle_get_ispe_height(handle: number): number;
  _heif_image_handle_get_luma_bits_per_pixel(handle: number): number;
  _heif_image_handle_get_chroma_bits_per_pixel(handle: number): number;
  _heif_image_handle_get_raw_color_profile_size(handle: number): number;
  _heif_image_handle_get_raw_color_profile(error: number, handle: number, output: number): void;
  _heif_image_handle_get_nclx_color_profile(error: number, handle: number, output: number): void;
  _heif_image_get_nclx_color_profile(error: number, image: number, output: number): void;
  _heif_nclx_color_profile_free(profile: number): void;
  _heif_nclx_color_profile_alloc(): number;
  _heif_decoding_options_alloc(): number;
  _heif_decoding_options_free(options: number): void;
  _heif_decode_image(error: number, handle: number, output: number, colorspace: number, chroma: number, options: number): void;
  _heif_image_release(image: number): void;
  _heif_image_get_width(image: number, channel: number): number;
  _heif_image_get_height(image: number, channel: number): number;
  _heif_image_get_bits_per_pixel_range(image: number, channel: number): number;
  _heif_image_get_plane_readonly(image: number, channel: number, stride: number): number;
}

export interface HeifRaster {
  width: number; height: number; stride: number; bits: number;
  primaries: number; transfer: number;
  icc: Uint8Array; pixels: Uint8Array;
}
export interface HeifColorProfile { primaries: number; transfer: number; matrix: number; fullRange: boolean }

export const MAX_HEIF_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
const MAX_ICC = 4 * 1024 * 1024;

/** Consume borrowed source-depth RGB before releasing the decoder's context. */
export function withDecodedHeif<T>(heif: HeifModule, input: Uint8Array, consume: (raster: HeifRaster) => T,
  readColorProfile?: (input: Uint8Array, itemId: number) => HeifColorProfile | null): T {
  if (!input.length || input.length > MAX_HEIF_INPUT_BYTES) throw new Error('HEIF input exceeds the 64 MiB preview limit or is empty.');
  let context = 0, source = 0, scratch = 0, handle = 0, image = 0, options = 0, nclx = 0, iccPointer = 0;
  const alloc = (size: number) => {
    const pointer = heif._malloc(size);
    if (!pointer) throw new Error('HEIF decoder could not allocate its buffer.');
    return pointer;
  };
  const check = (operation: string, missingProfile = false) => {
    const code = heif.HEAPU32[scratch / 4]!;
    if (code && !(missingProfile && code === 10)) throw new Error(`HEIF ${operation} failed (code ${code}).`);
    return code === 0;
  };
  const dimensions = (width: number, height: number) => {
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > MAX_PIXELS) {
      throw new Error('HEIF image dimensions exceed the preview limit.');
    }
  };
  try {
    context = heif._heif_context_alloc();
    if (!context) throw new Error('HEIF decoder could not create its context.');
    const limits = heif._heif_context_get_security_limits(context);
    if (!limits || heif.HEAPU8[limits]! < 2) throw new Error('HEIF decoder does not expose the required resource limits.');
    // Only tighten this context; never disable or change process-global limits.
    const tighten64 = (offset: number, maximum: number) => {
      const view = new DataView(heif.HEAPU8.buffer);
      const current = view.getBigUint64(limits + offset, true);
      if (!current || current > BigInt(maximum)) view.setBigUint64(limits + offset, BigInt(maximum), true);
    };
    tighten64(8, MAX_PIXELS);
    tighten64(40, 512 * 1024 * 1024);
    tighten64(64, 1024 * 1024 * 1024);
    const profileLimit = heif.HEAPU32[(limits + 32) / 4]!;
    if (!profileLimit || profileLimit > MAX_ICC) heif.HEAPU32[(limits + 32) / 4] = MAX_ICC;
    heif._heif_context_set_max_decoding_threads(context, 2);
    scratch = alloc(64);
    source = alloc(input.length);
    heif.HEAPU8.set(input, source);
    heif.HEAPU8.fill(0, scratch, scratch + 64);
    heif._heif_context_read_from_memory_without_copy(scratch, context, source, input.length, 0);
    check('container parsing');
    heif._heif_context_get_primary_image_handle(scratch, context, scratch + 32);
    check('primary image selection');
    handle = heif.HEAPU32[(scratch + 32) / 4]!;
    if (!handle) throw new Error('HEIF file contains no primary image.');
    dimensions(heif._heif_image_handle_get_width(handle), heif._heif_image_handle_get_height(handle));
    dimensions(heif._heif_image_handle_get_ispe_width(handle), heif._heif_image_handle_get_ispe_height(handle));

    const iccLength = heif._heif_image_handle_get_raw_color_profile_size(handle);
    if (iccLength > MAX_ICC) throw new Error('HEIF ICC profile exceeds its limit.');
    if (iccLength) {
      iccPointer = alloc(iccLength);
      heif._heif_image_handle_get_raw_color_profile(scratch, handle, iccPointer);
      check('ICC profile reading');
    }
    options = heif._heif_decoding_options_alloc();
    if (!options || heif.HEAPU8[options]! < 10) throw new Error('HEIF decoder cannot preserve source color profiles.');
    // heif_decoding_options v10, wasm32: preserve source NCLX and bit depth.
    heif.HEAPU8[options + 69] = 1;
    heif.HEAPU32[(options + 64) / 4] = 2;
    heif._heif_image_handle_get_nclx_color_profile(scratch, handle, scratch + 36);
    if (check('color profile reading', true)) nclx = heif.HEAPU32[(scratch + 36) / 4]!;
    if (!nclx && readColorProfile) {
      const profile = readColorProfile(input, heif._heif_image_handle_get_item_id(handle));
      if (profile) {
        nclx = heif._heif_nclx_color_profile_alloc();
        if (!nclx) throw new Error('HEIF decoder could not allocate its color profile.');
        heif.HEAPU32[(nclx + 4) / 4] = profile.primaries;
        heif.HEAPU32[(nclx + 8) / 4] = profile.transfer;
        heif.HEAPU32[(nclx + 12) / 4] = profile.matrix;
        heif.HEAPU8[nclx + 16] = profile.fullRange ? 1 : 0;
      }
    }
    if (!nclx) {
      // Retain decoder defaults when no explicit container or bitstream profile
      // exists. Release the native image before requesting interleaved RGB.
      heif._heif_decode_image(scratch, handle, scratch + 40, 99, 99, options);
      check('native pixel decoding');
      image = heif.HEAPU32[(scratch + 40) / 4]!;
      heif._heif_image_get_nclx_color_profile(scratch, image, scratch + 36);
      if (check('bitstream color profile reading', true)) nclx = heif.HEAPU32[(scratch + 36) / 4]!;
      heif._heif_image_release(image); image = 0;
    }
    if (nclx) heif.HEAPU32[(options + 56) / 4] = nclx;
    const highDepth = Math.max(heif._heif_image_handle_get_luma_bits_per_pixel(handle), heif._heif_image_handle_get_chroma_bits_per_pixel(handle)) > 8;
    heif._heif_decode_image(scratch, handle, scratch + 40, 1, highDepth ? 15 : 11, options);
    check('pixel decoding');
    image = heif.HEAPU32[(scratch + 40) / 4]!;
    const width = heif._heif_image_get_width(image, 10), height = heif._heif_image_get_height(image, 10);
    dimensions(width, height);
    const bits = heif._heif_image_get_bits_per_pixel_range(image, 10);
    const plane = heif._heif_image_get_plane_readonly(image, 10, scratch + 44);
    const stride = heif.HEAPU32[(scratch + 44) / 4]!;
    if (!plane || bits < 8 || bits > 16 || (!highDepth && bits !== 8) || stride < width * 4 * (highDepth ? 2 : 1)
      || stride > width * 4 * (highDepth ? 2 : 1) + 4096 || plane + stride * height > heif.HEAPU8.length) {
      throw new Error('HEIF decoder returned an invalid pixel plane.');
    }
    return consume({ width, height, stride, bits,
      primaries: nclx ? heif.HEAPU32[(nclx + 4) / 4]! : 1,
      transfer: nclx ? heif.HEAPU32[(nclx + 8) / 4]! : 13,
      icc: heif.HEAPU8.subarray(iccPointer, iccPointer + iccLength),
      pixels: heif.HEAPU8.subarray(plane, plane + stride * height) });
  } finally {
    if (image) heif._heif_image_release(image);
    if (options) heif._heif_decoding_options_free(options);
    if (nclx) heif._heif_nclx_color_profile_free(nclx);
    if (handle) heif._heif_image_handle_release(handle);
    if (context) heif._heif_context_free(context);
    for (const pointer of [iccPointer, source, scratch]) if (pointer) heif._free(pointer);
  }
}
