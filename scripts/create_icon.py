from pathlib import Path
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parents[1] / 'assets'
output.mkdir(exist_ok=True)
icon = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((8, 8, 248, 248), radius=64, fill='#37313B')
for x, height in ((66, 56), (106, 112), (146, 80), (186, 136)):
    draw.rounded_rectangle((x - 10, 128 - height // 2, x + 10, 128 + height // 2), radius=10, fill='#F3E8D8')
icon.save(output / 'app-icon.png')
icon.save(output / 'app-icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
