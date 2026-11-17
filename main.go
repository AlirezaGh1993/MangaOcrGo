package main

import (
	"archive/zip"
	"mime/multipart"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"mangaserver/internal/config"
	"mangaserver/internal/paths"
	"mangaserver/internal/tools"
)

var (
	settingsMu sync.Mutex
	projectsMu sync.Mutex
)

func main() {
	exeDir, err := paths.ExeDir()
	if err != nil {
		log.Fatal(err)
	}
	if err := paths.EnsureDirs(exeDir); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()

	// Static frontend
	staticDir := paths.StaticDir(exeDir)
	mux.Handle("/", spaOrStatic(staticDir))

	// API
	mux.HandleFunc("/api/projects", method(http.MethodGet, listProjects))
	mux.HandleFunc("/api/project/new", method(http.MethodPost, createProject))
	mux.HandleFunc("/api/project/from-local-path", method(http.MethodPost, createProjectFromLocalPath))
	mux.HandleFunc("/api/project/", projectRouter)
	mux.HandleFunc("/api/projects/", serveProjectImage)
	mux.HandleFunc("/api/config", configHandler)
	mux.HandleFunc("/api/tools/magic-wand", method(http.MethodPost, apiMagicWand))
	mux.HandleFunc("/api/tools/process-marking", method(http.MethodPost, apiProcessMarking))
	mux.HandleFunc("/api/save-export", method(http.MethodPost, saveExport))
	mux.HandleFunc("/api/font/", fontRouter)
	mux.HandleFunc("/api/font/file/", serveFontFile)

	addr := "127.0.0.1:6465"
	log.Printf("Manga Server (Go) listening on http://%s  [go %s %s/%s]",
		addr, runtime.Version(), runtime.GOOS, runtime.GOARCH)
	log.Printf("Data dir: %s", paths.DataDir(exeDir))
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func method(m string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != m {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dst)
}

func spaOrStatic(staticDir string) http.Handler {
	fs := http.FileServer(http.Dir(staticDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		// API paths should not hit static
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		p := filepath.Join(staticDir, filepath.Clean(r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
}

// ── Config ──────────────────────────────────────────────────────────

func configHandler(w http.ResponseWriter, r *http.Request) {
	exeDir, _ := paths.ExeDir()
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, config.Load(exeDir))
	case http.MethodPost:
		var data map[string]any
		if err := readJSON(r, &data); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := config.SaveMerge(exeDir, data); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── Projects ────────────────────────────────────────────────────────

func listProjects(w http.ResponseWriter, r *http.Request) {
	exeDir, _ := paths.ExeDir()
	projectsDir := paths.ProjectsDir(exeDir)
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	type item struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		ImagesCount int    `json:"images_count"`
	}
	var out []item
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		jp := filepath.Join(projectsDir, id, id+".json")
		b, err := os.ReadFile(jp)
		if err != nil {
			continue
		}
		var data map[string]any
		if json.Unmarshal(b, &data) != nil {
			continue
		}
		name, _ := data["projectName"].(string)
		if name == "" {
			name = id
		}
		count := 0
		if meta, ok := data["imagesMeta"].([]any); ok {
			count = len(meta)
		}
		out = append(out, item{ID: id, Name: name, ImagesCount: count})
	}
	if out == nil {
		out = []item{}
	}
	writeJSON(w, http.StatusOK, out)
}


func isImageFilename(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff":
		return true
	default:
		return false
	}
}

func isZipFilename(name string) bool {
	return strings.ToLower(filepath.Ext(name)) == ".zip"
}

// uniqueImageName avoids collisions when extracting from nested zips/folders.
func uniqueImageName(dir, base string) string {
	base = filepath.Base(base)
	if base == "" || base == "." {
		base = "image.jpg"
	}
	candidate := base
	for i := 1; ; i++ {
		p := filepath.Join(dir, candidate)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return candidate
		}
		ext := filepath.Ext(base)
		stem := strings.TrimSuffix(base, ext)
		candidate = fmt.Sprintf("%s_%d%s", stem, i, ext)
		if i > 5000 {
			return fmt.Sprintf("%s_%s%s", stem, paths.ShortUUID()[:6], ext)
		}
	}
}

type savedImg struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ingestMultipartImages saves loose images and extracts images from any .zip
// uploads into imagesPath, sorted by natural order of source path/name.
func ingestMultipartImages(projectID, imagesPath string, form *multipart.Form) []savedImg {
	if form == nil {
		return nil
	}
	type pending struct {
		sortKey string
		name    string
		data    []byte
	}
	var items []pending

	for _, fh := range form.File["files"] {
		fname := fh.Filename
		base := filepath.Base(fname)
		if isZipFilename(base) {
			src, err := fh.Open()
			if err != nil {
				continue
			}
			tmp, err := os.CreateTemp("", "chapter-*.zip")
			if err != nil {
				src.Close()
				continue
			}
			tmpName := tmp.Name()
			_, copyErr := io.Copy(tmp, src)
			src.Close()
			tmp.Close()
			if copyErr != nil {
				os.Remove(tmpName)
				continue
			}
			zr, err := zip.OpenReader(tmpName)
			if err != nil {
				os.Remove(tmpName)
				continue
			}
			for _, zf := range zr.File {
				if zf.FileInfo().IsDir() {
					continue
				}
				zn := zf.Name
				if strings.Contains(zn, "__MACOSX") || strings.HasPrefix(filepath.Base(zn), ".") {
					continue
				}
				if !isImageFilename(zn) {
					continue
				}
				rc, err := zf.Open()
				if err != nil {
					continue
				}
				data, err := io.ReadAll(rc)
				rc.Close()
				if err != nil || len(data) == 0 {
					continue
				}
				items = append(items, pending{
					sortKey: zn,
					name:    filepath.Base(zn),
					data:    data,
				})
			}
			zr.Close()
			os.Remove(tmpName)
			continue
		}
		if !isImageFilename(base) {
			continue
		}
		src, err := fh.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(src)
		src.Close()
		if err != nil || len(data) == 0 {
			continue
		}
		items = append(items, pending{
			sortKey: fname, // includes relative path from folder upload
			name:    base,
			data:    data,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return naturalLess(items[i].sortKey, items[j].sortKey)
	})

	var saved []savedImg
	for _, it := range items {
		outName := uniqueImageName(imagesPath, it.name)
		dstPath := filepath.Join(imagesPath, outName)
		if err := os.WriteFile(dstPath, it.data, 0o644); err != nil {
			continue
		}
		saved = append(saved, savedImg{
			Name: outName,
			URL:  fmt.Sprintf("/api/projects/%s/images/%s", projectID, outName),
		})
	}
	return saved
}


// resolveUploadProjectName picks a stable chapter name from form field, ZIP, or folder path.
func resolveUploadProjectName(r *http.Request) string {
	name := strings.TrimSpace(r.FormValue("project_name"))
	if name == "" && r.MultipartForm != nil {
		if vals := r.MultipartForm.Value["project_name"]; len(vals) > 0 {
			name = strings.TrimSpace(vals[0])
		}
	}
	if name == "" && r.MultipartForm != nil {
		for _, fh := range r.MultipartForm.File["files"] {
			base := filepath.Base(fh.Filename)
			if isZipFilename(base) {
				name = strings.TrimSuffix(base, filepath.Ext(base))
				break
			}
			fn := fh.Filename
			if strings.Contains(fn, "/") || strings.Contains(fn, "\\") {
				parts := strings.FieldsFunc(fn, func(rr rune) bool { return rr == '/' || rr == '\\' })
				if len(parts) > 1 && parts[0] != "" && parts[0] != "." {
					name = parts[0]
					break
				}
			}
		}
	}
	name = strings.TrimSpace(name)
	// Strip accidental .zip
	name = strings.TrimSuffix(name, ".zip")
	name = strings.TrimSuffix(name, ".ZIP")
	if name == "" {
		name = fmt.Sprintf("پروژه جدید %s", strings.ToUpper(paths.ShortUUID()[:4]))
	}
	return name
}


// createProjectFromLocalPath imports a chapter folder from an absolute local path.
// Only accepts requests from localhost (desktop WebView / local launcher).
func createProjectFromLocalPath(w http.ResponseWriter, r *http.Request) {
	host := r.RemoteAddr
	if !strings.HasPrefix(host, "127.0.0.1") && !strings.HasPrefix(host, "[::1]") && !strings.HasPrefix(host, "localhost") {
		// RemoteAddr is host:port
		h, _, _ := strings.Cut(host, ":")
		if h != "127.0.0.1" && h != "::1" && h != "localhost" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "فقط از localhost مجاز است."})
			return
		}
	}
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	folder := strings.TrimSpace(body.Path)
	if folder == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "مسیر پوشه خالی است."})
		return
	}
	folder = filepath.Clean(folder)
	st, err := os.Stat(folder)
	if err != nil || !st.IsDir() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "پوشه معتبر نیست: " + folder})
		return
	}

	type item struct {
		sortKey string
		path    string
		name    string
	}
	var items []item
	_ = filepath.Walk(folder, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		base := info.Name()
		if strings.HasPrefix(base, ".") {
			return nil
		}
		if !isImageFilename(base) {
			return nil
		}
		rel, _ := filepath.Rel(folder, p)
		items = append(items, item{sortKey: rel, path: p, name: base})
		return nil
	})
	if len(items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "در این پوشه تصویری یافت نشد."})
		return
	}
	sort.Slice(items, func(i, j int) bool { return naturalLess(items[i].sortKey, items[j].sortKey) })

	exeDir, _ := paths.ExeDir()
	projectID := fmt.Sprintf("proj_%s", paths.ShortUUID())
	projectPath := filepath.Join(paths.ProjectsDir(exeDir), projectID)
	imagesPath := filepath.Join(projectPath, "images")
	if err := os.MkdirAll(imagesPath, 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	type imgInfo struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	var saved []imgInfo
	var meta []map[string]string
	for _, it := range items {
		outName := uniqueImageName(imagesPath, it.name)
		data, err := os.ReadFile(it.path)
		if err != nil {
			continue
		}
		if err := os.WriteFile(filepath.Join(imagesPath, outName), data, 0o644); err != nil {
			continue
		}
		saved = append(saved, imgInfo{
			Name: outName,
			URL:  fmt.Sprintf("/api/projects/%s/images/%s", projectID, outName),
		})
		meta = append(meta, map[string]string{"name": outName})
	}
	if len(saved) == 0 {
		_ = os.RemoveAll(projectPath)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "کپی تصاویر ناموفق بود."})
		return
	}

	projectName := strings.TrimSpace(body.Name)
	if projectName == "" {
		projectName = filepath.Base(folder)
	}
	if projectName == "" || projectName == "." || projectName == string(filepath.Separator) {
		projectName = fmt.Sprintf("پروژه جدید %s", strings.ToUpper(paths.ShortUUID()[:4]))
	}

	cfg := map[string]any{
		"project_id":                projectID,
		"projectName":               projectName,
		"markings":                  []any{},
		"nextMarkingId":             1,
		"imagesMeta":                meta,
		"genre":                     "general",
		"ocrLanguage":               "auto",
		"ocrDirection":              "auto",
		"lastProcessedMarkingIndex": -1,
	}
	jp := filepath.Join(projectPath, projectID+".json")
	projectsMu.Lock()
	err = writeJSONFile(jp, cfg)
	projectsMu.Unlock()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project_id": projectID,
		"images":     saved,
		"config":     cfg,
	})
}

