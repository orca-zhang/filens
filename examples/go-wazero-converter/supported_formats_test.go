package converter

import (
	"reflect"
	"testing"

	"github.com/orca-zhang/filens/wasm/converter-core/manifest"
)

func TestSupportedConversionsUseWASMCoreManifest(t *testing.T) {
	if !reflect.DeepEqual(SupportedConversions(), manifest.SupportedConversions()) {
		t.Fatalf("Go host conversion preflight drifted from WASM core manifest.\nhost=%+v\nmanifest=%+v", SupportedConversions(), manifest.SupportedConversions())
	}
}
