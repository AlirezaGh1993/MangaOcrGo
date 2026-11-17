package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"mangaserver/internal/paths"
)

var mu sync.Mutex

func settingsPath(exeDir string) string {
	return filepath.Join(paths.DataDir(exeDir), "settings.json")
}

func Load(exeDir string) map[string]any {
	mu.Lock()
	defer mu.Unlock()
	p := settingsPath(exeDir)
	b, err := os.ReadFile(p)
	if err != nil {
		return map[string]any{}
	}
	var data map[string]any
	if json.Unmarshal(b, &data) != nil || data == nil {
		return map[string]any{}
	}
	return data
}

func SaveDirect(exeDir string, data map[string]any) error {
	mu.Lock()
	defer mu.Unlock()
	return write(settingsPath(exeDir), data)
}

// SaveMerge merges incoming settings but preserves existing "fonts" unless overwritten intentionally.
func SaveMerge(exeDir string, data map[string]any) error {
	mu.Lock()
	defer mu.Unlock()
	p := settingsPath(exeDir)
	old := map[string]any{}
	if b, err := os.ReadFile(p); err == nil {
		_ = json.Unmarshal(b, &old)
	}
	if fonts, ok := old["fonts"]; ok {
		if _, has := data["fonts"]; !has {
			data["fonts"] = fonts
		}
	}
	return write(p, data)
}

func write(path string, data map[string]any) error {
	b, err := json.MarshalIndent(data, "", "    ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}
