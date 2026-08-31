#!/usr/bin/env python3
"""
Build index.html from src/Card Workshop.dc.html.

    python3 tools/build.py           # build, then verify
    python3 tools/build.py --check   # verify only, change nothing

WHY THIS EXISTS
  index.html is a 22 MB bundle whose whole document lives as a JSON string inside
  <script type="__bundler/template">. Up to now every change was a surgical string
  patch applied to BOTH files, which is fine for a two-line fix and miserable for a
  restructure.

  The app's own source — the <script type="text/x-dc"> block — is byte-identical in
  src/ and inside the bundle. The bundle only differs by having fonts inlined and
  support.js replaced with a bundled asset id. So the real build is: take the app
  source out of src/, splice it into the bundle's embedded document, re-serialize.

  That means src/Card Workshop.dc.html can be edited like any normal file.

TWO ESCAPING RULES, both learned the hard way:
  - The template is JSON inside a <script> element, so a literal "</" would close the
    element early and corrupt the 22 MB file. The original bundler escapes the slash;
    we match it (\\u002F is valid JSON, so JSON.parse still yields the same string).
  - ensure_ascii=False keeps Korean readable rather than exploding into \\uXXXX.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "Card Workshop.dc.html"
BUNDLE = ROOT / "index.html"
TAG = '<script type="__bundler/template">'
MARK = "text/x-dc"


def app_source(text):
    """The <script type="text/x-dc"> body — the actual application source."""
    i = text.index(MARK)
    a = text.index(">", i) + 1
    z = text.index("</script>", a)
    return a, z, text[a:z]


def markup(text):
    """The template markup: everything between </helmet> and </x-dc>.

    The app is TWO regions, and an early version of this script spliced only the
    second — so i18n edits landed while panel markup silently did not, and the built
    file rendered empty headings. <helmet> itself is excluded on purpose: src links
    Pretendard from a CDN while the bundle has the @font-face blocks inlined, and that
    difference is the whole point of the bundle.
    """
    a = text.index("</helmet>") + len("</helmet>")
    z = text.index("</x-dc>")
    return a, z, text[a:z]


def read_bundle():
    b = BUNDLE.read_text(encoding="utf-8")
    j = b.index(TAG)
    start = b.index(">", j) + 1
    end = b.index("</script>", start)
    return b, start, end, json.loads(b[start:end].strip())


def write_bundle(b, start, end, doc):
    payload = json.dumps(doc, ensure_ascii=False).replace("</", "<\\u002F")
    assert "</" not in payload, "unescaped </ would truncate the script element"
    BUNDLE.write_text(b[:start] + "\n" + payload + "\n" + b[end:], encoding="utf-8")


def main():
    check_only = "--check" in sys.argv
    src = SRC.read_text(encoding="utf-8")
    _, _, want_src = app_source(src)
    _, _, want_mk = markup(src)
    b, start, end, doc = read_bundle()
    _, _, have_src = app_source(doc)
    _, _, have_mk = markup(doc)

    stale = (have_src != want_src) or (have_mk != want_mk)
    if not stale:
        print(f"up to date (markup {len(want_mk)}, app source {len(want_src)})")
    elif check_only:
        print("OUT OF DATE:"
              f" markup {'differs' if have_mk != want_mk else 'ok'},"
              f" app source {'differs' if have_src != want_src else 'ok'}")
        sys.exit(1)
    else:
        # markup first, then the script — splicing markup shifts the script's offsets
        a, z, _ = markup(doc)
        doc = doc[:a] + want_mk + doc[z:]
        a, z, _ = app_source(doc)
        doc = doc[:a] + want_src + doc[z:]
        write_bundle(b, start, end, doc)
        print(f"built index.html (markup {len(want_mk)}, app source {len(want_src)})")

    # verify the result round-trips and still parses
    _, _, _, doc2 = read_bundle()
    assert app_source(doc2)[2] == want_src, "app source did not round-trip"
    assert markup(doc2)[2] == want_mk, "markup did not round-trip"
    assert doc2.rstrip().endswith("</html>"), "bundle document is truncated"
    print("verified: unpacks, markup and app source match src, document intact")


if __name__ == "__main__":
    main()
