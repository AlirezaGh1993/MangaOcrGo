package tools

import (
	"archive/zip"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/image/bmp"
	"golang.org/x/image/webp"
)

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type Bounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}


// ── Image cache (mtime-based, max 5) ────────────────────────────────

type cachedImg struct {
	mtime int64
	img   image.Image
	pix   []color.RGBA // flattened w*h for fast flood fill
	w, h  int
}

var (
	imgCacheMu sync.Mutex
	imgCache   = map[string]cachedImg{}
)

func getCached(imagePath string) (cachedImg, error) {
	st, err := os.Stat(imagePath)
	if err != nil {
		return cachedImg{}, err
	}
	mtime := st.ModTime().UnixNano()

	imgCacheMu.Lock()
	defer imgCacheMu.Unlock()
	if c, ok := imgCache[imagePath]; ok && c.mtime == mtime {
		return c, nil
	}

	img, err := loadImage(imagePath)
	if err != nil {
		return cachedImg{}, err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	pix := make([]color.RGBA, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			pix[y*w+x] = rgbaAt(img, b.Min.X+x, b.Min.Y+y)
		}
	}
	c := cachedImg{mtime: mtime, img: img, pix: pix, w: w, h: h}
	imgCache[imagePath] = c
	// LRU-ish: drop arbitrary oldest when >5
	if len(imgCache) > 5 {
		for k := range imgCache {
			if k != imagePath {
				delete(imgCache, k)
				break
			}
		}
	}
	return c, nil
}

// loadImage opens and decodes common formats (JPEG/PNG/GIF/WebP/BMP).
func loadImage(imagePath string) (image.Image, error) {
	f, err := os.Open(imagePath)
	if err != nil {
		return nil, fmt.Errorf("باز کردن فایل تصویر: %w", err)
	}
	defer f.Close()

	img, format, err := image.Decode(f)
	if err == nil {
		_ = format
		return img, nil
	}

	if _, err2 := f.Seek(0, io.SeekStart); err2 != nil {
		return nil, fmt.Errorf("فرمت تصویر پشتیبانی نمی‌شود (%s): %v", filepath.Base(imagePath), err)
	}
	ext := strings.ToLower(filepath.Ext(imagePath))
	switch ext {
	case ".jpg", ".jpeg":
		img, err = jpeg.Decode(f)
	case ".png":
		img, err = png.Decode(f)
	case ".gif":
		img, err = gif.Decode(f)
	case ".webp":
		img, err = webp.Decode(f)
	case ".bmp":
		img, err = bmp.Decode(f)
	default:
		decoders := []func(io.Reader) (image.Image, error){
			jpeg.Decode, png.Decode, gif.Decode, webp.Decode, bmp.Decode,
		}
		var last error
		for _, dec := range decoders {
			if _, e := f.Seek(0, io.SeekStart); e != nil {
				break
			}
			img, last = dec(f)
			if last == nil {
				return img, nil
			}
		}
		return nil, fmt.Errorf("فرمت تصویر ناشناخته یا آسیب‌دیده (%s). فرمت‌های مجاز: JPG, PNG, GIF, WebP, BMP — %v", filepath.Base(imagePath), err)
	}
	if err != nil {
		return nil, fmt.Errorf("خطا در خواندن تصویر %s: %w", filepath.Base(imagePath), err)
	}
	return img, nil
}

// boxBlurRGBA applies a simple separable box blur (approx Gaussian) on flat RGBA.
// radius 0 = no-op. Returns a new slice.
func boxBlurRGBA(src []color.RGBA, w, h int, radius float64) []color.RGBA {
	if radius < 0.5 || w < 1 || h < 1 {
		out := make([]color.RGBA, len(src))
		copy(out, src)
		return out
	}
	r := int(math.Round(radius))
	if r < 1 {
		r = 1
	}
	if r > 20 {
		r = 20
	}
	// horizontal pass
	tmp := make([]color.RGBA, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var rs, gs, bs, n int
			for dx := -r; dx <= r; dx++ {
				xx := x + dx
				if xx < 0 {
					xx = 0
				}
				if xx >= w {
					xx = w - 1
				}
				c := src[y*w+xx]
				rs += int(c.R)
				gs += int(c.G)
				bs += int(c.B)
				n++
			}
			tmp[y*w+x] = color.RGBA{uint8(rs / n), uint8(gs / n), uint8(bs / n), 255}
		}
	}
	// vertical pass
	out := make([]color.RGBA, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var rs, gs, bs, n int
			for dy := -r; dy <= r; dy++ {
				yy := y + dy
				if yy < 0 {
					yy = 0
				}
				if yy >= h {
					yy = h - 1
				}
				c := tmp[yy*w+x]
				rs += int(c.R)
				gs += int(c.G)
				bs += int(c.B)
				n++
			}
			out[y*w+x] = color.RGBA{uint8(rs / n), uint8(gs / n), uint8(bs / n), 255}
		}
	}
	return out
}

