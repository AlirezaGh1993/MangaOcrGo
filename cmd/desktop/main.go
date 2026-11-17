//go:build windows

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const serverURL = "http://127.0.0.1:6465"

func main() {
	exeDir := resolveExeDir()
	serverProc := ensureServer(exeDir)
	if serverProc != nil {
		defer func() { _ = serverProc.Process.Kill() }()
	}
	if !waitServer(25 * time.Second) {
		fatal("سرور روی پورت 6465 بالا نیامد.")
	}

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(exeDir, "data", "webview2"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Manga OCR / Translator",
			Width:  1280,
			Height: 800,
			Center: true,
		},
	})
	if w == nil {
		fatal("WebView2 ساخته نشد. WebView2 Runtime را نصب کنید:\nhttps://developer.microsoft.com/microsoft-edge/webview2/")
	}
	defer w.Destroy()

	// Remove Windows default caption → single custom titlebar
	makeFrameless(w.Window())

	// Desktop mode flag only — do NOT capture/stop all drag events (breaks tools).
	// File-drop handling is done in page JS (desktop_bridge + project_images_engine).
	w.Init(`
window.mangaDesktop = { available: true, platform: 'windows-webview2' };
try { document.documentElement.classList.add('desktop-app'); } catch (e) {}
(function(){
  function hasFiles(e){
    try {
      if (!e || !e.dataTransfer) return false;
      if (e.dataTransfer.files && e.dataTransfer.files.length) return true;
      if (e.dataTransfer.types) {
        for (var i=0;i<e.dataTransfer.types.length;i++){
          if (String(e.dataTransfer.types[i]).toLowerCase()==='files') return true;
        }
      }
    } catch (err) {}
    return false;
  }
  // Only cancel browser default for FILE drags (prevent navigation/download).
  // Never stopPropagation — page handlers must still receive the event.
  window.addEventListener('dragover', function(e){
    if (hasFiles(e)) e.preventDefault();
  }, false);
  window.addEventListener('drop', function(e){
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (typeof window.__desktopForwardDrop === 'function') {
      try { window.__desktopForwardDrop(e); } catch(err){ console.error(err); }
    }
  }, false);
})();
`)

	bindDesktop(w, exeDir)

	w.SetSize(1280, 800, webview2.HintNone)
	w.Navigate(serverURL + "/?desktop=1")
	w.Run()
}

func bindDesktop(w webview2.WebView, exeDir string) {
	_ = w.Bind("desktopPickFolder", func() (map[string]any, error) {
		path, err := pickFolderDialog(loadLastPath(exeDir))
		if err != nil || path == "" {
			return map[string]any{"ok": false, "error": "انصراف از انتخاب پوشه"}, nil
		}
		saveLastPath(exeDir, path)
		name := filepath.Base(path)
		result, err := postJSON(serverURL+"/api/project/from-local-path", map[string]string{"path": path, "name": name})
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		result["ok"] = true
		return result, nil
	})

	_ = w.Bind("desktopPickZip", func() (map[string]any, error) {
		path, err := pickFileDialog(loadLastPath(exeDir), "ZIP chapter|*.zip")
		if err != nil || path == "" {
			return map[string]any{"ok": false, "error": "انصراف از انتخاب ZIP"}, nil
		}
		saveLastPath(exeDir, filepath.Dir(path))
		result, err := uploadFilesAsNewProject(path, strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		result["ok"] = true
		return result, nil
	})

	_ = w.Bind("desktopPickImages", func() (map[string]any, error) {
		paths, err := pickMultiFilesDialog(loadLastPath(exeDir), "Images|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.bmp")
		if err != nil || len(paths) == 0 {
			return map[string]any{"ok": false, "error": "انصراف از انتخاب تصویر"}, nil
		}
		saveLastPath(exeDir, filepath.Dir(paths[0]))
		result, err := uploadManyFiles(paths, "")
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}, nil
		}
		result["ok"] = true
		return result, nil
	})

	_ = w.Bind("desktopRefresh", func() { w.Eval(`location.reload()`) })
	_ = w.Bind("desktopFullscreen", func() {
		w.Eval(`(function(){if(!document.fullscreenElement){document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();}else{document.exitFullscreen&&document.exitFullscreen();}})()`)
	})
	_ = w.Bind("desktopMinimize", func() {
		hwnd := w.Window()
		if hwnd == nil {
			return
		}
		// SW_MINIMIZE = 6 — must keep WS_MINIMIZEBOX in window style
		showWindow(hwnd, 6)
	})
	_ = w.Bind("desktopMaximize", func() {
		hwnd := w.Window()
		if hwnd == nil {
			return
		}
		// Toggle maximize / restore (NOT exclusive fullscreen)
		if isZoomed(hwnd) {
			showWindow(hwnd, 9) // SW_RESTORE
		} else {
			showWindow(hwnd, 3) // SW_MAXIMIZE
		}
	})
	_ = w.Bind("desktopClose", func() { w.Terminate() })
}

