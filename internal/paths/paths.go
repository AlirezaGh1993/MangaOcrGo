package paths

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

func ExeDir() (string, error) {
	cwd, err := os.Getwd()
	if err == nil {
		// Prefer working directory when it looks like the app root (has static/ or go.mod)
		if fileExists(filepath.Join(cwd, "static")) || fileExists(filepath.Join(cwd, "go.mod")) {
			return cwd, nil
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return cwd, nil
	}
	dir := filepath.Dir(exe)
	if strings.Contains(dir, "go-build") || strings.Contains(strings.ToLower(exe), "temp") {
		if cwd != "" {
			return cwd, nil
		}
	}
	// If binary sits next to static/, use that
	if fileExists(filepath.Join(dir, "static")) {
		return dir, nil
	}
	if cwd != "" {
		return cwd, nil
	}
	return dir, nil
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func DataDir(exeDir string) string     { return filepath.Join(exeDir, "data") }
func FontsDir(exeDir string) string    { return filepath.Join(DataDir(exeDir), "fonts") }
func ProjectsDir(exeDir string) string { return filepath.Join(DataDir(exeDir), "projects") }
func ExportsDir(exeDir string) string  { return filepath.Join(DataDir(exeDir), "exports") }
func StaticDir(exeDir string) string   { return filepath.Join(exeDir, "static") }

func EnsureDirs(exeDir string) error {
	for _, d := range []string{FontsDir(exeDir), ProjectsDir(exeDir), ExportsDir(exeDir)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	return nil
}

// SafeJoin joins under base and rejects path traversal.
func SafeJoin(base string, parts ...string) (string, bool) {
	baseReal, err := filepath.Abs(base)
	if err != nil {
		return "", false
	}
	target := filepath.Join(append([]string{baseReal}, parts...)...)
	targetReal, err := filepath.Abs(target)
	if err != nil {
		return "", false
	}
	sep := string(os.PathSeparator)
	if targetReal == baseReal || strings.HasPrefix(targetReal, baseReal+sep) {
		return targetReal, true
	}
	return "", false
}

func ShortUUID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
