from flask import jsonify, request, Flask
from flask_cors import CORS
import openai
import os
import dotenv
import pdfplumber
import docx
import fitz
import pytesseract
from PIL import Image
import io
import re

dotenv.load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})

API_KEY = os.getenv("OPENAI_API_KEY")
MODEL_NAME = "llama3"
API_URL = "http://localhost:11434/v1"
client = openai.Client(base_url=API_URL, api_key=API_KEY)

print(f"--- SERVER READY (Model: {MODEL_NAME}) ---")

def sanitize_definition(text):
    REPLACEMENTS = {
        "∞": " infinity ", "±": " plus minus ", "≈": " approximately equal ",
        "~": " similar ", "≠": " not equal ", "≤": " less or equal ",
        "≥": " greater or equal ", "<": " less than ", ">": " greater than ",
        "×": " times ", "÷": " divided by ", "•": " bullet ", "√": " square root ",
        "∛": " cube root ", "∜": " fourth root ", "°": " degrees ",
        "%": " percent ", "‰": " per thousand ",
        "¹": " superscript one ", "²": " squared ", "³": " cubed ",
        "⁰": " superscript zero ", "⁴": " fourth power ", "⁵": " fifth power ",
        "⁶": " sixth power ", "⁷": " seventh power ", "⁸": " eighth power ",
        "⁹": " ninth power ", "⁻": " superscript minus ", "⁺": " superscript plus ",
        "ₙ": " subscript n ", "ᵢ": " subscript i ", "ⱼ": " subscript j ",
        "₀": " subscript zero ", "₁": " subscript one ", "₂": " subscript two ",
        "₃": " subscript three ",
        "∈": " belongs to ", "∉": " not belongs to ", "⊂": " subset of ",
        "⊃": " superset of ", "⊆": " subset or equal ",
        "⊇": " superset or equal ", "∪": " union ", "∩": " intersection ",
        "∅": " empty set ", "∀": " for all ", "∃": " exists ",
        "∄": " not exists ", "∴": " therefore ", "∵": " because ",
        "∧": " and ", "∨": " or ", "¬": " not ",
        "⇔": " if and only if ", "⇒": " implies ", "⇐": " implied by ",
        "∫": " integral ", "∬": " double integral ", "∮": " contour integral ",
        "∂": " partial derivative ", "∆": " delta ", "∇": " nabla ",
        "∑": " sum ", "∏": " product ",
        "→": " right arrow ", "←": " left arrow ", "↑": " up arrow ",
        "↓": " down arrow ", "↔": " left right arrow ",
        "↕": " up down arrow ", "↦": " maps to ",
        "α": " alpha ", "β": " beta ", "γ": " gamma ", "δ": " delta ",
        "ε": " epsilon ", "ζ": " zeta ", "η": " eta ", "θ": " theta ",
        "ι": " iota ", "κ": " kappa ", "λ": " lambda ", "μ": " mu ",
        "ν": " nu ", "ξ": " xi ", "ο": " omicron ", "π": " pi ",
        "ρ": " rho ", "σ": " sigma ", "τ": " tau ", "υ": " upsilon ",
        "φ": " phi ", "χ": " chi ", "ψ": " psi ", "ω": " omega ",
        "Γ": " Gamma ", "Δ": " Delta ", "Θ": " Theta ", "Λ": " Lambda ",
        "Ξ": " Xi ", "Π": " Pi ", "Σ": " Sigma ", "Φ": " Phi ",
        "Ψ": " Psi ", "Ω": " Omega ",
        "€": " euro ", "£": " pound ", "¥": " yen ", "$": " dollar ",
        "¢": " cent ", "©": " copyright ", "®": " registered ",
        "™": " trademark ", "…": " ellipsis ", "†": " dagger ",
        "‡": " double dagger ", "§": " section ", "¶": " paragraph ",
    }
    
    ALLOWED_CHARS = (
        "abcdefghijklmnopqrstuvwxyzáéíóúüñ"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑ"
        "àèìòùâêîôûäëïöçãõ"
        "ÀÈÌÒÙÂÊÎÔÛÄËÏÖÇÃÕ"
        "0123456789"
        " \t\n"
        "()[]{}<>+-*/=.,;:?!_'¡¿-"
        "¿¡@#$%&€£"
        r"\|`~^ºª·"
    )
    
    for symbol, replacement in REPLACEMENTS.items():
        text = text.replace(symbol, replacement)
    
    text = ''.join(char for char in text if char in ALLOWED_CHARS)
    return text