func resolveExeDir() string {
	exeDir, err := os.Executable()
	if err != nil {
		exeDir, _ = os.Getwd()
	} else {
		exeDir = filepath.Dir(exeDir)
	}
	if _, err := os.Stat(filepath.Join(exeDir, "static")); err != nil {
		if wd, e := os.Getwd(); e == nil {
			if _, e2 := os.Stat(filepath.Join(wd, "static")); e2 == nil {
				return wd
			}
		}
	}
	return exeDir
}

func lastPathFile(exeDir string) string {
	return filepath.Join(exeDir, "data", "last_import_path.txt")
}

func loadLastPath(exeDir string) string {
	b, err := os.ReadFile(lastPathFile(exeDir))
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(string(b))
	if st, err := os.Stat(p); err == nil && st.IsDir() {
		return p
	}
	// if it was a file path, use dir
	d := filepath.Dir(p)
	if st, err := os.Stat(d); err == nil && st.IsDir() {
		return d
	}
	return ""
}

func saveLastPath(exeDir string, p string) {
	_ = os.MkdirAll(filepath.Join(exeDir, "data"), 0o755)
	_ = os.WriteFile(lastPathFile(exeDir), []byte(p), 0o644)
}

// Vista-style folder picker (looks like file dialog)
func pickFolderDialog(initialDir string) (string, error) {
	init := escapePS(initialDir)
	ps := fmt.Sprintf(`
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'پوشه فصل مانگا را انتخاب کنید'
$d.ShowNewFolderButton = $false
$d.AutoUpgradeEnabled = $true
$init = '%s'
if ($init -and (Test-Path -LiteralPath $init)) { $d.SelectedPath = $init }
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
$top.ShowInTaskbar = $false
$top.WindowState = 'Minimized'
$top.Show()
$top.Hide()
if ($d.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
$top.Close()
`, init)
	return runPS(ps)
}

func pickFileDialog(initialDir, filter string) (string, error) {
	init := escapePS(initialDir)
	filt := escapePS(filter)
	ps := fmt.Sprintf(`
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'انتخاب فایل'
$d.Filter = '%s'
$d.Multiselect = $false
$d.CheckFileExists = $true
$init = '%s'
if ($init -and (Test-Path -LiteralPath $init)) { $d.InitialDirectory = $init }
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true; $top.ShowInTaskbar = $false; $top.WindowState = 'Minimized'; $top.Show(); $top.Hide()
if ($d.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
$top.Close()
`, filt, init)
	return runPS(ps)
}

func pickMultiFilesDialog(initialDir, filter string) ([]string, error) {
	init := escapePS(initialDir)
	filt := escapePS(filter)
	ps := fmt.Sprintf(`
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'انتخاب تصاویر'
$d.Filter = '%s'
$d.Multiselect = $true
$d.CheckFileExists = $true
$init = '%s'
if ($init -and (Test-Path -LiteralPath $init)) { $d.InitialDirectory = $init }
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true; $top.ShowInTaskbar = $false; $top.WindowState = 'Minimized'; $top.Show(); $top.Hide()
if ($d.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames | ForEach-Object { Write-Output $_ } }
$top.Close()
`, filt, init)
	out, err := runPS(ps)
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			paths = append(paths, line)
		}
	}
	return paths, nil
}

