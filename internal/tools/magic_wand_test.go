package tools

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writeTestPNG(path string, w, h int, fill func(x, y int) color.RGBA) error {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, fill(x, y))
		}
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

func TestMagicWandWhiteBubble(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bubble.png")
	// gray background, white circle-ish square bubble in center
	err := writeTestPNG(path, 100, 100, func(x, y int) color.RGBA {
		if x >= 30 && x < 70 && y >= 30 && y < 70 {
			return color.RGBA{255, 255, 255, 255}
		}
		return color.RGBA{40, 40, 40, 255}
	})
	if err != nil {
		t.Fatal(err)
	}

	pts, err := MagicWand(path, 50, 50, 30, 0, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) < 3 {
		t.Fatalf("expected polygon >=3 points, got %d", len(pts))
	}
	// bounding box of polygon should roughly cover the white square
	minX, minY, maxX, maxY := pts[0].X, pts[0].Y, pts[0].X, pts[0].Y
	for _, p := range pts {
		if p.X < minX {
			minX = p.X
		}
		if p.Y < minY {
			minY = p.Y
		}
		if p.X > maxX {
			maxX = p.X
		}
		if p.Y > maxY {
			maxY = p.Y
		}
	}
	if maxX-minX < 20 || maxY-minY < 20 {
		t.Fatalf("polygon too small: %v..%v", pts[0], pts)
	}
	t.Logf("points=%d bbox=(%d,%d)-(%d,%d)", len(pts), minX, minY, maxX, maxY)
}

func TestMagicWandOutOfBounds(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.png")
	_ = writeTestPNG(path, 10, 10, func(x, y int) color.RGBA { return color.RGBA{0, 0, 0, 255} })
	_, err := MagicWand(path, 99, 99, 10, 0, 20, false)
	if err == nil {
		t.Fatal("expected out-of-bounds error")
	}
}

func TestMagicWandWithBlur(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "b.png")
	err := writeTestPNG(path, 80, 80, func(x, y int) color.RGBA {
		if x >= 20 && x < 60 && y >= 20 && y < 60 {
			return color.RGBA{250, 250, 250, 255}
		}
		return color.RGBA{10, 10, 10, 255}
	})
	if err != nil {
		t.Fatal(err)
	}
	pts, err := MagicWand(path, 40, 40, 40, 1.5, 20, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) < 3 {
		t.Fatalf("got %d points", len(pts))
	}
	t.Logf("blur+smart points=%d", len(pts))
}

func TestProcessMarkingRect(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "r.png")
	_ = writeTestPNG(path, 50, 50, func(x, y int) color.RGBA {
		return color.RGBA{200, 200, 200, 255}
	})
	mark := map[string]any{
		"type": "rectangle",
		"x":    5.0, "y": 5.0, "width": 40.0, "height": 40.0,
	}
	res, err := ProcessMarking(path, mark)
	if err != nil {
		t.Fatal(err)
	}
	if res["backgroundColor"] == nil || res["textColor"] == nil {
		t.Fatalf("missing colors: %+v", res)
	}
	t.Logf("bg=%v text=%v safe=%v", res["backgroundColor"], res["textColor"], res["safeBounds"])
}

func TestRDP(t *testing.T) {
	pts := []Point{{0, 0}, {1, 0}, {2, 0}, {3, 0}, {4, 0}}
	out := rdp(pts, 0.5)
	if len(out) != 2 {
		t.Fatalf("expected 2 endpoints, got %d %v", len(out), out)
	}
}

func TestMagicWandInsetKeepsInside(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "inset.png")
	// white 40x40 centered in 100x100
	err := writeTestPNG(path, 100, 100, func(x, y int) color.RGBA {
		if x >= 30 && x < 70 && y >= 30 && y < 70 {
			return color.RGBA{255, 255, 255, 255}
		}
		return color.RGBA{0, 0, 0, 255}
	})
	if err != nil {
		t.Fatal(err)
	}
	pts, err := MagicWand(path, 50, 50, 20, 0, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range pts {
		// vertices must stay inside white square (30..70 exclusive of outer black)
		if p.X < 30 || p.X >= 70 || p.Y < 30 || p.Y >= 70 {
			t.Fatalf("vertex outside white body: %+v", p)
		}
	}
	t.Logf("all %d vertices inset OK", len(pts))
}

