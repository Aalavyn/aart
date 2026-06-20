"""Re-extract maths and science with correct 2024 NCERT chapter names."""
import json, os, sys, fitz

sys.stdout.reconfigure(encoding='utf-8')

NCERT_DIR = r'C:\Users\Admin\Downloads\ncert-class9'
OUTPUT_DIR = r'C:\Users\Admin\.appfog\workspace\umayal-study-coach\data'

subjects_to_fix = {
    'maths': {
        'name': 'Mathematics', 'emoji': '📐',
        'path': 'maths/iemh1dd', 'prefix': 'iemh1',
        'chapters': [
            ('01', 'Orienting Yourself: The Use of Coordinates'),
            ('02', 'Introduction to Linear Polynomials'),
            ('03', 'The World of Numbers'),
            ('04', 'Exploring Algebraic Identities'),
            ('05', "I'm Up and Down, and Round and Round"),
            ('06', 'Measuring Space: Perimeter and Area'),
            ('07', 'The Mathematics of Maybe: Introduction to Probability'),
            ('08', 'Predicting What Comes Next: Exploring Sequences and Progressions'),
        ]
    },
    'science': {
        'name': 'Science', 'emoji': '🔬',
        'path': 'science/iesc1dd', 'prefix': 'iesc1',
        'chapters': [
            ('01', 'Exploration: Entering the World of Secondary Science'),
            ('02', 'Cell: The Building Block of Life'),
            ('03', 'Tissues in Action'),
            ('04', 'Describing Motion'),
            ('05', 'Exploring Mixtures and Their Separation'),
            ('06', 'How Forces Affect Motion'),
            ('07', 'Work, Energy, and Simple Machines'),
            ('08', 'Journey Inside the Atom'),
            ('09', 'Atomic Foundations of Matter'),
            ('10', 'Sound Waves: Characteristics and Applications'),
            ('11', 'Reproduction: How Life Continues'),
            ('12', 'Ecosystem and Food Webs'),
            ('13', 'Earth as a System: Energy, Matter, and Life'),
        ]
    }
}

all_index = json.load(open(os.path.join(OUTPUT_DIR, 'index.json'), 'r', encoding='utf-8'))

for subject_key, config in subjects_to_fix.items():
    name = config['name']
    print(f'Processing {name}...')
    chapters_data = []
    for ch_num, ch_name in config['chapters']:
        pdf_path = os.path.join(NCERT_DIR, config['path'].replace('/', os.sep), config['prefix'] + ch_num + '.pdf')
        if not os.path.exists(pdf_path):
            print(f'  NOT FOUND: {pdf_path}')
            continue
        doc = fitz.open(pdf_path)
        text_parts = []
        for page in doc:
            t = page.get_text()
            if t.strip():
                text_parts.append(t)
        doc.close()
        text = '\n\n'.join(text_parts)
        wc = len(text.split())
        chapters_data.append({'chapter_number': ch_num, 'chapter_name': ch_name, 'text': text, 'word_count': wc})
        print(f'  Ch {ch_num}: {ch_name} ({wc} words)')

    subject_data = {
        'subject': config['name'],
        'emoji': config['emoji'],
        'key': subject_key,
        'total_chapters': len(chapters_data),
        'chapters': chapters_data
    }
    outfile = os.path.join(OUTPUT_DIR, f'{subject_key}.json')
    with open(outfile, 'w', encoding='utf-8') as f:
        json.dump(subject_data, f, ensure_ascii=False, indent=2)

    all_index[subject_key] = {
        'name': config['name'],
        'emoji': config['emoji'],
        'total_chapters': len(chapters_data),
        'chapters': [
            {'number': c['chapter_number'], 'name': c['chapter_name'], 'word_count': c['word_count']}
            for c in chapters_data
        ]
    }
    print(f'  Saved {outfile}')

with open(os.path.join(OUTPUT_DIR, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump(all_index, f, ensure_ascii=False, indent=2)
print('Done! index.json updated.')
