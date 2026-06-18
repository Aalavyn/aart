"""
Extract text from NCERT Class 9 PDFs and save as structured JSON.
Uses PyMuPDF (fitz) for PDF text extraction.
"""
import json
import os
import re
import fitz  # PyMuPDF

NCERT_DIR = r"C:\Users\Admin\Downloads\ncert-class9"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data")

# Subject configuration: folder name -> (display name, subfolder pattern, chapter prefix, num chapters)
SUBJECTS = {
    "maths": {
        "name": "Mathematics",
        "emoji": "📐",
        "path": "maths/iemh1dd",
        "prefix": "iemh1",
        "chapters": [
            ("01", "Number Systems"),
            ("02", "Polynomials"),
            ("03", "Coordinate Geometry"),
            ("04", "Linear Equations in Two Variables"),
            ("05", "Introduction to Euclid's Geometry"),
            ("06", "Lines and Angles"),
            ("07", "Triangles"),
            ("08", "Quadrilaterals"),
        ],
    },
    "science": {
        "name": "Science",
        "emoji": "🔬",
        "path": "science/iesc1dd",
        "prefix": "iesc1",
        "chapters": [
            ("01", "Matter in Our Surroundings"),
            ("02", "Is Matter Around Us Pure"),
            ("03", "Atoms and Molecules"),
            ("04", "Structure of the Atom"),
            ("05", "The Fundamental Unit of Life"),
            ("06", "Tissues"),
            ("07", "Motion"),
            ("08", "Force and Laws of Motion"),
            ("09", "Gravitation"),
            ("10", "Work and Energy"),
            ("11", "Sound"),
            ("12", "Improvement in Food Resources"),
            ("13", "Why Do We Fall Ill"),
        ],
    },
    "english": {
        "name": "English (Beehive)",
        "emoji": "📖",
        "path": "english/iebe1dd",
        "prefix": "iebe1",
        "chapters": [
            ("01", "The Fun They Had"),
            ("02", "The Sound of Music"),
            ("03", "The Little Girl"),
            ("04", "A Truly Beautiful Mind"),
            ("05", "The Snake and the Mirror"),
            ("06", "My Childhood"),
            ("07", "Packing"),
            ("08", "Reach for the Top"),
        ],
    },
    "hindi": {
        "name": "Hindi (Ganga)",
        "emoji": "📝",
        "path": "hindi/ihga1dd",
        "prefix": "ihga1",
        "chapters": [
            ("01", "गणित की बोध गंगा - पाठ 1"),
            ("02", "पाठ 2"),
            ("03", "पाठ 3"),
            ("04", "पाठ 4"),
            ("05", "पाठ 5"),
            ("06", "पाठ 6"),
            ("07", "पाठ 7"),
            ("08", "पाठ 8"),
            ("09", "पाठ 9"),
            ("10", "पाठ 10"),
            ("11", "पाठ 11"),
            ("12", "पाठ 12"),
        ],
    },
    "health-pe": {
        "name": "Health & Physical Education",
        "emoji": "🏃",
        "path": "health-pe/iehp1dd",
        "prefix": "iehp1",
        "chapters": [
            ("01", "Unit 1"),
            ("02", "Unit 2"),
            ("03", "Unit 3"),
            ("04", "Unit 4"),
            ("05", "Unit 5"),
            ("06", "Unit 6"),
        ],
    },
    "sst-history": {
        "name": "Social Science - History",
        "emoji": "🏛️",
        "path": "sst-history",
        "prefix": "ch",
        "chapters": [
            ("01", "The French Revolution"),
            ("02", "Socialism in Europe and the Russian Revolution"),
            ("03", "Nazism and the Rise of Hitler"),
            ("04", "Forest Society and Colonialism"),
            ("05", "Pastoralists in the Modern World"),
        ],
    },
    "sst-geography": {
        "name": "Social Science - Geography",
        "emoji": "🌍",
        "path": "sst-geography",
        "prefix": "ch",
        "chapters": [
            ("01", "India – Size and Location"),
            ("02", "Physical Features of India"),
            ("03", "Drainage"),
            ("04", "Climate"),
            ("05", "Natural Vegetation and Wild Life"),
            ("06", "Population"),
        ],
    },
    "sst-civics": {
        "name": "Social Science - Civics",
        "emoji": "⚖️",
        "path": "sst-civics",
        "prefix": "ch",
        "chapters": [
            ("01", "What is Democracy? Why Democracy?"),
            ("02", "Constitutional Design"),
            ("03", "Electoral Politics"),
            ("04", "Working of Institutions"),
            ("05", "Democratic Rights"),
        ],
    },
    "sst-economics": {
        "name": "Social Science - Economics",
        "emoji": "💰",
        "path": "sst-economics",
        "prefix": "ch",
        "chapters": [
            ("01", "The Story of Village Palampur"),
            ("02", "People as Resource"),
            ("03", "Poverty as a Challenge"),
            ("04", "Food Security in India"),
        ],
    },
    "telugu": {
        "name": "Telugu (SCERT)",
        "emoji": "🔤",
        "path": None,  # Single file
        "single_file": "telugu-scert.pdf",
        "chapters": [
            ("01", "Telugu - Full Book"),
        ],
    },
}


