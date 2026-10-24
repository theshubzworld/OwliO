"""Export the approved Owlio artwork into Windows and logo formats."""
from base64 import b64encode
from pathlib import Path
from PIL import Image

brand = Path(__file__).resolve().parents[1] / 'assets' / 'brand'
mark = Image.open(brand / 'owlio-mark.png').convert('RGBA')
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
for size in sizes + [512]:
    mark.resize((size, size), Image.Resampling.LANCZOS).save(brand / f'owlio-icon-{size}.png')
mark.resize((256, 256), Image.Resampling.LANCZOS).save(brand / 'owlio-icon.png')
mark.save(brand / 'owlio.ico', sizes=[(size, size) for size in sizes])

encoded = b64encode((brand / 'owlio-icon-512.png').read_bytes()).decode('ascii')
logo = f'''<svg xmlns="http://www.w3.org/2000/svg" width="720" height="220" viewBox="0 0 720 220" role="img" aria-labelledby="title">
  <title id="title">Owlio logo</title>
  <image href="data:image/png;base64,{encoded}" x="10" y="10" width="200" height="200"/>
  <text x="242" y="148" fill="#58313F" font-family="Segoe UI Variable, Segoe UI, sans-serif" font-size="120" font-weight="700" letter-spacing="-5">Owlio</text>
</svg>
'''
(brand / 'owlio-logo.svg').write_text(logo, encoding='utf-8')

ico = Image.open(brand / 'owlio.ico')
assert ico.ico.sizes() == {(size, size) for size in sizes}
assert mark.getextrema()[3] == (0, 255), 'Artwork must retain transparency'
print('Exported transparent PNGs, Owlio logo SVG and Windows ICO with sizes:', sizes)