func createProject(w http.ResponseWriter, r *http.Request) {
	exeDir, _ := paths.ExeDir()
	projectID := fmt.Sprintf("proj_%s", paths.ShortUUID())
	projectPath := filepath.Join(paths.ProjectsDir(exeDir), projectID)
	imagesPath := filepath.Join(projectPath, "images")
	if err := os.MkdirAll(imagesPath, 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	type imgInfo struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	var saved []imgInfo
	var meta []map[string]string

	// Up to ~512MB for chapter ZIP uploads
	if err := r.ParseMultipartForm(512 << 20); err == nil && r.MultipartForm != nil {
		ingested := ingestMultipartImages(projectID, imagesPath, r.MultipartForm)
		for _, img := range ingested {
			saved = append(saved, imgInfo{Name: img.Name, URL: img.URL})
			meta = append(meta, map[string]string{"name": img.Name})
		}
	}

	projectName := resolveUploadProjectName(r)


	cfg := map[string]any{
		"project_id":                projectID,
		"projectName":               projectName,
		"markings":                  []any{},
		"nextMarkingId":             1,
		"imagesMeta":                meta,
		"genre":                     "general",
		"ocrLanguage":               "auto",
		"ocrDirection":              "auto",
		"lastProcessedMarkingIndex": -1,
	}
	if meta == nil {
		cfg["imagesMeta"] = []any{}
	}

	jp := filepath.Join(projectPath, projectID+".json")
	projectsMu.Lock()
	err := writeJSONFile(jp, cfg)
	projectsMu.Unlock()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if saved == nil {
		saved = []imgInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project_id": projectID,
		"images":     saved,
		"config":     cfg,
	})
}

