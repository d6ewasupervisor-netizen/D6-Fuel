"""
pick_winners.py

Walks all UPC folders under kroger_pog_images/, scores each angle image
with Qwen2.5-VL-7B (via local LM Studio server), and copies the highest-
scoring image into kroger_pog_images/winner/<UPC>.jpg.

- Single-image folders are auto-kept (no API call).
- Already-processed UPCs are skipped (resumable).
- All scores logged to winner/_scores.csv.
"""

import base64
import csv
import json
import shutil
from pathlib import Path

import requests

# === CONFIG ===
ROOT = Path(r"C:\Users\tgaut\OneDrive\Documents\GitHub\P03W3_Vitamins\kroger_pog_images")
WINNER_DIR = ROOT / "winner"
SCORES_CSV = WINNER_DIR / "_scores.csv"
API_URL = "http://localhost:1234/v1/chat/completions"
MODEL = "qwen2.5-vl-7b-instruct"
TIMEOUT = 60  # seconds per image
TEST_LIMIT = 0  # set to 0 to process all UPC folders; >0 to limit for testing

PROMPT = """You are evaluating a product image to pick the best "hero shot" for a planogram reference.

The IDEAL image shows the FRONT of the package: brand logo, product name, and hero imagery (the photo/illustration the brand uses to sell the product). It should be the full package on a clean studio background, with NO retailer overlays added on top (banners, sidebars, sale badges, weight callouts that float outside the package itself).

Score 0-100:

90-100: Front of package, full bag/box visible, clean background, no retailer overlays. Brand name and product name clearly readable on the package.

60-89: Front of package but partially obscured by a retailer overlay (sidebar banner, weight badge floating outside the package), OR a slight angle/side view that still shows brand and product name.

30-59: Side angle, top-down, or partial view of the package. Brand visible but not the marketing front.

0-29: Back of package (ingredients, nutrition facts, barcode), close-up of food contents only, lifestyle scene, marketing tile with no package, or any image where the front-of-package design is not the subject.

Reply with JSON only, no other text:
{"score": <integer 0-100>, "reason": "<one short sentence>"}"""

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def encode_image(path: Path) -> str:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    ext = path.suffix.lower().lstrip(".")
    if ext == "jpg":
        ext = "jpeg"
    return f"data:image/{ext};base64,{b64}"


def score_image(path: Path) -> tuple[int, str]:
    try:
        data_url = encode_image(path)
        payload = {
            "model": MODEL,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            "max_tokens": 200,
            "temperature": 0,
        }
        r = requests.post(API_URL, json=payload, timeout=TIMEOUT)
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        parsed = json.loads(content)
        return int(parsed["score"]), str(parsed.get("reason", ""))
    except Exception as e:
        return -1, f"ERROR: {e}"


def get_upc_from_folder(folder_name: str) -> str:
    return folder_name.split("_", 1)[0]


def find_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


def pick_fallback(images: list[Path]) -> Path:
    for img in images:
        if "FEATURED" in img.name.upper():
            return img
    return images[0]


def process_upc_folder(folder: Path, scores_writer) -> None:
    upc = get_upc_from_folder(folder.name)
    output_path = WINNER_DIR / f"{upc}.jpg"

    if output_path.exists():
        print(f"  [skip] {upc} already done")
        return

    images = find_images(folder)
    if not images:
        print(f"  [warn] {upc}: no images found")
        return

    if len(images) == 1:
        shutil.copy2(images[0], output_path)
        scores_writer.writerow([upc, images[0].name, "AUTO", "single image"])
        print(f"  [auto] {upc} -> {images[0].name} (only one)")
        return

    results = []
    for img in images:
        score, reason = score_image(img)
        results.append((score, img, reason))
        scores_writer.writerow([upc, img.name, score, reason])
        print(f"    {img.name}: {score}  ({reason[:60]})")

    valid = [r for r in results if r[0] >= 0]
    if valid:
        winner_score, winner_img, _ = max(valid, key=lambda x: x[0])
        shutil.copy2(winner_img, output_path)
        print(f"  [win]  {upc} -> {winner_img.name} (score {winner_score})")
    else:
        fallback = pick_fallback(images)
        shutil.copy2(fallback, output_path)
        print(f"  [fall] {upc} -> {fallback.name} (all scoring failed)")


def main():
    WINNER_DIR.mkdir(parents=True, exist_ok=True)

    upc_folders = []
    for planogram in sorted(ROOT.iterdir()):
        if planogram.is_dir() and planogram.name != "winner":
            for upc_folder in sorted(planogram.iterdir()):
                if upc_folder.is_dir():
                    upc_folders.append(upc_folder)

    if TEST_LIMIT > 0:
        upc_folders = upc_folders[:TEST_LIMIT]
        print(f"TEST MODE: processing only first {TEST_LIMIT} UPC folders")

    print(f"Found {len(upc_folders)} UPC folders to process\n")

    new_csv = not SCORES_CSV.exists()
    with open(SCORES_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_csv:
            writer.writerow(["upc", "image", "score", "reason"])

        for i, folder in enumerate(upc_folders, 1):
            print(f"[{i}/{len(upc_folders)}] {folder.parent.name}/{folder.name}")
            try:
                process_upc_folder(folder, writer)
                f.flush()
            except Exception as e:
                print(f"  [err] {folder.name}: {e}")

    print(f"\nDone. Winners in: {WINNER_DIR}")
    print(f"Score log: {SCORES_CSV}")


if __name__ == "__main__":
    main()