func TestMagicWandIgnoresSpike(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "spike.png")
	// oval body + triangular speech-bubble tail pointing down (like real manga)
	err := writeTestPNG(path, 120, 120, func(x, y int) color.RGBA {
		dx := float64(x-60) / 40
		dy := float64(y-50) / 32
		if dx*dx+dy*dy <= 1 {
			return color.RGBA{255, 255, 255, 255}
		}
		// triangle tail under the oval (base ~20px, tip at y=100)
		if y >= 75 && y <= 100 {
			t := float64(y-75) / 25.0 // 0 at base → 1 at tip
			half := 10.0 * (1.0 - t)
			if float64(x) >= 60-half && float64(x) <= 60+half {
				return color.RGBA{255, 255, 255, 255}
			}
		}
		return color.RGBA{30, 30, 30, 255}
	})
	if err != nil {
		t.Fatal(err)
	}
	pts, err := MagicWand(path, 60, 50, 25, 0, 15, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) < 3 {
		t.Fatalf("too few points: %d", len(pts))
	}
	maxY := pts[0].Y
	for _, p := range pts {
		if p.Y > maxY {
			maxY = p.Y
		}
	}
	// tail tip is at y≈100; body ends ~y=82. Polygon must not reach the tip.
	if maxY > 90 {
		t.Fatalf("polygon still includes bubble tail: maxY=%d points=%v", maxY, pts)
	}
	t.Logf("tail stripped, maxY=%d n=%d", maxY, len(pts))
}

func TestMagicWandFillsTextHoles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "textbubble.png")
	// white oval with horizontal black text bars (simulates letters)
	err := writeTestPNG(path, 120, 100, func(x, y int) color.RGBA {
		dx := float64(x-60) / 45
		dy := float64(y-50) / 35
		if dx*dx+dy*dy > 1 {
			return color.RGBA{20, 20, 20, 255}
		}
		// three black text lines inside
		if (y >= 35 && y <= 42) || (y >= 48 && y <= 55) || (y >= 61 && y <= 68) {
			if x >= 30 && x <= 90 {
				return color.RGBA{0, 0, 0, 255}
			}
		}
		return color.RGBA{255, 255, 255, 255}
	})
	if err != nil {
		t.Fatal(err)
	}
	// click on white (not on text)
	pts, err := MagicWand(path, 60, 28, 30, 0, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) < 3 {
		t.Fatalf("expected solid bubble polygon, got %d pts", len(pts))
	}
	// bounding box should cover most of the oval, not collapse to a cross
	minX, minY := pts[0].X, pts[0].Y
	maxX, maxY := minX, minY
	for _, p := range pts {
		if p.X < minX {
			minX = p.X
		}
		if p.Y < minY {
			minY = p.Y
		}
		if p.X > maxX {
			maxX = p.X
		}
		if p.Y > maxY {
			maxY = p.Y
		}
	}
	bw, bh := maxX-minX, maxY-minY
	if bw < 50 || bh < 40 {
		t.Fatalf("polygon collapsed around text (cross-like): bbox=%dx%d pts=%v", bw, bh, pts)
	}
	t.Logf("text holes filled, bbox=%dx%d n=%d", bw, bh, len(pts))
}

func TestDominantColorPureWhite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "white.png")
	err := writeTestPNG(path, 40, 40, func(x, y int) color.RGBA {
		// mostly pure white with a few black "text" pixels
		if y >= 18 && y <= 22 && x >= 10 && x <= 30 {
			return color.RGBA{0, 0, 0, 255}
		}
		return color.RGBA{255, 255, 255, 255}
	})
	if err != nil {
		t.Fatal(err)
	}
	mark := map[string]any{
		"type": "rectangle",
		"x": 0.0, "y": 0.0, "width": 40.0, "height": 40.0,
	}
	res, err := ProcessMarking(path, mark)
	if err != nil {
		t.Fatal(err)
	}
	bg, _ := res["backgroundColor"].(string)
	if bg != "#FFFFFF" && bg != "#ffffff" {
		// allow tiny deviation only if still pure-looking
		t.Fatalf("expected pure white background, got %q", bg)
	}
	t.Logf("bg=%s text=%v", bg, res["textColor"])
}