func projectRouter(w http.ResponseWriter, r *http.Request) {
	// /api/project/{id}
	// /api/project/{id}/images/add
	// /api/project/{id}/images/{filename}
	// /api/project/{id}/images/all
	// /api/project/{id}/rename
	path := strings.TrimPrefix(r.URL.Path, "/api/project/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	projectID := parts[0]
	rest := parts[1:]

	switch {
	case len(rest) == 0:
		switch r.Method {
		case http.MethodGet:
			loadProject(w, r, projectID)
		case http.MethodPost:
			saveProject(w, r, projectID)
		case http.MethodDelete:
			deleteProject(w, r, projectID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	case len(rest) == 1 && rest[0] == "rename" && r.Method == http.MethodPut:
		renameProject(w, r, projectID)
	case len(rest) >= 2 && rest[0] == "images" && rest[1] == "add" && r.Method == http.MethodPost:
		addImages(w, r, projectID)
	case len(rest) >= 2 && rest[0] == "images" && rest[1] == "all" && r.Method == http.MethodDelete:
		deleteAllImages(w, r, projectID)
	case len(rest) >= 2 && rest[0] == "images" && r.Method == http.MethodDelete:
		filename := strings.Join(rest[1:], "/")
		deleteImage(w, r, projectID, filename)
	default:
		http.NotFound(w, r)
	}
}

func loadProject(w http.ResponseWriter, r *http.Request, projectID string) {
	exeDir, _ := paths.ExeDir()
	jp, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID, projectID+".json")
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "فایل پروژه یافت نشد."})
		return
	}
	b, err := os.ReadFile(jp)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "فایل پروژه یافت نشد."})
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(b)
}

