#!/usr/bin/env python3
"""markitdown-yoshi PDF classifier (L1).

pdf-inspector (firecrawl/pdf-inspector) の "Smart classification" 相当の最小実装。
ページごとの extract_text() の有無で TextBased / Scanned / Mixed / ImageBased / Unknown を判定する。

CLI:
    python pdf_classifier.py <absolute_pdf_path>

Output (stdout, single line JSON):
    {"pdf_type": "TextBased|Scanned|Mixed|Unknown",
     "page_count": int,
     "pages_needing_ocr": [0-indexed page numbers],
     "confidence": float (0.0-1.0),
     "text_pages": int,
     "empty_pages": int,
     "error": str (optional, Unknown 時のみ)}

Note: L1 判定（Tj/TJ operator相当）のみ。Do (image operator) 検出ベースの
ImageBased 分類は L2 スコープとして未実装。スキャンPDFはすべて Scanned として返す。

エラー（暗号化/破損）でも exit 0、pdf_type="Unknown" で正常終了する。
Node.js 側は JSON.parse 成功を前提に pdf_type を見て分岐する。

依存: pypdf (MIT, pure Python, no network). `pip install pypdf` 要インストール。
"""

from __future__ import annotations

import json
import sys

# テキスト判定の閾値（ページ番号だけのスキャンPDFを TextBased と誤判定しないため 5 文字）
TEXT_THRESHOLD = 5


def classify(path: str) -> dict:
    """PDF を分類して dict を返す。例外はすべて内部で捕捉して pdf_type='Unknown' で返す。"""
    try:
        # pypdf import はここで行う（pypdf 未インストール環境で ImportError を捕捉するため）
        from pypdf import PdfReader
    except ImportError as exc:
        return {
            "pdf_type": "Unknown",
            "page_count": 0,
            "pages_needing_ocr": [],
            "confidence": 0.0,
            "text_pages": 0,
            "empty_pages": 0,
            "error": f"pypdf not installed: {exc}",
        }

    try:
        reader = PdfReader(path)
    except Exception as exc:  # 壊れたPDF・ヘッダ不正等
        return {
            "pdf_type": "Unknown",
            "page_count": 0,
            "pages_needing_ocr": [],
            "confidence": 0.0,
            "text_pages": 0,
            "empty_pages": 0,
            "error": f"failed to open: {exc!s}"[:200],
        }

    if reader.is_encrypted:
        # 暗号化PDF は復号試行なし（認証情報なしで開けるケースは稀）
        return {
            "pdf_type": "Unknown",
            "page_count": len(reader.pages) if hasattr(reader, "pages") else 0,
            "pages_needing_ocr": [],
            "confidence": 0.0,
            "text_pages": 0,
            "empty_pages": 0,
            "error": "encrypted",
        }

    pages = reader.pages
    page_count = len(pages)

    if page_count == 0:
        return {
            "pdf_type": "Unknown",
            "page_count": 0,
            "pages_needing_ocr": [],
            "confidence": 0.0,
            "text_pages": 0,
            "empty_pages": 0,
            "error": "no pages",
        }

    text_pages = 0
    empty_pages = 0
    pages_needing_ocr: list[int] = []

    for idx, page in enumerate(pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            # 個別ページ抽出失敗は OCR 必要扱いで続行
            text = ""
        if len(text.strip()) >= TEXT_THRESHOLD:
            text_pages += 1
        else:
            empty_pages += 1
            pages_needing_ocr.append(idx)

    if text_pages == page_count:
        pdf_type = "TextBased"
        confidence = 1.0
    elif text_pages == 0:
        pdf_type = "Scanned"
        confidence = 1.0
    else:
        pdf_type = "Mixed"
        confidence = text_pages / page_count

    return {
        "pdf_type": pdf_type,
        "page_count": page_count,
        "pages_needing_ocr": pages_needing_ocr,
        "confidence": confidence,
        "text_pages": text_pages,
        "empty_pages": empty_pages,
    }


def main() -> int:
    if len(sys.argv) != 2:
        # 誤用 — stderr に案内、JSON は出さない
        sys.stderr.write("usage: pdf_classifier.py <absolute_pdf_path>\n")
        return 2

    result = classify(sys.argv[1])
    # stdout に 1 行 JSON（Node.js 側で JSON.parse）
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