// MagicWand — port of magic_wand_tool.py with mild border-clearance.
//
// Matches Python pipeline:
//   1. optional blur → seed flood-fill
//   2. optional smart hole-fill
//   3. light morphological opening (kill 1px sunburst rays only)
//   4. mild inward erode (1–3 px) so stroke does not sit on black outline
//   5. Moore-neighbor outer contour
//   6. RDP simplify (ε ≈ 1.5–2.5) — same spirit as Python rdp(..., 1.5)
//
// Intentionally NO ellipse-fit / aggressive polar shrink (those produced
// star-shaped / undersized polygons on real manga bubbles).
func MagicWand(imagePath string, startX, startY int, tolerance, blur, edgeSensitivity float64, smartMode bool) ([]Point, error) {
	c, err := getCached(imagePath)
	if err != nil {
		return nil, err
	}
	w, h := c.w, c.h
	if startX < 0 || startY < 0 || startX >= w || startY >= h {
		return nil, fmt.Errorf("نقطه شروع خارج از تصویر است")
	}

	pix := c.pix
	if blur >= 0.5 {
		pix = boxBlurRGBA(c.pix, w, h, blur)
	}

	seed := pix[startY*w+startX]
	tol := int(tolerance)
	if tol < 0 {
		tol = 0
	}

	// 1) Flood fill (4-connected, same as typical wand)
	visited := make([]bool, w*h)
	mask := make([]uint8, w*h)
	queue := make([]int, 0, 4096)
	startIdx := startY*w + startX
	queue = append(queue, startIdx)
	visited[startIdx] = true
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		mask[cur] = 1
		cx, cy := cur%w, cur/w
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := cx+d[0], cy+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			ni := ny*w + nx
			if visited[ni] {
				continue
			}
			visited[ni] = true
			if colorDist(seed, pix[ni]) <= tol {
				queue = append(queue, ni)
			}
		}
	}

	// 2) ALWAYS fill interior holes (black text / punctuation inside the bubble).
	//    Without this, flood-fill leaves letter-shaped voids; morphological
	//    opening then collapses the mask into a cross/plus and the contour
	//    hugs the text instead of the bubble body.
	//    smartMode is kept for API compat but hole-fill is mandatory for manga.
	_ = smartMode
	mask = smartHoleFill(mask, w, h)

	if countMask(mask) == 0 {
		return []Point{}, nil
	}

	// 3) Strip speech-bubble TAIL / sunburst spikes.
	//    Tails are thin relative to the oval body. Morphological opening with
	//    radius ≈ 10% of the smaller side removes thin protrusions so the
	//    contour (and later text box) stays on the main bubble only.
	beforeCount := countMask(mask)
	minSide, _, _, _, _ := maskBBox(mask, w, h)
	openR := minSide / 10
	if openR < 3 {
		openR = 3
	}
	if openR > 20 {
		openR = 20
	}
	opened := dilateMask(erodeMask(mask, w, h, openR), w, h, openR)
	openedCount := countMask(opened)
	// If opening ate the body (too aggressive), retry milder
	if openedCount < beforeCount/4 || openedCount < 16 {
		openR = max(2, openR/2)
		opened = dilateMask(erodeMask(mask, w, h, openR), w, h, openR)
		openedCount = countMask(opened)
	}
	if openedCount >= 16 {
		mask = opened
	} else {
		// last resort: only 1px hairline cleanup
		mask = dilateMask(erodeMask(mask, w, h, 1), w, h, 1)
	}
	if countMask(mask) < 8 {
		return []Point{}, nil
	}

	// 4) Mild inset so stroke does not sit on the black outline
	inset := 2
	if edgeSensitivity > 0 {
		inset = int(edgeSensitivity/20.0 + 1.5)
	}
	if inset < 1 {
		inset = 1
	}
	if inset > 3 {
		inset = 3
	}
	approxSide := int(math.Sqrt(float64(countMask(mask))))
	if approxSide > 0 && inset > approxSide/5 {
		inset = max(1, approxSide/5)
	}
	mask = erodeMask(mask, w, h, inset)
	if countMask(mask) < 8 {
		return []Point{}, nil
	}

	// 5) Moore-neighbor boundary (identical logic to Python)
	boundary := traceBoundary(mask, w, h)
	if len(boundary) < 3 {
		return nil, fmt.Errorf("مرز ناحیه قابل استخراج نیست")
	}

	// 6) RDP — Python uses ε=1.5; scale slightly with size for large bubbles
	eps := 1.5
	diag := boundaryDiag(boundary)
	if diag > 200 {
		eps = 2.0
	}
	if diag > 400 {
		eps = 2.5
	}
	simplified := rdp(boundary, eps)
	if len(simplified) < 3 {
		simplified = boundary
	}
	// Cap only extreme cases; keep enough detail to follow oval
	if len(simplified) > 48 {
		simplified = limitPoints(simplified, 48)
	}
	return simplified, nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}


