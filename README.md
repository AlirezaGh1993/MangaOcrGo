# Manga Server — هسته Go

بازنویسی کامل بک‌اند از Flask (Python) به **Go خالص**.  
فرانت‌اند HTML/JS بدون تغییر از `./static` سرو می‌شود.

## مزایا نسبت به نسخه Python

| مورد | Python | Go |
|------|--------|-----|
| اجرا | venv + Flask + Pillow + NumPy | یک باینری |
| عصای جادویی | Pillow floodfill + NumPy | BFS + Moore + polar smooth + RDP (کش RAM + بلور) |
| رنگ غالب | Pillow هر بار از دیسک | کش تصویر در RAM |
| Export ZIP | 7z.exe (ویندوز) | `archive/zip` استاندارد (همه OS) |
| Path safety | `_safe_join` | `paths.SafeJoin` |
| قفل ذخیره | threading.Lock | `sync.Mutex` |

## نیازمندی‌ها

- Go 1.22+
- (اختیاری) LM Studio برای OCR — همان endpoint قبلی

## اجرا

```bash
cd go-server
go run .
# مرورگر: http://127.0.0.1:6465
```

یا باینری:

```bash
go build -o mangaserver .
./mangaserver
```

ویندوز:

```bat
build.bat
run.bat
```

## تست ابزارها

```bash
go test ./internal/tools/ -v
```

تست‌های پوشش‌داده‌شده:
- حباب سفید روی پس‌زمینه تیره (پلی‌گون معتبر)
- نقطه خارج از تصویر (خطا)
- blur + smart mode
- process-marking برای rectangle
- ساده‌سازی RDP

## ساختار داده (سازگار با نسخه Python)

```
go-server/
  static/                 # فرانت‌اند
  data/
    projects/<id>/
      <id>.json           # markings, imagesMeta, projectName, ...
      images/             # فایل‌های تصویر
    fonts/
    exports/
    settings.json         # apiUrl, model, fonts, exportPath, ...
```

## API (هم‌تراز با app.py)

| Endpoint | وضعیت |
|----------|--------|
| `GET /` | UI |
| `GET/POST /api/config` | OK |
| `GET /api/projects` | OK |
| `POST /api/project/new` | OK |
| `GET/POST/DELETE /api/project/{id}` | OK |
| `PUT /api/project/{id}/rename` | OK |
| `POST /api/project/{id}/images/add` | OK |
| `DELETE .../images/{file}` و `.../images/all` | OK |
| `GET /api/projects/{id}/images/{file}` | OK |
| `POST /api/tools/magic-wand` | OK — کش + بلور + smart hole fill |
| `POST /api/tools/process-marking` | OK — رنگ غالب + safeBounds + RDP |
| `POST /api/save-export` | OK |
| `POST/DELETE /api/font/{slot}` | OK |
| `GET /api/font/file/{name}` | OK |

## عصای جادویی (جزئیات)

1. کش تصویر بر اساس mtime (حداکثر ۵ تصویر در RAM)
2. بلور جعبه‌ای جداپذیر (تقریب Gaussian) وقتی `blur >= 0.5`
3. Flood-fill BFS روی بافر تخت RGBA
4. پر کردن حفره هوشمند (smart mode)
5. ردیابی مرز Moore-neighbor
6. صاف‌سازی قطبی (حذف spikeهای خورشیدی)
7. RDP تطبیقی + سقف ۲۸ رأس

## مهاجرت از Python

پوشه `data/projects` و `data/settings.json` را کپی کنید — فرمت JSON یکسان است.