def parse_toon(text):
    print(f"--- Parsing TOON Response ({len(text)} chars)...")
    
    text = text.strip()
    if not text:
        print("!!! Empty response")
        return []
    
    concepts = []
    
    # Method 1: Strict TOON format
    pattern = r'concept:\s*(.+?)\s*\n\s*definition:\s*(.+?)\s*(?=---|concept:|\Z)'
    matches = re.finditer(pattern, text, re.DOTALL | re.IGNORECASE)
    
    for match in matches:
        titulo = match.group(1).strip()
        definicion = match.group(2).strip()
        
        titulo = re.sub(r'\s+', ' ', titulo)
        definicion = re.sub(r'\s+', ' ', definicion)
        
        if len(titulo) >= 2 and len(definicion) >= 10:
            concepts.append({
                "titulo": titulo,
                "definicion": sanitize_definition(definicion)
            })
    
    # Method 2: Fallback - extract from any structured text
    if not concepts:
        concepts = extract_from_any_text(text)
    
    print(f"--- SUCCESS: {len(concepts)} concepts extracted")
    return concepts

def extract_from_any_text(text):
    """Fallback method to extract concepts from ANY text format"""
    concepts = []
    lines = text.split('\n')
    
    current_concept = None
    current_definition = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Skip obvious headers and metadata
        if any(header in line.lower() for header in ['version', 'abstract', 'introduction', 'conclusion', 'references', 'acknowledg']):
            continue
            
        # Look for concept patterns
        if (len(line) > 10 and len(line) < 150 and 
            not line.startswith('*') and not line.startswith('-') and
            not line.startswith('**') and not line.endswith('**') and
            not line.isupper() and ':' not in line and
            not any(word in line.lower() for word in ['pass', 'minutes', 'hours'])):
            
            # If we have a previous concept, save it
            if current_concept and current_definition:
                definition_text = ' '.join(current_definition)
                if len(definition_text) >= 10:
                    concepts.append({
                        "titulo": current_concept,
                        "definicion": sanitize_definition(definition_text)
                    })
            
            # Start new concept
            current_concept = line
            current_definition = []
            
        # Collect definition lines
        elif current_concept and line:
            # Skip bullet points and markdown
            if not line.startswith('*') and not line.startswith('-') and not line.startswith('['):
                current_definition.append(line)
    
    # Don't forget the last concept
    if current_concept and current_definition:
        definition_text = ' '.join(current_definition)
        if len(definition_text) >= 10:
            concepts.append({
                "titulo": current_concept,
                "definicion": sanitize_definition(definition_text)
            })
    
    return concepts

def chunk_text_with_overlap(text, chunk_size=6000, overlap=500):
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + chunk_size
        if end < text_len:
            boundary = text.rfind(' ', start, end)
            if boundary != -1 and boundary > start + int(chunk_size * 0.8):
                end = boundary
        
        chunks.append(text[start:end])
        start = end - overlap 
        if start >= end:
            start = end
            
    return chunks