func saveProject(w http.ResponseWriter, r *http.Request, projectID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	exeDir, _ := paths.ExeDir()
	projectPath, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID)
	if !ok || !dirExists(projectPath) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "پروژه یافت نشد."})
		return
	}
	var data map[string]any
	if err := readJSON(r, &data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	jp := filepath.Join(projectPath, projectID+".json")
	projectsMu.Lock()
	err := writeJSONFile(jp, data)
	projectsMu.Unlock()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func deleteProject(w http.ResponseWriter, r *http.Request, projectID string) {
	exeDir, _ := paths.ExeDir()
	projectPath, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "پروژه پیدا نشد."})
		return
	}
	if err := os.RemoveAll(projectPath); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func renameProject(w http.ResponseWriter, r *http.Request, projectID string) {
	exeDir, _ := paths.ExeDir()
	jp, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID, projectID+".json")
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "پروژه پیدا نشد."})
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "نام جدید نامعتبر است."})
		return
	}
	projectsMu.Lock()
	defer projectsMu.Unlock()
	b, err := os.ReadFile(jp)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "پروژه پیدا نشد."})
		return
	}
	var data map[string]any
	if json.Unmarshal(b, &data) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "corrupt project"})
		return
	}
	data["projectName"] = strings.TrimSpace(body.Name)
	if err := writeJSONFile(jp, data); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func addImages(w http.ResponseWriter, r *http.Request, projectID string) {
	exeDir, _ := paths.ExeDir()
	projectPath, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID)
	if !ok || !dirExists(projectPath) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "پروژه یافت نشد."})
		return
	}
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "تصویری دریافت نشد."})
		return
	}
	imagesPath := filepath.Join(projectPath, "images")
	_ = os.MkdirAll(imagesPath, 0o755)
	type imgInfo struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	ingested := ingestMultipartImages(projectID, imagesPath, r.MultipartForm)
	var saved []imgInfo
	for _, img := range ingested {
		saved = append(saved, imgInfo{Name: img.Name, URL: img.URL})
	}
	if saved == nil {
		saved = []imgInfo{}
	}
	// Optional rename when appending a whole chapter folder/zip
	if pn := strings.TrimSpace(r.FormValue("project_name")); pn != "" {
		jp := filepath.Join(projectPath, projectID+".json")
		projectsMu.Lock()
		if b, err := os.ReadFile(jp); err == nil {
			var data map[string]any
			if json.Unmarshal(b, &data) == nil {
				data["projectName"] = pn
				_ = writeJSONFile(jp, data)
			}
		}
		projectsMu.Unlock()
	}

	// همگام‌سازی imagesMeta در JSON پروژه
	jp := filepath.Join(projectPath, projectID+".json")
	projectsMu.Lock()
	if b, err := os.ReadFile(jp); err == nil {
		var data map[string]any
		if json.Unmarshal(b, &data) == nil {
			existing := map[string]bool{}
			newMeta := make([]any, 0)
			if raw, ok := data["imagesMeta"].([]any); ok {
				for _, item := range raw {
					m, ok := item.(map[string]any)
					if !ok {
						continue
					}
					n, _ := m["name"].(string)
					if n == "" || existing[n] {
						continue
					}
					existing[n] = true
					newMeta = append(newMeta, map[string]any{"name": n})
				}
			}
			for _, img := range saved {
				if img.Name == "" || existing[img.Name] {
					continue
				}
				existing[img.Name] = true
				newMeta = append(newMeta, map[string]any{"name": img.Name})
			}
			data["imagesMeta"] = newMeta
			if err := writeJSONFile(jp, data); err != nil {
				log.Printf("update imagesMeta: %v", err)
			}
		} else {
			log.Printf("unmarshal project json: %v", err)
		}
	} else {
		log.Printf("read project json: %v", err)
	}
	projectsMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "images": saved})
}

