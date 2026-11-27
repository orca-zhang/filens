#include <stdint.h>
#include "writeFontFile.h"

static unsigned output_size;

uint8_t *decode(const uint8_t *input, unsigned length, int encrypted) {
  uint8_t *output = 0;
  output_size = 0;
  const enum EOTError result = writeFontBuffer(input, length, true, encrypted != 0, &output, &output_size);
  return (result == EOT_SUCCESS || result >= EOT_WARN) ? output : 0;
}

unsigned decoded_size(void) { return output_size; }
