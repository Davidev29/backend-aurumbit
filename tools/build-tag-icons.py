"""Normaliza ASSETS/tags/* em icones de plataforma serviveis pelo front.

Achado no mapeamento 2026-10-17 que este script resolve:
  1. `web icon.jfif` e JPEG RGB com fundo branco opaco. `next/image` nao serve
      `.jfif`, e no tema dark do DS (`--bg-0: #0b0d10`) um fundo branco vira um
      retangulo glaring.
  2. `apple icon.png` e a marca preta pura -> invisivel no tema dark, que e o
      default do DS. Gera a variante invertida (`-dark`).
  3. Tamanhos heterogeneos (320..1000px) e nomes com espaco ("mac os icon.png").

Saidas (PNG RGBA 256px, recorte pela caixa de alfa + padding uniforme):
    apps/admin/public/tags/<id>.png        (tema light)
    apps/admin/public/tags/<id>-dark.png   (tema dark; so p/ as monocromaticas)
    apps/portal/public/tags/<id>.png
    apps/portal/public/tags/<id>-dark.png

CATALOGO: este script NAO tem lista propria — le a fonte unica
`libs/contracts/src/products.catalog.json` (id/rotulo/assetFile/monochrome), a
mesma que `pnpm catalog:sync` gera para o front e a API. O `id` e estavel e vai
para o banco (products.platforms TEXT[]), entao nao deve mudar sem migration.

Uso:  python tools/build-tag-icons.py
Idempotente: sempre reescreve a partir de ASSETS/tags (fonte da arte).
"""

from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - ambiente sem Pillow
    sys.exit("Pillow nao encontrado. Instale com: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "ASSETS" / "tags"
TARGETS = [ROOT / "apps" / "admin" / "public" / "tags", ROOT / "apps" / "portal" / "public" / "tags"]

# FONTE UNICA do catalogo (mesmo dado que o front/API consomem via `pnpm catalog:sync`).
CATALOG_PATH = ROOT / "libs" / "contracts" / "src" / "products.catalog.json"

SIZE = 256
INNER_RATIO = 0.82
WHITE_TOL = 245
WHITE_TOL_C = 28


def load_catalog() -> tuple[list[tuple[str, str, str]], set[str]]:
    """(id, rotulo pt-BR, arquivo de origem) + ids monocromaticos.

    Nao ha copia da lista aqui de proposito: id/rotulo/assetFile/monochrome vem
    do JSON. O gate `pnpm catalog:check` confere que os PNGs gerados batem com o
    catalogo (inclusive orfaos).
    """
    if not CATALOG_PATH.exists():
        sys.exit(f"catalogo nao encontrado: {CATALOG_PATH.relative_to(ROOT)}")
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    platforms = [(item["id"], item["label"], item["assetFile"]) for item in data["platforms"]]
    monochrome = {item["id"] for item in data["platforms"] if item["monochrome"]}
    return platforms, monochrome


PLATFORMS, MONOCHROME = load_catalog()


def _strip_border_white(im: Image.Image) -> Image.Image:
    """Remove o branco de fundo por flood-fill a partir das bordas.

    Flood-fill (nao um limiar global) para nao comer os whites internos da arte
    (olho do Tux, o "0" do Windows). Tolera ruido de JPEG.
    """
    px = im.load()
    w, h = im.size
    seen = [[False] * h for _ in range(w)]
    queue: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if not seen[x][y]:
                seen[x][y] = True
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[x][y]:
                seen[x][y] = True
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        r, g, b = px[x, y][:3]
        if not (r >= WHITE_TOL and g >= WHITE_TOL and b >= WHITE_TOL):
            continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny]:
                seen[nx][ny] = True
                queue.append((nx, ny))

    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    dst = out.load()
    for x in range(w):
        for y in range(h):
            if not seen[x][y]:
                dst[x, y] = px[x, y]
    return out


def _fit(canvas_size: int) -> Image.Image:
    return Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))


def normalize(src: Path, dst: Path, *, invert: bool) -> tuple[int, int]:
    im = Image.open(src)

    # Os 4 PNGs de origem ja vem com alfa limpo (verificado: cantos = 0,0,0,0),
    # entao so o JPEG precisa de remocao de fundo. NAO se faz um limiar global de
    # branco aqui: a arte tem realces brancos legitimos (brilho da maca, olho do
    # Tux) que um limiar apaga.
    if im.mode != "RGBA":
        im = _strip_border_white(im.convert("RGB"))
    else:
        im = im.convert("RGBA")

    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    w, h = im.size
    scale = (SIZE * INNER_RATIO) / max(w, h)
    im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    w, h = im.size
    canvas = _fit(SIZE)
    canvas.paste(im, ((SIZE - w) // 2, (SIZE - h) // 2), im)

    if invert:
        r, g, b, a = canvas.split()
        canvas = Image.merge("RGBA", (*ImageOps.invert(Image.merge("RGB", (r, g, b))).split(), a))

    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, "PNG", optimize=True)
    return canvas.size, dst.stat().st_size


def main() -> int:
    missing = [src for _, _, src in PLATFORMS if not (SRC_DIR / src).exists()]
    if missing:
        sys.exit(f"ASSETS/tags ausente: {missing}")

    total = 0
    for pid, label, src in PLATFORMS:
        for target in TARGETS:
            size, nbytes = normalize(SRC_DIR / src, target / f"{pid}.png", invert=False)
            total += 1
            print(f"{pid:<8} -> {target.relative_to(ROOT)}/{pid}.png  {size} {nbytes // 1024}KB")
            if pid in MONOCHROME:
                size, nbytes = normalize(SRC_DIR / src, target / f"{pid}-dark.png", invert=True)
                total += 1
                print(f"{pid:<8} -> {target.relative_to(ROOT)}/{pid}-dark.png  {size} {nbytes // 1024}KB")
        print(f"         rotulo pt-BR: {label}")

    print(f"\n[build-tag-icons] {total} arquivos gerados em {len(TARGETS)} alvos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