func deleteImage(w http.ResponseWriter, r *http.Request, projectID, filename string) {
	exeDir, _ := paths.ExeDir()
	imagesDir, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID, "images")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "مسیر فایل نامعتبر است."})
		return
	}
	fp, ok := paths.SafeJoin(imagesDir, filepath.Base(filename))
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "مسیر فایل نامعتبر است."})
		return
	}
	if err := os.Remove(fp); err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "فایل یافت نشد."})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// حذف از imagesMeta و markings مربوط به این فایل
	baseName := filepath.Base(filename)
	jp, ok2 := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID, projectID+".json")
	if ok2 {
		projectsMu.Lock()
		if b, err := os.ReadFile(jp); err == nil {
			var data map[string]any
			if json.Unmarshal(b, &data) == nil {
				if meta, ok := data["imagesMeta"].([]any); ok {
					filtered := make([]any, 0, len(meta))
					for _, item := range meta {
						m, _ := item.(map[string]any)
						if m == nil {
							continue
						}
						if n, _ := m["name"].(string); n != baseName {
							filtered = append(filtered, item)
						}
					}
					data["imagesMeta"] = filtered
				}
				if marks, ok := data["markings"].([]any); ok {
					filtered := make([]any, 0, len(marks))
					for _, item := range marks {
						m, _ := item.(map[string]any)
						if m == nil {
							continue
						}
						if n, _ := m["imageName"].(string); n != baseName {
							filtered = append(filtered, item)
						}
					}
					data["markings"] = filtered
				}
				_ = writeJSONFile(jp, data)
			}
		}
		projectsMu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func deleteAllImages(w http.ResponseWriter, r *http.Request, projectID string) {
	exeDir, _ := paths.ExeDir()
	projectPath, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "پروژه یافت نشد."})
		return
	}
	imagesPath := filepath.Join(projectPath, "images")
	_ = os.RemoveAll(imagesPath)
	_ = os.MkdirAll(imagesPath, 0o755)
	jp := filepath.Join(projectPath, projectID+".json")
	projectsMu.Lock()
	defer projectsMu.Unlock()
	if b, err := os.ReadFile(jp); err == nil {
		var data map[string]any
		if json.Unmarshal(b, &data) == nil {
			data["imagesMeta"] = []any{}
			data["markings"] = []any{}
			_ = writeJSONFile(jp, data)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func serveProjectImage(w http.ResponseWriter, r *http.Request) {
	// /api/projects/{id}/images/{filename}
	path := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) < 3 || parts[1] != "images" {
		http.NotFound(w, r)
		return
	}
	projectID, filename := parts[0], parts[2]
	exeDir, _ := paths.ExeDir()
	imagesDir, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), projectID, "images")
	if !ok {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, filepath.Join(imagesDir, filepath.Base(filename)))
}

