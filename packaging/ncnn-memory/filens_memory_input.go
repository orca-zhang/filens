package main

import "C"

// Transport adapter for the pinned OCR capability. Decoding and recognition
// continue to use the wrapper's existing imaging/RapidOCR implementation.
import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"

	"github.com/disintegration/imaging"
)

//export filens_ocr_memory_input_v1
func filens_ocr_memory_input_v1() C.int { return 1 }

func filensOCRImage(parsed inferRequest, imagePath string) (image.Image, error) {
	encoded := metadataStringValue(parsed.Input["image_base64"])
	if encoded == "" {
		return imaging.Open(imagePath, imaging.AutoOrientation(true))
	}
	const maxBytes = 256 << 20
	if len(encoded) > base64.StdEncoding.EncodedLen(maxBytes) {
		return nil, fmt.Errorf("OCR image exceeds 256 MiB")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("invalid OCR image bytes: %w", err)
	}
	if len(data) > maxBytes {
		return nil, fmt.Errorf("OCR image exceeds 256 MiB")
	}
	return imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
}