func escapePS(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func runPS(script string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func uploadFilesAsNewProject(firstPath, projectName string, more ...string) (map[string]any, error) {
	paths := append([]string{firstPath}, more...)
	// dedupe first if more includes it
	seen := map[string]bool{}
	var clean []string
	for _, p := range paths {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		clean = append(clean, p)
	}
	return uploadManyFiles(clean, projectName)
}

func uploadManyFiles(paths []string, projectName string) (map[string]any, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if projectName != "" {
		_ = mw.WriteField("project_name", projectName)
	} else if len(paths) == 1 && strings.EqualFold(filepath.Ext(paths[0]), ".zip") {
		_ = mw.WriteField("project_name", strings.TrimSuffix(filepath.Base(paths[0]), filepath.Ext(paths[0])))
	}
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		part, err := mw.CreateFormFile("files", filepath.Base(p))
		if err != nil {
			f.Close()
			continue
		}
		_, _ = io.Copy(part, f)
		f.Close()
	}
	_ = mw.Close()
	resp, err := http.Post(serverURL+"/api/project/new", mw.FormDataContentType(), &buf)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("%s", string(data))
	}
	if resp.StatusCode >= 300 {
		if e, ok := m["error"].(string); ok {
			return nil, fmt.Errorf("%s", e)
		}
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return m, nil
}

func makeFrameless(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	const (
		wsCaption       = 0x00C00000
		wsBorder        = 0x00800000
		wsDlgFrame      = 0x00400000
		wsThickFrame    = 0x00040000
		wsMinimizeBox   = 0x00020000
		wsMaximizeBox   = 0x00010000
		wsSysmenu       = 0x00080000
		wsVisible       = 0x10000000
		wsClipSiblings  = 0x04000000
		wsClipChildren  = 0x02000000
		swpFrameChanged = 0x0020
		swpNoMove       = 0x0002
		swpNoSize       = 0x0001
		swpNoZOrder     = 0x0004
	)
	gwlStyle := int32(-16)
	gwlStyleArg := uintptr(uint32(gwlStyle))

	user32 := windows.NewLazySystemDLL("user32.dll")
	getLong := user32.NewProc("GetWindowLongW")
	setLong := user32.NewProc("SetWindowLongW")
	setPos := user32.NewProc("SetWindowPos")

	h := uintptr(hwnd)
	style, _, _ := getLong.Call(h, gwlStyleArg)
	// Remove only the system title-bar caption; KEEP thickframe + min/max boxes
	// so SW_MINIMIZE / SW_MAXIMIZE work correctly (not exclusive fullscreen).
	style = style &^ wsCaption
	style = style | wsThickFrame | wsMinimizeBox | wsMaximizeBox | wsSysmenu
	setLong.Call(h, gwlStyleArg, style)
	setPos.Call(h, 0, 0, 0, 0, 0, swpFrameChanged|swpNoMove|swpNoSize|swpNoZOrder)
}

func showWindow(hwnd unsafe.Pointer, cmd int32) {
	if hwnd == nil {
		return
	}
	user32 := windows.NewLazySystemDLL("user32.dll")
	proc := user32.NewProc("ShowWindow")
	_, _, _ = proc.Call(uintptr(hwnd), uintptr(uint32(cmd)))
}

func isZoomed(hwnd unsafe.Pointer) bool {
	if hwnd == nil {
		return false
	}
	user32 := windows.NewLazySystemDLL("user32.dll")
	proc := user32.NewProc("IsZoomed")
	r, _, _ := proc.Call(uintptr(hwnd))
	return r != 0
}

func ensureServer(exeDir string) *exec.Cmd {
	if ping() {
		return nil
	}
	bin := filepath.Join(exeDir, "mangaserver.exe")
	if _, err := os.Stat(bin); err != nil {
		bin = filepath.Join(exeDir, "mangaserver")
	}
	var cmd *exec.Cmd
	if _, err := os.Stat(bin); err == nil {
		cmd = exec.Command(bin)
	} else {
		cmd = exec.Command("go", "run", ".")
	}
	cmd.Dir = exeDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fatal("اجرای سرور: " + err.Error())
	}
	return cmd
}

func waitServer(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ping() {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	return false
}

func ping() bool {
	c := &http.Client{Timeout: 400 * time.Millisecond}
	resp, err := c.Get(serverURL + "/api/config")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func postJSON(url string, body any) (map[string]any, error) {
	b, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("%s", string(data))
	}
	if resp.StatusCode >= 300 {
		if e, ok := m["error"].(string); ok {
			return nil, fmt.Errorf("%s", e)
		}
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return m, nil
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, "[ERROR]", msg)
	if runtime.GOOS == "windows" {
		_ = exec.Command("powershell", "-Command",
			"Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('"+strings.ReplaceAll(msg, "'", "''")+"','Manga Desktop')").Run()
	}
	os.Exit(1)
}
