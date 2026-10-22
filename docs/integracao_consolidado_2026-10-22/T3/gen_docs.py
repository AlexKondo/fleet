# T3 - gera documentos SINTETICOS (nao sao CNH reais) para testar a preparacao local da CNH.
# Uso: <venv>\python -I gen_docs.py <pasta_saida>    (venv local com pillow, reportlab, pypdf)
import io, os, sys, random
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
MiB = 1024 * 1024
FIELDS = [("1/2 NOME", "T3 TESTE SINTETICO DA SILVA"), ("5 N REGISTRO", "99900011122"), ("9 CAT HAB", "B"),
          ("4a DATA EMISSAO", "10/03/2024"), ("4b VALIDADE", "09/03/2034")]

def font(sz):
    for f in ("arialbd.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()

def card(w, h, noise_amp, tag, blend=0.55):
    """Cartao sintetico com campos em texto grande + ruido (infla o arquivo)."""
    if noise_amp:
        base = Image.effect_noise((w, h), noise_amp).convert("RGB")
        base = Image.blend(base, Image.new("RGB", (w, h), (235, 245, 235)), blend)
    else:
        base = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(base)
    f1, f2 = font(max(18, h // 22)), font(max(14, h // 30))
    d.text((w * 0.05, h * 0.04), "DOCUMENTO SINTETICO - NAO E CNH - " + tag, fill=(170, 0, 0), font=f1)
    y = h * 0.16
    for lab, val in FIELDS:
        d.text((w * 0.06, y), lab, fill=(60, 60, 60), font=f2)
        d.text((w * 0.40, y), val, fill=(0, 0, 0), font=f1)
        y += h * 0.14
    return base

def jpeg_target(img, target):
    """Maior qualidade cujo tamanho fica <= target (sem ultrapassar)."""
    last = None
    for q in range(100, 9, -3):
        b = io.BytesIO(); img.save(b, "JPEG", quality=q, subsampling=0)
        last = b.getvalue()
        if len(last) <= target: return last
    return last

made = {}
def rec(path): made[os.path.basename(path)] = os.path.getsize(path)
def wr(name, data):
    p = os.path.join(OUT, name); open(p, "wb").write(data); rec(p); return p

# --- imagens JPEG (tamanho alvo)
wr("img_1mib.jpg", jpeg_target(card(1600, 1000, 120, "IMG 1MiB"), int(1.0 * MiB)))
wr("img_2_9mib.jpg", jpeg_target(card(2600, 1700, 120, "IMG 2.9MiB"), int(2.9 * MiB)))
wr("img_3_5mib.jpg", jpeg_target(card(3000, 2000, 120, "IMG 3.5MiB"), int(3.5 * MiB)))
wr("img_4_9mib.jpg", jpeg_target(card(3400, 2300, 120, "IMG 4.9MiB"), int(4.9 * MiB)))
wr("img_6mib.jpg", jpeg_target(card(4200, 2800, 120, "IMG 6MiB"), int(7.5 * MiB)))
# JPEG "foto de celular 50 MP" (8160x6120 = 49,9 MP) entre 3 e 5 MiB: excede 24 MP
wr("jpg_50mp_4mib.jpg", jpeg_target(card(8160, 6120, 40, "JPEG 50MP", blend=0.85), int(4.6 * MiB)))
# JPEG 12 MP (4032x3024, padrao de celular) ~4,5 MiB
wr("jpg_12mp_4_5mib.jpg", jpeg_target(card(4032, 3024, 80, "JPEG 12MP", blend=0.7), int(4.6 * MiB)))

# --- PNG
def png_target(w, h, tag, target):
    best = None
    for amp in (2, 4, 8, 12, 16, 24, 32, 48, 64):
        b = io.BytesIO(); card(w, h, amp, tag, blend=0.6).save(b, "PNG", compress_level=6)
        if b.tell() > target: break
        best = b.getvalue()
    return best
wr("png_4_5mib.png", png_target(1950, 1300, "PNG ~4.5MiB", int(4.8 * MiB)) or b"")


# --- invalido
wr("invalido.txt", b"nao sou imagem nem pdf\n")

# --- PDFs com tamanho alvo (imagem JPEG ruidosa embutida por pagina, sem recompressao)
COLORS = [(1, 0, 0), (0, 0.6, 0), (0, 0, 1), (1, 0.5, 0), (0.5, 0, 0.5), (0, 0.6, 0.6), (0.4, 0.4, 0), (0.2, 0.2, 0.2), (0.9, 0.2, 0.6)]
def pdf(name, pages, total=None):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4); W, H = A4
    per = (total / pages) if total else None
    for i in range(1, pages + 1):
        c.setFont("Helvetica-Bold", 16); c.setFillColorRGB(0.7, 0, 0)
        c.drawString(40, H - 50, f"DOCUMENTO SINTETICO - NAO E CNH - PAGINA {i}/{pages}")
        c.setFillColorRGB(0, 0, 0); y = H - 90
        for lab, val in FIELDS:
            c.setFont("Helvetica", 9); c.drawString(50, y, lab)
            c.setFont("Helvetica-Bold", 12); c.drawString(200, y, val); y -= 22
        r, g, b = COLORS[(i - 1) % len(COLORS)]; c.setFillColorRGB(r, g, b); c.rect(0, 0, W, 40, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1); c.setFont("Helvetica-Bold", 22); c.drawString(40, 12, f"MARCADOR PAGINA {i}")
        if per:
            jb = jpeg_target(card(2400, 1500, 120, f"PDF p{i}"), int(per * 0.98))
            c.drawImage(ImageReader(io.BytesIO(jb)), 40, 120, width=W - 80, height=(W - 80) * 1500 / 2400)
        c.showPage()
    c.save(); rec(path); return path

pdf("pdf_1p_pequeno.pdf", 1)
pdf("pdf_3p_pequeno.pdf", 3)
p1 = pdf("pdf_1p_4mib.pdf", 1, 3.9 * MiB)
pdf("pdf_3p_4mib.pdf", 3, 3.9 * MiB)
pdf("pdf_5p_4mib.pdf", 5, 3.9 * MiB)
pdf("pdf_6p_4mib.pdf", 6, 3.9 * MiB)
pdf("pdf_8p_4mib.pdf", 8, 3.9 * MiB)
pdf("pdf_9p_4mib.pdf", 9, 3.9 * MiB)
pdf("pdf_2p_6mib.pdf", 2, 6.2 * MiB)

def protect(src, dst):
    r = PdfReader(src); w = PdfWriter()
    for pg in r.pages: w.add_page(pg)
    w.encrypt(user_password="segredo", owner_password="dono", algorithm="RC4-128")
    with open(os.path.join(OUT, dst), "wb") as f: w.write(f)
    rec(os.path.join(OUT, dst))
protect(p1, "pdf_protegido_4mib.pdf")
protect(os.path.join(OUT, "pdf_1p_pequeno.pdf"), "pdf_protegido_pequeno.pdf")
# PDF corrompido (> 3 MiB, cabecalho valido, segunda metade aleatoria)
b = open(p1, "rb").read(); random.seed(7)
wr("pdf_corrompido_4mib.pdf", b[: len(b) // 2] + bytes(random.getrandbits(8) for _ in range(len(b) - len(b) // 2)))

for k, v in made.items(): print(f"{k}\t{v}\t{v / MiB:.2f} MiB")