// maskBBox returns min(side), minX, minY, maxX, maxY of filled pixels.
func maskBBox(mask []uint8, w, h int) (minSide, minX, minY, maxX, maxY int) {
	minX, minY = w, h
	maxX, maxY = -1, -1
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if mask[y*w+x] == 0 {
				continue
			}
			if x < minX {
				minX = x
			}
			if y < minY {
				minY = y
			}
			if x > maxX {
				maxX = x
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	if maxX < minX {
		return 0, 0, 0, 0, 0
	}
	bw := maxX - minX + 1
	bh := maxY - minY + 1
	minSide = bw
	if bh < minSide {
		minSide = bh
	}
	return minSide, minX, minY, maxX, maxY
}

func countMask(mask []uint8) int {
	n := 0
	for _, v := range mask {
		if v != 0 {
			n++
		}
	}
	return n
}

func boundaryDiag(pts []Point) float64 {
	if len(pts) == 0 {
		return 0
	}
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
	return math.Hypot(float64(maxX-minX), float64(maxY-minY))
}

func smartHoleFill(mask []uint8, w, h int) []uint8 {
	padW, padH := w+2, h+2
	ext := make([]bool, padW*padH)
	q := make([]int, 0, 256)
	for x := 0; x < padW; x++ {
		for _, y := range []int{0, padH - 1} {
			i := y*padW + x
			ext[i] = true
			q = append(q, i)
		}
	}
	for y := 0; y < padH; y++ {
		for _, x := range []int{0, padW - 1} {
			i := y*padW + x
			if !ext[i] {
				ext[i] = true
				q = append(q, i)
			}
		}
	}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		cx, cy := cur%padW, cur/padW
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := cx+d[0], cy+d[1]
			if nx < 0 || ny < 0 || nx >= padW || ny >= padH {
				continue
			}
			ni := ny*padW + nx
			if ext[ni] {
				continue
			}
			ox, oy := nx-1, ny-1
			if ox >= 0 && oy >= 0 && ox < w && oy < h && mask[oy*w+ox] == 1 {
				continue
			}
			ext[ni] = true
			q = append(q, ni)
		}
	}
	out := make([]uint8, w*h)
	copy(out, mask)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if !ext[(y+1)*padW+(x+1)] {
				out[y*w+x] = 1
			}
		}
	}
	return out
}

// chessboardDist returns per-pixel chessboard distance to the nearest background
// (0) pixel. Foreground pixels get positive distance; background stays 0.
// Two-pass algorithm — O(w*h), independent of radius (replaces O(w*h*r²) loops).
func chessboardDist(mask []uint8, w, h int) []int {
	const big = 1 << 28
	d := make([]int, w*h)
	for i := 0; i < w*h; i++ {
		if mask[i] != 0 {
			d[i] = big
		} else {
			d[i] = 0
		}
	}
	// forward pass
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*w + x
			if d[i] == 0 {
				continue
			}
			if x > 0 && d[i-1]+1 < d[i] {
				d[i] = d[i-1] + 1
			}
			if y > 0 && d[i-w]+1 < d[i] {
				d[i] = d[i-w] + 1
			}
			if x > 0 && y > 0 && d[i-w-1]+1 < d[i] {
				d[i] = d[i-w-1] + 1
			}
			if x+1 < w && y > 0 && d[i-w+1]+1 < d[i] {
				d[i] = d[i-w+1] + 1
			}
		}
	}
	// backward pass
	for y := h - 1; y >= 0; y-- {
		for x := w - 1; x >= 0; x-- {
			i := y*w + x
			if d[i] == 0 {
				continue
			}
			if x+1 < w && d[i+1]+1 < d[i] {
				d[i] = d[i+1] + 1
			}
			if y+1 < h && d[i+w]+1 < d[i] {
				d[i] = d[i+w] + 1
			}
			if x+1 < w && y+1 < h && d[i+w+1]+1 < d[i] {
				d[i] = d[i+w+1] + 1
			}
			if x > 0 && y+1 < h && d[i+w-1]+1 < d[i] {
				d[i] = d[i+w-1] + 1
			}
		}
	}
	return d
}

