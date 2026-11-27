#include <stdint.h>
#include "pcre2.h"

static pcre2_match_context *context;
static uint32_t fuel;
static PCRE2_SIZE match_offset;

static int charge(pcre2_callout_block *block, void *data) {
  (void)block;
  (void)data;
  if (!fuel) return PCRE2_ERROR_MATCHLIMIT;
  --fuel;
  return 0;
}

int reset_budget(void) {
  if (!context) {
    context = pcre2_match_context_create(NULL);
    if (!context) return 0;
    pcre2_set_match_limit(context, 65536);
    pcre2_set_depth_limit(context, 128);
    pcre2_set_heap_limit(context, 512);
    pcre2_set_callout(context, charge, NULL);
  }
  fuel = 262144;
  return 1;
}

pcre2_code *compile_pattern(const PCRE2_UCHAR *pattern, uint32_t length, uint32_t ignore_case) {
  int error;
  PCRE2_SIZE offset, size;
  pcre2_code *code = pcre2_compile(pattern, length,
    PCRE2_UTF | PCRE2_AUTO_CALLOUT | PCRE2_NEVER_BACKSLASH_C | (ignore_case ? PCRE2_CASELESS : 0),
    &error, &offset, NULL);
  if (code && (pcre2_pattern_info(code, PCRE2_INFO_SIZE, &size) || size > 131072)) {
    pcre2_code_free(code);
    return NULL;
  }
  return code;
}

pcre2_match_data *create_match(pcre2_code *code) {
  return pcre2_match_data_create_from_pattern(code, NULL);
}

int run_match(pcre2_code *code, pcre2_match_data *result, const PCRE2_UCHAR *text, uint32_t length, uint32_t advance) {
  uint32_t options = 0;
  match_offset = 0;
  if (advance && !pcre2_next_match(result, &match_offset, &options)) return PCRE2_ERROR_NOMATCH;
  return pcre2_match(code, text, length, match_offset, options | PCRE2_NO_UTF_CHECK, result, context);
}

int substitute_text(pcre2_code *code, pcre2_match_data *result, const PCRE2_UCHAR *text, uint32_t length,
  const PCRE2_UCHAR *replacement, uint32_t replacement_length, PCRE2_UCHAR *output, uint32_t capacity, uint32_t selected) {
  PCRE2_SIZE output_length = capacity;
  uint32_t options = PCRE2_SUBSTITUTE_EXTENDED | PCRE2_SUBSTITUTE_UNSET_EMPTY | PCRE2_NO_UTF_CHECK;
  options |= selected ? PCRE2_SUBSTITUTE_MATCHED | PCRE2_SUBSTITUTE_REPLACEMENT_ONLY : PCRE2_SUBSTITUTE_GLOBAL;
  int status = pcre2_substitute(code, text, length, selected ? match_offset : 0, options, result, context,
    replacement, replacement_length, output, &output_length);
  return status < 0 ? status : (int)output_length;
}