// ── Tools ───────────────────────────────────────────────────────────

func apiMagicWand(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID       string  `json:"project_id"`
		ImageName       string  `json:"image_name"`
		X               int     `json:"x"`
		Y               int     `json:"y"`
		Tolerance       float64 `json:"tolerance"`
		Blur            float64 `json:"blur"`
		EdgeSensitivity float64 `json:"edge_sensitivity"`
		SmartMode       bool    `json:"smart_mode"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	exeDir, _ := paths.ExeDir()
	imgPath, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), req.ProjectID, "images", filepath.Base(req.ImageName))
	if !ok || !fileExists(imgPath) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "تصویر یافت نشد."})
		return
	}
	pts, err := tools.MagicWand(imgPath, req.X, req.Y, req.Tolerance, req.Blur, req.EdgeSensitivity, req.SmartMode)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if pts == nil {
		pts = []tools.Point{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": pts})
}

func apiProcessMarking(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string         `json:"project_id"`
		ImageName string         `json:"image_name"`
		Mark      map[string]any `json:"mark"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	exeDir, _ := paths.ExeDir()
	imgPath, ok := paths.SafeJoin(paths.ProjectsDir(exeDir), req.ProjectID, "images", filepath.Base(req.ImageName))
	if !ok || !fileExists(imgPath) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "تصویر یافت نشد."})
		return
	}
	result, err := tools.ProcessMarking(imgPath, req.Mark)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// ── Export ──────────────────────────────────────────────────────────

func saveExport(w http.ResponseWriter, r *http.Request) {
	exeDir, _ := paths.ExeDir()
	cfg := config.Load(exeDir)
	exportDir, _ := cfg["exportPath"].(string)
	exportDir = strings.TrimSpace(exportDir)
	if exportDir == "" {
		exportDir = paths.ExportsDir(exeDir)
	}
	_ = os.MkdirAll(exportDir, 0o755)

	if err := r.ParseMultipartForm(256 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "فایل صادر شده دریافت نشد."})
		return
	}

	// Multi-file ZIP-like bundle: save each file; if multiple, pack as sequential files
	// (Full 7z is Windows-only in original; here we save individual or a simple zip via stdlib)
	if files := r.MultipartForm.File["files"]; len(files) > 0 {
		filename := r.FormValue("filename")
		if filename == "" {
			filename = "manga_project.zip"
		}
		resolved := uniqueName(exportDir, filename)
		fullPath := filepath.Join(exportDir, resolved)

		// Create a zip archive
		if err := tools.WriteZipFromUploads(fullPath, files); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":     "success",
			"saved_path": fullPath,
			"filename":   resolved,
		})
		return
	}

	if files := r.MultipartForm.File["file"]; len(files) > 0 {
		fh := files[0]
		filename := r.FormValue("filename")
		if filename == "" {
			filename = fh.Filename
		}
		resolved := uniqueName(exportDir, filename)
		fullPath := filepath.Join(exportDir, resolved)
		src, err := fh.Open()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer src.Close()
		dst, err := os.Create(fullPath)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		_, err = io.Copy(dst, src)
		dst.Close()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":     "success",
			"saved_path": fullPath,
			"filename":   resolved,
		})
		return
	}

	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "فایل صادر شده دریافت نشد."})
}