// erodeMask keeps pixels whose chessboard distance to background > radius.
func erodeMask(mask []uint8, w, h, radius int) []uint8 {
	out := make([]uint8, w*h)
	if radius < 1 || len(mask) != w*h {
		copy(out, mask)
		return out
	}
	d := chessboardDist(mask, w, h)
	for i, v := range d {
		if v > radius {
			out[i] = 1
		}
	}
	return out
}

// dilateMask expands foreground by chessboard radius via inverted distance.
func dilateMask(mask []uint8, w, h, radius int) []uint8 {
	out := make([]uint8, w*h)
	if radius < 1 || len(mask) != w*h {
		copy(out, mask)
		return out
	}
	// distance to nearest FOREGROUND = chessboardDist on inverted mask
	inv := make([]uint8, w*h)
	for i, v := range mask {
		if v == 0 {
			inv[i] = 1
		}
	}
	d := chessboardDist(inv, w, h)
	for i, v := range d {
		// background pixels within radius of a foreground pixel become 1
		// foreground: inv=0 → d=0 → keep 1; also any pixel with d<=radius was near FG
		if mask[i] != 0 || (v > 0 && v <= radius) {
			out[i] = 1
		}
	}
	// pixels that are foreground have inv=0 so d=0; handled by mask[i]!=0
	// pixels near FG have small positive d on inv
	return out
}

func traceBoundary(mask []uint8, w, h int) []Point {
	firstX, firstY := -1, -1
	for y := 0; y < h && firstX < 0; y++ {
		for x := 0; x < w; x++ {
			if mask[y*w+x] != 0 {
				firstX, firstY = x, y
				break
			}
		}
	}
	if firstX < 0 {
		return nil
	}
	padW, padH := w+2, h+2
	padded := make([]uint8, padW*padH)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			padded[(y+1)*padW+(x+1)] = mask[y*w+x]
		}
	}
	bx, by := firstX+1, firstY+1
	dirs := [][2]int{{-1, -1}, {0, -1}, {1, -1}, {1, 0}, {1, 1}, {0, 1}, {-1, 1}, {-1, 0}}
	boundary := make([]Point, 0, 256)
	cx, cy := bx, by
	prevDir := 7
	maxSteps := padW * padH
	for step := 0; step < maxSteps; step++ {
		boundary = append(boundary, Point{X: cx - 1, Y: cy - 1})
		found := false
		for i := 0; i < 8; i++ {
			newDir := (prevDir + 1 + i) % 8
			dx, dy := dirs[newDir][0], dirs[newDir][1]
			nx, ny := cx+dx, cy+dy
			if nx >= 0 && ny >= 0 && nx < padW && ny < padH && padded[ny*padW+nx] != 0 {
				cx, cy = nx, ny
				prevDir = (newDir + 4) % 8
				found = true
				break
			}
		}
		if !found {
			break
		}
		if cx == bx && cy == by && len(boundary) > 2 {
			break
		}
	}
	return boundary
}

func limitPoints(points []Point, maxN int) []Point {
	if maxN < 3 || len(points) <= maxN {
		return points
	}
	out := make([]Point, 0, maxN)
	for i := 0; i < maxN; i++ {
		idx := i * len(points) / maxN
		out = append(out, points[idx])
	}
	return out
}

