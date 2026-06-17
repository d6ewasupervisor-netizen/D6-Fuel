#!/usr/bin/env python3
"""Build the fruit audit field handout PDF with real FM 023 D8 example photos."""

from __future__ import annotations

import textwrap
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "fruit-audit-handout" / "examples" / "fm023-berries"
OUTPUT = ROOT / "docs" / "fruit-audit-handout" / "Fruit Audit Field Handout.pdf"

PAGE_W = 612
PAGE_H = 792
MARGIN = 48
CONTENT_W = PAGE_W - (2 * MARGIN)

COLORS = {
    "title": (0.02, 0.07, 0.05),
    "heading": (0.08, 0.22, 0.12),
    "body": (0.12, 0.18, 0.15),
    "muted": (0.35, 0.45, 0.40),
    "accent": (0.20, 0.65, 0.32),
    "amber_bg": (1.0, 0.96, 0.86),
    "amber_border": (0.85, 0.65, 0.15),
}


def wrap(text: str, width: int = 92) -> str:
    return "\n".join(textwrap.wrap(text, width=width, break_long_words=False, replace_whitespace=False))


class HandoutBuilder:
    def __init__(self) -> None:
        self.doc = fitz.open()
        self.page: fitz.Page | None = None
        self.y = MARGIN

    def new_page(self) -> None:
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = MARGIN

    def ensure_space(self, needed: float) -> None:
        if self.page is None:
            self.new_page()
        if self.y + needed > PAGE_H - MARGIN:
            self.new_page()

    def text(
        self,
        value: str,
        *,
        size: float = 11,
        color=COLORS["body"],
        bold: bool = False,
        leading: float = 1.35,
        gap: float = 6,
    ) -> None:
        font = "hebo" if bold else "helv"
        for block in value.split("\n"):
            self.ensure_space(size * leading + gap)
            if block.strip():
                self.page.insert_text(
                    fitz.Point(MARGIN, self.y),
                    block,
                    fontsize=size,
                    fontname=font,
                    color=color,
                )
            self.y += size * leading
        self.y += gap

    def heading(self, value: str, *, size: float = 16) -> None:
        self.ensure_space(size * 1.6 + 8)
        self.text(value, size=size, color=COLORS["heading"], bold=True, gap=4)

    def subheading(self, value: str) -> None:
        self.text(value, size=13, color=COLORS["heading"], bold=True, gap=2)

    def bullet_list(self, items: list[str], *, size: float = 10.5) -> None:
        for item in items:
            wrapped = wrap(item, width=88)
            lines = wrapped.split("\n")
            self.ensure_space((len(lines) * size * 1.35) + 4)
            self.page.insert_text(
                fitz.Point(MARGIN, self.y),
                f"• {lines[0]}",
                fontsize=size,
                fontname="helv",
                color=COLORS["body"],
            )
            self.y += size * 1.35
            for line in lines[1:]:
                self.page.insert_text(
                    fitz.Point(MARGIN + 12, self.y),
                    line,
                    fontsize=size,
                    fontname="helv",
                    color=COLORS["body"],
                )
                self.y += size * 1.35
            self.y += 2

    def numbered_list(self, items: list[str], *, size: float = 10.5) -> None:
        for idx, item in enumerate(items, start=1):
            wrapped = wrap(item, width=86)
            lines = wrapped.split("\n")
            self.ensure_space((len(lines) * size * 1.35) + 4)
            self.page.insert_text(
                fitz.Point(MARGIN, self.y),
                f"{idx}. {lines[0]}",
                fontsize=size,
                fontname="helv",
                color=COLORS["body"],
            )
            self.y += size * 1.35
            indent = MARGIN + 18
            for line in lines[1:]:
                self.page.insert_text(
                    fitz.Point(indent, self.y),
                    line,
                    fontsize=size,
                    fontname="helv",
                    color=COLORS["body"],
                )
                self.y += size * 1.35
            self.y += 2

    def callout(self, title: str, body: str) -> None:
        wrapped = wrap(body, width=88)
        lines = wrapped.split("\n")
        box_h = 34 + (len(lines) * 12)
        self.ensure_space(box_h + 10)
        rect = fitz.Rect(MARGIN, self.y, PAGE_W - MARGIN, self.y + box_h)
        self.page.draw_rect(rect, color=COLORS["amber_border"], fill=COLORS["amber_bg"], width=0.8)
        self.page.insert_text(
            fitz.Point(MARGIN + 12, self.y + 18),
            title,
            fontsize=11,
            fontname="hebo",
            color=COLORS["heading"],
        )
        y = self.y + 34
        for line in lines:
            self.page.insert_text(
                fitz.Point(MARGIN + 12, y),
                line,
                fontsize=10,
                fontname="helv",
                color=COLORS["body"],
            )
            y += 12
        self.y += box_h + 10

    def image_with_caption(self, image_path: Path, caption: str, width: float, height: float) -> None:
        self.ensure_space(height + 24)
        rect = fitz.Rect(MARGIN, self.y, MARGIN + width, self.y + height)
        self.page.insert_image(rect, filename=str(image_path))
        self.page.draw_rect(rect, color=COLORS["accent"], width=1.0)
        self.page.insert_text(
            fitz.Point(MARGIN, self.y + height + 14),
            caption,
            fontsize=9.5,
            fontname="hebo",
            color=COLORS["heading"],
        )
        self.y += height + 24

    def image_grid(self, entries: list[tuple[Path, str]], *, cols: int = 2, cell_w: float = 240, cell_h: float = 180) -> None:
        gap = 16
        rows = (len(entries) + cols - 1) // cols
        total_h = rows * (cell_h + 28) + (rows - 1) * gap
        self.ensure_space(total_h + 8)
        for idx, (image_path, caption) in enumerate(entries):
            row = idx // cols
            col = idx % cols
            x = MARGIN + col * (cell_w + gap)
            y = self.y + row * (cell_h + 28 + gap)
            rect = fitz.Rect(x, y, x + cell_w, y + cell_h)
            self.page.insert_image(rect, filename=str(image_path))
            self.page.draw_rect(rect, color=COLORS["accent"], width=0.8)
            self.page.insert_text(
                fitz.Point(x, y + cell_h + 14),
                caption,
                fontsize=9,
                fontname="hebo",
                color=COLORS["heading"],
            )
        self.y += total_h + 8

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(path)
        self.doc.close()


