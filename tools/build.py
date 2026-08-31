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
    _, _, want = app_source(src)
    b, start, end, doc = read_bundle()
    a2, z2, have = app_source(doc)

    if have == want:
        print(f"up to date ({len(want)} chars of app source)")
    elif check_only:
        print(f"OUT OF DATE: src {len(want)} chars vs bundle {len(have)} chars")
        sys.exit(1)
    else:
        write_bundle(b, start, end, doc[:a2] + want + doc[z2:])
        print(f"built index.html from {SRC.name} ({len(want)} chars)")

    # verify the result round-trips and still parses
    _, _, _, doc2 = read_bundle()
    _, _, got = app_source(doc2)
    assert got == want, "app source did not round-trip through the bundle"
    assert doc2.rstrip().endswith("</html>"), "bundle document is truncated"
    print("verified: unpacks, app source matches src, document intact")


if __name__ == "__main__":
    main()
