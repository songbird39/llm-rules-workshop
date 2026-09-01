#!/usr/bin/env python3
"""
Regenerate the embedded consent document in src/Card Workshop.dc.html.

    python3 tools/consent.py                 # rebuild from assets/동의서-참여자배포용.pdf
    python3 tools/consent.py --check         # fail if src is stale, change nothing

WHY IMAGES AND NOT AN EMBEDDED PDF
  The consent form has to be readable on the sign-in screen with no click and no
  plugin. <embed>/<iframe> PDF rendering varies by browser — Safari and iOS in
  particular show only the first page or nothing at all — and a consent document
  that silently fails to display is not an acceptable failure mode. So each page
  is rasterised and inlined.

WHY IT IS SO SMALL
  The source is black text on white, so the pages are rendered greyscale at 120dpi
  and quantised to 4 levels. That is visually identical to full greyscale (checked
  side by side) at roughly a third of the bytes: ~240KB of base64 for five pages.

WHAT GOES IN — AND WHAT MUST NOT
  assets/동의서-참여자배포용.pdf is the PARTICIPANT-FACING extract only: the
  information sheet and the two consent sheets. The IRB submission packet also
  carries the recruitment notice, the screening survey and the interview script,
  and none of those may be embedded here or committed to this repo — the site is
  public, and showing a participant the interview probes before the session
  invalidates it. Re-extract with:

      qpdf --decrypt PACKET.pdf --pages PACKET.pdf 1-5 -- assets/동의서-참여자배포용.pdf

  (check the page range against the packet first; it is not guaranteed to stay 1-5)

WHAT ELSE GOES IN
  lastPdf  the FINAL page alone, as a real one-page PDF   → the "consent PDF" button
  lastPng  the same page at 200dpi, for printing/signing  → the "consent image" button
  The last page is the sheet the participant actually signs, which is why both
  download buttons are scoped to it rather than to the whole document.
"""
import base64
import io
import pathlib
import re
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF = ROOT / "assets" / "동의서-참여자배포용.pdf"
SRC = ROOT / "src" / "Card Workshop.dc.html"
READ_DPI, PRINT_DPI, GREYS = 120, 200, 4


def render(tmp, dpi, first=None, last=None):
    """pdftoppm → sorted list of greyscale PIL images."""
    stem = tmp / f"p{dpi}"
    cmd = ["pdftoppm", "-gray", "-r", str(dpi), "-png"]
    if first:
        cmd += ["-f", str(first), "-l", str(last or first)]
    subprocess.run(cmd + [str(PDF), str(stem)], check=True, capture_output=True)
    return [Image.open(f).convert("L") for f in sorted(tmp.glob(f"p{dpi}-*.png"))]


def png_uri(img):
    buf = io.BytesIO()
    img.quantize(colors=GREYS).save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def build():
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d)
        pages = [png_uri(im) for im in render(tmp, READ_DPI)]
        n = len(pages)
        last_png = png_uri(render(tmp, PRINT_DPI, first=n)[0])
        out = tmp / "last.pdf"
        # --deterministic-id: without it qpdf stamps a random /ID and this script is
        # never idempotent, so --check reports a spurious "out of date" every run.
        subprocess.run(["qpdf", "--deterministic-id", str(PDF), "--pages", str(PDF), str(n),
                        "--", str(out)],
                       check=False, capture_output=True)  # warns on this file, still correct
        last_pdf = "data:application/pdf;base64," + base64.b64encode(out.read_bytes()).decode()

    body = ",\n".join("    '" + p + "'" for p in pages)
    block = ("const CONSENT = {\n  pages: [\n" + body + "\n  ],\n"
             "  lastPdf: '" + last_pdf + "',\n"
             "  lastPng: '" + last_png + "'\n};")
    # base64 has no '<', so the bundler's </ escaping is never at risk here
    assert "</" not in block
    return block, pages, last_pdf, last_png


def main():
    block, pages, last_pdf, last_png = build()
    text = SRC.read_text(encoding="utf-8")
    pat = re.compile(r"const CONSENT = \{.*?\n\};", re.S)
    if not pat.search(text):
        sys.exit("could not find the CONSENT block in src")
    new = pat.sub(lambda _: block, text, count=1)

    kb = lambda s: round(len(s) / 1024, 1)
    print(f"{len(pages)} pages, {kb(''.join(pages))}KB  |  "
          f"lastPdf {kb(last_pdf)}KB  |  lastPng {kb(last_png)}KB")
    if new == text:
        print("up to date")
        return
    if "--check" in sys.argv:
        sys.exit("OUT OF DATE: run python3 tools/consent.py")
    SRC.write_text(new, encoding="utf-8")
    print("src updated — now run python3 tools/build.py")


if __name__ == "__main__":
    main()