def build() -> Path:
    required = [
        "Front_01.jpg",
        "Front_02.jpg",
        "Right_Side_01.jpg",
        "Back_01.jpg",
        "Back_02.jpg",
        "Left_Side_01.jpg",
    ]
    for name in required:
        if not (ASSETS / name).exists():
            raise FileNotFoundError(f"Missing example photo: {ASSETS / name}")

    pdf = HandoutBuilder()
    pdf.new_page()

    pdf.text("Fruit Audit — Field Handout", size=24, color=COLORS["title"], bold=True, gap=2)
    pdf.text("Districts 1, 6, 7, and 8  |  P5W3 Fruit Table Photo Audit", size=11, color=COLORS["muted"], gap=10)
    pdf.text(
        "Goal: At each assigned Fred Meyer store, photograph every fruit table listed in the app "
        "from all four sides — Front, Right Side, Back, and Left Side — so we have a complete "
        "360-degree view of each set.",
        size=11,
        gap=8,
    )
    pdf.callout(
        "Quick links",
        "Photo app: https://fuel.retail-odyssey.com/fruit-audit\n"
        "Online guide: https://fuel.retail-odyssey.com/fruit-audit-guide\n"
        "District dashboards: add ?district=1, ?district=6, or ?district=7 to the dashboard URL.",
    )

    pdf.heading("Before you go to the store")
    pdf.subheading("Districts 1, 6, and 7 — assign yourself first")
    pdf.numbered_list([
        "Open your district Assignment Dashboard and sign in with your full name and approved email.",
        "Find your store and tap “I will complete this store.”",
        "Confirm the store appears under Your assigned stores.",
        "If your store does not show in the photo app, return to the dashboard and refresh assignment status.",
    ])
    pdf.subheading("District 8")
    pdf.text("Open the photo app directly — no dashboard assignment is required.", size=10.5, gap=6)
    pdf.subheading("Everyone")
    pdf.bullet_list([
        "Use the same phone for the entire store visit. Photos stay on that device until submit succeeds.",
        "Allow camera access when prompted.",
        "For schedule changes or assignment questions, contact your supervisor.",
    ])

    pdf.heading("At the store — step by step")
    pdf.numbered_list([
        "Open https://fuel.retail-odyssey.com/fruit-audit, choose your district, and sign in.",
        "Select the FM store you are auditing.",
        "For each fruit set card, find the matching produce table in the store using the commodity, table name, and bay range on the card.",
        "Tap Start 360 Capture. The camera prompts Front, then Right Side, Back, then Left Side.",
        "For each side, stand back far enough to show the full side edge to edge. Long tables may need several photos in about four-foot sections.",
        "Repeat for every set listed for the store.",
        "Add notes if anything is unusual, then tap Submit once and wait for the confirmation screen.",
    ])
    pdf.callout(
        "Do not submit early",
        "The Submit button stays disabled until every listed set has at least one photo for Front, Right Side, Back, and Left Side.",
    )

    pdf.new_page()
    pdf.heading("Real example — FM 023 (District 8)")
    pdf.text(
        "These photos were submitted from Fred Meyer 023 in Bellevue for the 604-BERRIES set on "
        "PRODUCE TABLE 1 (bays 001–004). Use them as the standard for framing and coverage.",
        size=10.5,
        gap=8,
    )
    pdf.subheading("One photo per side — the four required views")
    pdf.image_grid(
        [
            (ASSETS / "Front_01.jpg", "1. Front"),
            (ASSETS / "Right_Side_01.jpg", "2. Right Side"),
            (ASSETS / "Back_01.jpg", "3. Back"),
            (ASSETS / "Left_Side_01.jpg", "4. Left Side"),
        ],
        cols=2,
        cell_w=240,
        cell_h=170,
    )
    pdf.subheading("Long sides — take multiple section photos")
    pdf.text(
        "At FM 023 the front and back of this berry table each used four section photos. "
        "That is normal for wide fixtures. Below are two consecutive front sections.",
        size=10.5,
        gap=6,
    )
    pdf.image_grid(
        [
            (ASSETS / "Front_01.jpg", "Front — section 1"),
            (ASSETS / "Front_02.jpg", "Front — section 2"),
            (ASSETS / "Back_01.jpg", "Back — section 1"),
            (ASSETS / "Back_02.jpg", "Back — section 2"),
        ],
        cols=2,
        cell_w=240,
        cell_h=150,
    )

    pdf.new_page()
    pdf.heading("Quick rules")
    pdf.bullet_list([
        "Photograph every set listed for your store — not just the first table you see.",
        "Get all four sides on each set: Front, Right Side, Back, Left Side.",
        "Walk clockwise around the table and follow the app prompts.",
        "Take extra photos when a side is long, blocked, or hard to read.",
        "Submit once at the end for the whole store, then wait for confirmation.",
        "Do not switch phones mid-store or clear browser data if submit fails.",
    ])

    pdf.heading("If something goes wrong")
    pdf.bullet_list([
        "Bad signal: photos stay on your phone. Move to Wi-Fi or better coverage and tap Submit again.",
        "Store not showing (D1/D6/D7): confirm your dashboard assignment, then refresh in the photo app.",
        "Cannot find a table: note it in the app and contact your supervisor before leaving the store.",
        "Schedule change: contact your supervisor.",
    ])

    pdf.callout(
        "One-sentence summary",
        "Assign your store if needed, open the fruit audit app, walk every listed fruit table and "
        "photograph all four sides (extra section photos on long sides), then submit the store once "
        "and wait for confirmation.",
    )

    pdf.save(OUTPUT)
    return OUTPUT


if __name__ == "__main__":
    out = build()
    print(out)