// ProcessMarking computes dominant colors, safe text bounds, and optional RDP for freehand.
func ProcessMarking(imagePath string, mark map[string]any) (map[string]any, error) {
	c, err := getCached(imagePath)
	if err != nil {
		return nil, err
	}
	img := c.img

	markType, _ := mark["type"].(string)
	var points []Point
	if markType == "freehand" {
		points = extractPoints(mark)
		if len(points) > 2 {
			points = rdp(points, 1.5)
			markType = "polygon"
		}
	} else if markType == "polygon" || mark["shapeType"] == "magic-wand" {
		points = extractPoints(mark)
	}

	bounds := getBounds(mark, points)
	bg, text := dominantColors(img, mark, bounds, points)

	shapeType, _ := mark["shapeType"].(string)
	safe := calculateSafeBounds(markType, shapeType, bounds, points)

	outPoints := make([]map[string]int, 0, len(points))
	for _, p := range points {
		outPoints = append(outPoints, map[string]int{"x": p.X, "y": p.Y})
	}

	return map[string]any{
		"backgroundColor": bg,
		"textColor":       text,
		"safeBounds":      safe,
		"points":          outPoints,
	}, nil
}

func dominantColors(img image.Image, mark map[string]any, bounds Bounds, points []Point) (string, string) {
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return "#ffffff", "#000000"
	}
	type key struct{ r, g, b uint8 }
	counts := map[key]int{}
	// Running sum of actual pixel values per bucket → accurate mean (keeps pure white)
	type sum3 struct{ r, g, b, n int }
	sums := map[key]*sum3{}
	ib := img.Bounds()

	for y := bounds.Y; y < bounds.Y+bounds.Height; y++ {
		for x := bounds.X; x < bounds.X+bounds.Width; x++ {
			if x < ib.Min.X || y < ib.Min.Y || x >= ib.Max.X || y >= ib.Max.Y {
				continue
			}
			if !insideMark(mark, points, bounds, x, y) {
				continue
			}
			r16, g16, b16, _ := img.At(x, y).RGBA()
			r, g, b := uint8(r16>>8), uint8(g16>>8), uint8(b16>>8)
			// Fine quantize (step 4) — /10 previously forced #FFFFFF → #FAFAFA (grayish)
			k := key{r / 4 * 4, g / 4 * 4, b / 4 * 4}
			counts[k]++
			s := sums[k]
			if s == nil {
				s = &sum3{}
				sums[k] = s
			}
			s.r += int(r)
			s.g += int(g)
			s.b += int(b)
			s.n++
		}
	}
	if len(counts) == 0 {
		return "#ffffff", "#000000"
	}
	var best key
	bestN := 0
	for k, n := range counts {
		if n > bestN {
			bestN = n
			best = k
		}
	}
	// Prefer the true mean of the winning bucket (not the quantized corner)
	br, bg, bb := best.r, best.g, best.b
	if s := sums[best]; s != nil && s.n > 0 {
		br = uint8(s.r / s.n)
		bg = uint8(s.g / s.n)
		bb = uint8(s.b / s.n)
	}
	hex := fmt.Sprintf("#%02X%02X%02X", br, bg, bb)
	lum := (0.299*float64(br) + 0.587*float64(bg) + 0.114*float64(bb)) / 255.0
	text := "#000000"
	if lum <= 0.5 {
		text = "#ffffff"
	}
	return hex, text
}

func insideMark(mark map[string]any, points []Point, bounds Bounds, x, y int) bool {
	t, _ := mark["type"].(string)
	switch t {
	case "ellipse":
		cx := float64(bounds.X) + float64(bounds.Width)/2
		cy := float64(bounds.Y) + float64(bounds.Height)/2
		rx := float64(bounds.Width) / 2
		ry := float64(bounds.Height) / 2
		if rx <= 0 || ry <= 0 {
			return false
		}
		dx := (float64(x) - cx) / rx
		dy := (float64(y) - cy) / ry
		return dx*dx+dy*dy <= 1
	case "polygon", "freehand":
		if mark["shapeType"] == "magic-wand" || len(points) >= 3 {
			return pointInPolygon(points, x, y)
		}
		return true
	default:
		return true // rect
	}
}

func pointInPolygon(poly []Point, x, y int) bool {
	inside := false
	n := len(poly)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		xi, yi := poly[i].X, poly[i].Y
		xj, yj := poly[j].X, poly[j].Y
		intersect := ((yi > y) != (yj > y)) &&
			(float64(x) < float64(xj-xi)*float64(y-yi)/float64(yj-yi)+1e-9+float64(xi))
		if intersect {
			inside = !inside
		}
	}
	return inside
}