def get_ai_concepts(client, chunk, max_retries=3):
    """Multiple strategies to get concepts from AI"""
    
    strategies = [
        # Strategy 1: Ultra-strict format
        """OUTPUT MUST BE:
concept: [Name]
definition: [Description]
---
concept: [Name] 
definition: [Description]
---
NO OTHER TEXT. START NOW:""",
        
        # Strategy 2: Simple command
        """Extract 10 key concepts in this format:
concept: name
definition: description
---""",
        
        # Strategy 3: Direct command
        """List main concepts as:
concept: Concept Name
definition: Explanation here
---"""
    ]
    
    for attempt in range(max_retries):
        strategy = strategies[attempt % len(strategies)]
        
        try:
            prompt = f"""EXTRACT KEY CONCEPTS FROM THIS TEXT. {strategy}

TEXT:
{chunk}"""

            response = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=MODEL_NAME,
                temperature=0.1,
                max_tokens=3000
            )
            
            response_text = str(response.choices[0].message.content)
            print(f"--- ATTEMPT {attempt + 1} RESPONSE ---")
            print(response_text)
            print("--- END RESPONSE ---")
            
            concepts = parse_toon(response_text)
            if concepts:
                return concepts
                
        except Exception as e:
            print(f"!!! AI Error: {e}")
    
    return []

@app.route('/api/analizar', methods=['POST'])
def analizar():
    file = request.files.get('file')
    if not file:
        return jsonify({"error": "No file"}), 400
    
    print(f"\n>>> File Received: {file.filename}")
    text = ""
    
    try:
        if file.filename.endswith('.pdf'):
            file.seek(0)
            with pdfplumber.open(file) as pdf:
                for page in pdf.pages:
                    pt = page.extract_text()
                    if pt:
                        text += pt + "\n"
            
            if len(text.strip()) < 100:
                print("--- PLAN B: Activating OCR ---")
                text = "" 
                file.seek(0)
                with fitz.open(stream=file.read(), filetype="pdf") as doc_fitz:
                    for page_num in range(len(doc_fitz)):
                        page = doc_fitz.load_page(page_num)
                        images = page.get_images(full=True)
                        if not images: 
                            try:
                                pix = page.get_pixmap()
                                img_data = pix.tobytes("png")
                                pil_img = Image.open(io.BytesIO(img_data))
                                text += pytesseract.image_to_string(pil_img, lang="eng+spa") + "\n"
                            except:
                                pass
                        else:
                            for img in images:
                                try:
                                    xref = img[0]
                                    base = doc_fitz.extract_image(xref)
                                    pil_img = Image.open(io.BytesIO(base["image"]))
                                    text += pytesseract.image_to_string(pil_img, lang="eng+spa") + "\n"
                                except:
                                    pass
        
        elif file.filename.endswith('.docx'):
            doc = docx.Document(file)
            for para in doc.paragraphs:
                text += para.text + "\n"
        elif file.filename.endswith('.txt'):
            text = file.read().decode('utf-8')
            
    except Exception as e:
        print(f"!!! Read Error: {e}")
        return jsonify({"error": str(e)}), 500

    if not text.strip():
        return jsonify({"error": "Empty text extracted"}), 400
    
    # If AI fails completely, extract concepts directly from text
    if len(text) > 5000:
        text = text[:5000]  # Limit text size
    
    chunks = chunk_text_with_overlap(text)
    all_concepts = []
    
    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        print(f"--- Processing Chunk {i+1}/{len(chunks)} ---")
        
        concepts = get_ai_concepts(client, chunk)
        all_concepts.extend(concepts)
    
    # If AI completely failed, use direct text extraction
    if not all_concepts:
        print("--- USING FALLBACK EXTRACTION ---")
        all_concepts = extract_from_any_text(text)
    
    # Remove duplicates
    unique_concepts = []
    seen_titles = set()
    for concept in all_concepts:
        if concept["titulo"] not in seen_titles:
            unique_concepts.append(concept)
            seen_titles.add(concept["titulo"])
    
    print(f"\n=== FINAL RESULT: {len(unique_concepts)} total concepts ===\n")
    
    if len(unique_concepts) == 0:
        return jsonify({"error": "No concepts extracted from file"}), 400
    
    return jsonify({"concepts": unique_concepts})

if __name__ == '__main__':
    app.run(debug=True, port=5000)