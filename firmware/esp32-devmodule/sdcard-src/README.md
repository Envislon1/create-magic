# SD card source art

Drop editable source PNGs into these folders, one per expected filename
listed in `../sdcard/README.txt`. Then run:

```bash
python3 tools/convert_assets.py
```

The script converts every PNG into an LVGL-binary `.bin` under
`../sdcard/mindbuddy/<same subpath>/`.

## Sizing

| Folder             | Target size | Format hint            |
|--------------------|-------------|------------------------|
| `backgrounds/`     | 240x320     | RGB565, no alpha       |
| `icons/nav/`       | 32x32       | RGB565A8 (transparent) |
| `icons/actions/`   | 48x48       | RGB565A8               |
| `icons/media/`     | 40x40       | RGB565A8               |
| `icons/phone/`     | 40x40       | RGB565A8               |
| `icons/status/`    | 16x16       | RGB565A8               |
| `icons/moods/`     | 40x40       | RGB565A8               |
| `avatars/`         | 96x96       | RGB565A8               |

The converter picks the right color format automatically from the PNG's
alpha channel — you just need the right pixel size.

## Placeholder art

You do not have to fill every slot. Anything missing falls back to the
built-in flat-color rendering in the firmware.