def extract_pdf_text(pdf_path: str) -> str:
    """Extract all text from a PDF file."""
    try:
        doc = fitz.open(pdf_path)
        text_parts = []
        for page in doc:
            text = page.get_text()
            if text.strip():
                text_parts.append(text)
        doc.close()
        return "\n\n".join(text_parts)
    except Exception as e:
        print(f"  ⚠ Error extracting {pdf_path}: {e}")
        return ""


def extract_all():
    """Extract text from all NCERT PDFs and save as JSON."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    all_subjects = {}

    for subject_key, config in SUBJECTS.items():
        print(f"\n📚 Processing: {config['name']}")
        chapters_data = []

        for ch_num, ch_name in config["chapters"]:
            if config.get("single_file"):
                pdf_path = os.path.join(NCERT_DIR, config["single_file"])
            else:
                filename = f"{config['prefix']}{ch_num}.pdf"
                pdf_path = os.path.join(NCERT_DIR, config["path"], filename)

            if not os.path.exists(pdf_path):
                print(f"  ⚠ Not found: {pdf_path}")
                continue

            print(f"  📄 Chapter {ch_num}: {ch_name}")
            text = extract_pdf_text(pdf_path)

            if text:
                chapters_data.append({
                    "chapter_number": ch_num,
                    "chapter_name": ch_name,
                    "text": text,
                    "word_count": len(text.split()),
                })
                print(f"     ✅ {len(text.split())} words extracted")
            else:
                print(f"     ❌ No text extracted")

        subject_data = {
            "subject": config["name"],
            "emoji": config["emoji"],
            "key": subject_key,
            "total_chapters": len(chapters_data),
            "chapters": chapters_data,
        }

        # Save per-subject JSON
        subject_file = os.path.join(OUTPUT_DIR, f"{subject_key}.json")
        with open(subject_file, "w", encoding="utf-8") as f:
            json.dump(subject_data, f, ensure_ascii=False, indent=2)
        print(f"  💾 Saved: {subject_file}")

        all_subjects[subject_key] = {
            "name": config["name"],
            "emoji": config["emoji"],
            "total_chapters": len(chapters_data),
            "chapters": [
                {"number": c["chapter_number"], "name": c["chapter_name"], "word_count": c["word_count"]}
                for c in chapters_data
            ],
        }

    # Save index
    index_file = os.path.join(OUTPUT_DIR, "index.json")
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(all_subjects, f, ensure_ascii=False, indent=2)
    print(f"\n📋 Index saved: {index_file}")
    print(f"✅ Done! Extracted {sum(s['total_chapters'] for s in all_subjects.values())} chapters across {len(all_subjects)} subjects.")


if __name__ == "__main__":
    extract_all()
