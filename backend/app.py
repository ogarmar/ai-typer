from flask import jsonify, request, Flask
from flask_cors import CORS
import os
import json
import pdfplumber
import docx
import fitz
import pytesseract
from PIL import Image
import io
import re
from huggingface_hub import hf_hub_download
from llama_cpp import Llama

# Importación condicional de TOML
try:
    import tomllib
except ImportError:
    import tomli as tomllib

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

print("--- 🚀 INICIANDO SERVIDOR ULTRA-LIGHT... ---")

# 1. MODELO ULTRA-LIGERO: Qwen2.5-1.5B-Instruct (Quantized)
# Pesa solo ~1GB y es rapidísimo en CPU.
REPO_ID = "bartowski/Qwen2.5-1.5B-Instruct-GGUF"
FILENAME = "Qwen2.5-1.5B-Instruct-Q6_K.gguf" # Calidad Q6 para compensar el tamaño pequeño

print(f"--- Descargando {FILENAME}... ---")
try:
    model_path = hf_hub_download(
        repo_id=REPO_ID, 
        filename=FILENAME
    )
    print(f"--- Modelo descargado en: {model_path} ---")
except Exception as e:
    print(f"Error descargando modelo: {e}")
    # Fallback si falla la descarga
    model_path = "" 

# 2. CARGAR MOTOR
# Ajustamos el contexto a 4096 (Qwen soporta más, pero esto es suficiente y rápido)
llm = None
if model_path:
    try:
        llm = Llama(
            model_path=model_path,
            n_ctx=4096, 
            n_threads=4,       
            verbose=False
        )
        print(f"--- ✅ MOTOR QWEN LISTO ---")
    except Exception as e:
        print(f"Error cargando el modelo: {e}")
else:
    print("Warning: No se pudo cargar el modelo. Las funciones de IA no estarán disponibles.")


# --- HERRAMIENTAS ---

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


def extract_toon_safely(text):
    """Extrae formato TOON."""
    concepts = []
    # Regex flexible para Qwen (a veces añade espacios extra)
    pattern = r'\[\[CONCEPT\]\]\s*TITLE:\s*(.*?)\s*DEF:\s*(.*?)\s*\[\[END\]\]'
    matches = re.finditer(pattern, text, re.DOTALL)
    
    for match in matches:
        title = match.group(1).strip()
        definition = match.group(2).strip()
        if title and definition:
            concepts.append({
                "titulo": title,
                "definicion": sanitize_definition(definition)
            })
    return concepts

def chunk_text(text, chunk_size=3000, overlap=200):
    # Chunk más pequeño para el modelo pequeño = Más velocidad de respuesta
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end < len(text):
            boundary = text.rfind('.', start, end)
            if boundary == -1: boundary = text.rfind('\n', start, end)
            if boundary != -1 and boundary > start + (chunk_size * 0.7): end = boundary + 1
        chunks.append(text[start:end])
        start = end - overlap
        if start >= end: start = end
    return chunks

@app.route('/api/analizar', methods=['POST'])
def analizar():
    file = request.files.get('file')
    if not file: return jsonify({"error": "No file"}), 400
    
    print(f"\n>>> Procesando: {file.filename}")
    text = ""
    
    try:
        # Lógica de lectura
        if file.filename.endswith('.pdf'):
            with pdfplumber.open(file) as pdf:
                for page in pdf.pages: text += (page.extract_text() or "") + "\n"
            
            # OCR Simple
            if len(text.strip()) < 50:
                print("--- Activando OCR ---")
                file.seek(0)
                doc = fitz.open(stream=file.read(), filetype="pdf")
                for page in doc:
                    text += page.get_text() + "\n"
                    if len(text) < 50: # Fallback a Tesseract si es necesario
                        try:
                            pix = page.get_pixmap()
                            img = Image.open(io.BytesIO(pix.tobytes("png")))
                            text += pytesseract.image_to_string(img) + "\n"
                        except: pass

        elif file.filename.endswith('.docx'):
            doc = docx.Document(file)
            for p in doc.paragraphs: text += p.text + "\n"
        elif file.filename.endswith('.txt'):
            text = file.read().decode('utf-8')
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if not text.strip(): return jsonify({"error": "No text found"}), 400
    
    # --- PROCESAMIENTO IA ---
    if not llm:
        return jsonify({"error": "Model not loaded. Cannot process text."}), 500

    chunks = chunk_text(text)
    all_concepts = []
    
    # Prompt ajustado para Qwen (formato ChatML)
    PROMPT = """You are a professor. Extract key concepts from the text.
RULES:
1. Keep definitions SHORT and CONCISE.
2. Output in the SAME language as the text.
3. Use this format EXACTLY:

[[CONCEPT]]
TITLE: Concept Name
DEF: Short definition
[[END]]
"""

    for i, chunk in enumerate(chunks):
        print(f"--- Analizando parte {i+1}/{len(chunks)} ---")
        
        try:
            output = llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": PROMPT},
                    {"role": "user", "content": f"TEXT:\n{chunk}"}
                ],
                max_tokens=1024,
                temperature=0.2,
            )
            
            response = output['choices'][0]['message']['content']
            concepts = extract_toon_safely(response)
            all_concepts.extend(concepts)
            
        except Exception as e:
            print(f"Error IA: {e}")

    # Eliminar duplicados
    unique_concepts = {c['titulo']: c for c in all_concepts}.values()
    
    return jsonify({"concepts": list(unique_concepts)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000) # Usamos puerto 5000 por defecto para desarrollo local