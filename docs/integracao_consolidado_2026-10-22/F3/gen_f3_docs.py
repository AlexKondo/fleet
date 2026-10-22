# F3 - gera fotos SINTETICAS (nao sao CNH reais) de 12 MP e 50 MP com ruido, entre 3 e 5 MiB, para D-T3-02.
# Uso: python -I gen_f3_docs.py <pasta_saida>
import io, os, sys, json
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
MiB = 1024 * 1024
FIELDS = [("1/2 NOME", "F3 TESTE SINTETICO DA SILVA"), ("5 N REGISTRO", "99900011122"), ("9 CAT HAB", "B"),
          ("4a DATA EMISSAO", "10/03/2024"), ("4b VALIDADE", "09/03/2034")]
def font(sz):
    for f in ("arialbd.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()
def card(w, h, noise_amp, tag, blend):
    base = Image.effect_noise((w, h), noise_amp).convert("RGB")
    base = Image.blend(base, Image.new("RGB", (w, h), (235, 245, 235)), blend)
    d = ImageDraw.Draw(base); f1, f2 = font(max(18, h // 22)), font(max(14, h // 30))
    d.text((w * 0.05, h * 0.04), "DOCUMENTO SINTETICO - NAO E CNH - " + tag, fill=(170, 0, 0), font=f1)
    y = h * 0.16
    for lab, val in FIELDS:
        d.text((w * 0.06, y), lab, fill=(60, 60, 60), font=f2); d.text((w * 0.40, y), val, fill=(0, 0, 0), font=f1); y += h * 0.14
    return base
def jpeg_target(img, target):
    last = None
    for q in range(100, 9, -2):
        b = io.BytesIO(); img.save(b, "JPEG", quality=q); last = (q, b.getvalue())
        if len(last[1]) <= target: return last
    return last
made = {}
for name, (w, h, amp, blend) in {"f3_12mp_ruido.jpg": (4032, 3024, 120, 0.45), "f3_50mp_ruido.jpg": (8160, 6120, 60, 0.75), "f3_ruido_extremo.jpg": (2400, 2400, 255, 0.0)}.items():
    q, data = jpeg_target(card(w, h, amp, name, blend), int(4.7 * MiB))
    open(os.path.join(OUT, name), "wb").write(data)
    made[name] = {"largura": w, "altura": h, "megapixels": round(w * h / 1e6, 1), "bytes": len(data), "MiB": round(len(data) / MiB, 2), "qualidade_pil": q}
print(json.dumps(made, indent=1))