// ── Fonts ───────────────────────────────────────────────────────────

func fontRouter(w http.ResponseWriter, r *http.Request) {
	// /api/font/{slot}
	rest := strings.TrimPrefix(r.URL.Path, "/api/font/")
	if rest == "" || strings.Contains(rest, "/") {
		http.NotFound(w, r)
		return
	}
	slot, err := strconv.Atoi(rest)
	if err != nil || slot < 0 || slot > 5 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slot نامعتبر"})
		return
	}
	exeDir, _ := paths.ExeDir()
	switch r.Method {
	case http.MethodPost:
		uploadFont(w, r, exeDir, slot)
	case http.MethodDelete:
		deleteFont(w, r, exeDir, slot)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func uploadFont(w http.ResponseWriter, r *http.Request, exeDir string, slot int) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "فایل یافت نشد"})
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "فایل یافت نشد"})
		return
	}
	fh := files[0]
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	allowed := map[string]bool{".ttf": true, ".otf": true, ".woff": true, ".woff2": true}
	if !allowed[ext] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "فرمت غیرمجاز"})
		return
	}
	fontsDir := paths.FontsDir(exeDir)
	// remove old slot files
	entries, _ := os.ReadDir(fontsDir)
	prefix := fmt.Sprintf("font_%d.", slot)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			_ = os.Remove(filepath.Join(fontsDir, e.Name()))
		}
	}
	fontFilename := fmt.Sprintf("font_%d%s", slot, ext)
	src, err := fh.Open()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer src.Close()
	dst, err := os.Create(filepath.Join(fontsDir, fontFilename))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	_, _ = io.Copy(dst, src)
	dst.Close()

	cfg := config.Load(exeDir)
	fonts, _ := cfg["fonts"].(map[string]any)
	if fonts == nil {
		fonts = map[string]any{}
	}
	fonts[strconv.Itoa(slot)] = map[string]any{
		"original_name": fh.Filename,
		"filename":      fontFilename,
	}
	cfg["fonts"] = fonts
	_ = config.SaveDirect(exeDir, cfg)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":        "success",
		"url":           "/api/font/file/" + fontFilename,
		"original_name": fh.Filename,
	})
}

func deleteFont(w http.ResponseWriter, r *http.Request, exeDir string, slot int) {
	cfg := config.Load(exeDir)
	fonts, _ := cfg["fonts"].(map[string]any)
	if fonts != nil {
		key := strconv.Itoa(slot)
		if info, ok := fonts[key].(map[string]any); ok {
			if fn, _ := info["filename"].(string); fn != "" {
				_ = os.Remove(filepath.Join(paths.FontsDir(exeDir), fn))
			}
			delete(fonts, key)
			cfg["fonts"] = fonts
			_ = config.SaveDirect(exeDir, cfg)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func serveFontFile(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/font/file/")
	name = filepath.Base(name)
	exeDir, _ := paths.ExeDir()
	http.ServeFile(w, r, filepath.Join(paths.FontsDir(exeDir), name))
}

// ── helpers ─────────────────────────────────────────────────────────

func writeJSONFile(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "    ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func uniqueName(dir, filename string) string {
	base := filename
	ext := filepath.Ext(filename)
	name := strings.TrimSuffix(filename, ext)
	full := filepath.Join(dir, base)
	for i := 1; fileExists(full); i++ {
		base = fmt.Sprintf("%s_%d%s", name, i, ext)
		full = filepath.Join(dir, base)
	}
	return base
}

var digitRun = regexp.MustCompile(`(\d+|\D+)`)

func naturalLess(a, b string) bool {
	pa := digitRun.FindAllString(a, -1)
	pb := digitRun.FindAllString(b, -1)
	n := len(pa)
	if len(pb) < n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		da, ea := strconv.Atoi(pa[i])
		db, eb := strconv.Atoi(pb[i])
		if ea == nil && eb == nil {
			if da != db {
				return da < db
			}
			continue
		}
		if strings.ToLower(pa[i]) != strings.ToLower(pb[i]) {
			return strings.ToLower(pa[i]) < strings.ToLower(pb[i])
		}
	}
	return len(pa) < len(pb)
}

// silence unused import if any
var _ = time.Now
