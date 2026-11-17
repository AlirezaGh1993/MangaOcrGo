package main

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

const (
	serverURL = "http://127.0.0.1:6465"
	port      = "6465"
)

func main() {
	exeDir, err := os.Getwd()
	if err != nil {
		fatal(err)
	}
	// Prefer binary next to launcher, else `go run` from module root
	serverBin := filepath.Join(exeDir, "mangaserver")
	if runtime.GOOS == "windows" {
		serverBin += ".exe"
	}
	moduleRoot := exeDir
	// If launched from cmd/launcher, go up two levels
	if filepath.Base(exeDir) == "launcher" {
		moduleRoot = filepath.Clean(filepath.Join(exeDir, "..", ".."))
		serverBin = filepath.Join(moduleRoot, "mangaserver")
		if runtime.GOOS == "windows" {
			serverBin += ".exe"
		}
	}

	fmt.Println("══════════════════════════════════════════")
	fmt.Println("  Manga Server Launcher (Go)")
	fmt.Println("══════════════════════════════════════════")
	fmt.Println("  URL:", serverURL)
	fmt.Println("  Dir:", moduleRoot)
	fmt.Println("══════════════════════════════════════════")

	cmd, logFile, err := startServer(moduleRoot, serverBin)
	if err != nil {
		fatal(err)
	}
	defer func() {
		if logFile != nil {
			logFile.Close()
		}
	}()

	// Wait until HTTP is ready
	fmt.Print("[...] Waiting for server")
	ready := false
	for i := 0; i < 40; i++ {
		if ping() {
			ready = true
			break
		}
		fmt.Print(".")
		time.Sleep(250 * time.Millisecond)
	}
	fmt.Println()
	if !ready {
		_ = cmd.Process.Kill()
		fatal(fmt.Errorf("server did not start on port %s", port))
	}
	fmt.Println("[OK] Server is online")

	openBrowser(serverURL)

	// Handle Ctrl+C
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)

	fmt.Println()
	fmt.Println("Commands:  [b] open browser  [l] show log tail  [q] quit")
	fmt.Print("> ")

	inputDone := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(os.Stdin)
		for sc.Scan() {
			line := sc.Text()
			switch line {
			case "q", "Q", "quit", "exit":
				close(inputDone)
				return
			case "b", "B":
				openBrowser(serverURL)
				fmt.Print("> ")
			case "l", "L":
				printLogTail(filepath.Join(moduleRoot, "server.log"), 30)
				fmt.Print("> ")
			default:
				fmt.Print("> ")
			}
		}
		close(inputDone)
	}()

	select {
	case <-sig:
		fmt.Println("\n[stop] signal received")
	case <-inputDone:
		fmt.Println("[stop] quit")
	}

	fmt.Println("[...] Shutting down server...")
	stopServer(cmd)
	fmt.Println("[OK] Bye")
}

func startServer(moduleRoot, serverBin string) (*exec.Cmd, *os.File, error) {
	logPath := filepath.Join(moduleRoot, "server.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, nil, err
	}

	var cmd *exec.Cmd
	if st, err := os.Stat(serverBin); err == nil && !st.IsDir() {
		cmd = exec.Command(serverBin)
	} else {
		cmd = exec.Command("go", "run", ".")
	}
	cmd.Dir = moduleRoot
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, nil, err
	}
	fmt.Println("[OK] Server process pid =", cmd.Process.Pid)
	return cmd, logFile, nil
}

func stopServer(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		<-done
	}
}

func ping() bool {
	client := &http.Client{Timeout: 400 * time.Millisecond}
	resp, err := client.Get(serverURL + "/api/config")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		fmt.Println("[!] Could not open browser:", err)
		fmt.Println("    Open manually:", url)
		return
	}
	fmt.Println("[OK] Browser opened")
}

func printLogTail(path string, n int) {
	f, err := os.Open(path)
	if err != nil {
		fmt.Println(err)
		return
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}
	fmt.Println("--- log tail ---")
	for _, l := range lines {
		fmt.Println(l)
	}
	fmt.Println("----------------")
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "[ERROR]", err)
	os.Exit(1)
}

// silence unused in some builds
var _ = io.Discard
