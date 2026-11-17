//go:build !windows

package main

import "fmt"

func main() {
	fmt.Println("Manga Desktop WebView فقط روی ویندوز پشتیبانی می‌شود.")
	fmt.Println("روی ویندوز: go build -o manga-desktop.exe ./cmd/desktop")
}