func getBounds(mark map[string]any, points []Point) Bounds {
	t, _ := mark["type"].(string)
	if t == "rect" || t == "rectangle" || t == "ellipse" {
		return Bounds{
			X:      toInt(mark["x"]),
			Y:      toInt(mark["y"]),
			Width:  toInt(mark["width"]),
			Height: toInt(mark["height"]),
		}
	}
	if len(points) == 0 {
		points = extractPoints(mark)
	}
	if len(points) == 0 {
		return Bounds{}
	}
	minX, minY := points[0].X, points[0].Y
	maxX, maxY := minX, minY
	for _, p := range points {
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
	return Bounds{X: minX, Y: minY, Width: maxX - minX, Height: maxY - minY}
}

func calculateSafeBounds(markType, shapeType string, bounds Bounds, points []Point) Bounds {
	// Always use bounding-box center — vertex average is biased on jagged wand contours.
	cx := float64(bounds.X) + float64(bounds.Width)/2
	cy := float64(bounds.Y) + float64(bounds.Height)/2
	_ = points

	scale := 0.90
	switch {
	case shapeType == "magic-wand":
		scale = 0.84
	case markType == "ellipse":
		scale = 0.82
	case markType == "rect", markType == "rectangle":
		scale = 0.92
	case markType == "polygon", markType == "freehand":
		scale = 0.88
	}

	w := int(float64(bounds.Width) * scale)
	h := int(float64(bounds.Height) * scale)
	if w < 8 {
		w = min(bounds.Width, 8)
	}
	if h < 8 {
		h = min(bounds.Height, 8)
	}
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	return Bounds{
		X:      int(math.Round(cx)) - w/2,
		Y:      int(math.Round(cy)) - h/2,
		Width:  w,
		Height: h,
	}
}

func extractPoints(mark map[string]any) []Point {
	raw, ok := mark["points"].([]any)
	if !ok {
		return nil
	}
	out := make([]Point, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, Point{X: toInt(m["x"]), Y: toInt(m["y"])})
	}
	return out
}

func toInt(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	case jsonNumber:
		i, _ := t.Int64()
		return int(i)
	default:
		return 0
	}
}

// avoid importing encoding/json number alias issues
type jsonNumber interface {
	Int64() (int64, error)
}

func rgbaAt(img image.Image, x, y int) color.RGBA {
	r, g, b, a := img.At(x, y).RGBA()
	return color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}
}

func colorDist(a, b color.RGBA) int {
	dr := int(a.R) - int(b.R)
	dg := int(a.G) - int(b.G)
	db := int(a.B) - int(b.B)
	if dr < 0 {
		dr = -dr
	}
	if dg < 0 {
		dg = -dg
	}
	if db < 0 {
		db = -db
	}
	return dr + dg + db
}

func rdp(points []Point, epsilon float64) []Point {
	if len(points) < 3 {
		return points
	}
	dmax := 0.0
	index := 0
	end := len(points) - 1
	p1 := points[0]
	p2 := points[end]
	for i := 1; i < end; i++ {
		d := perpDist(points[i], p1, p2)
		if d > dmax {
			index = i
			dmax = d
		}
	}
	if dmax > epsilon {
		left := rdp(points[:index+1], epsilon)
		right := rdp(points[index:], epsilon)
		return append(left[:len(left)-1], right...)
	}
	return []Point{p1, p2}
}

func perpDist(p, a, b Point) float64 {
	dx := float64(b.X - a.X)
	dy := float64(b.Y - a.Y)
	if dx == 0 && dy == 0 {
		return math.Hypot(float64(p.X-a.X), float64(p.Y-a.Y))
	}
	return math.Abs(dy*float64(p.X-a.X)-dx*float64(p.Y-a.Y)) / math.Hypot(dx, dy)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// WriteZipFromUploads packs uploaded files into a zip at destPath.
func WriteZipFromUploads(destPath string, files []*multipart.FileHeader) error {
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()
	zw := zip.NewWriter(out)
	defer zw.Close()
	for _, fh := range files {
		name := filepath.Base(fh.Filename)
		if name == "" {
			continue
		}
		src, err := fh.Open()
		if err != nil {
			return err
		}
		w, err := zw.Create(name)
		if err != nil {
			src.Close()
			return err
		}
		_, err = io.Copy(w, src)
		src.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
