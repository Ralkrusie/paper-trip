"""生成「行程单导出」用的品牌 logo 内嵌数据文件 js/logo-seal.js

- 输入：assets/logo.png（品牌 logo 原图）
- 处理：等比缩放到 92px 高（46px 显示尺寸 x2 高清），PNG 优化后转 base64
- 输出：js/logo-seal.js —— window.ITINERARY_SEAL_URI
  （供 workbench.js 的行程单导出内嵌进单文件 HTML，保证离线可用）

用法（Windows）：
    & d:\\Tools\\TRIP\\.venv\\Scripts\\python.exe tools\\gen_itinerary_seal.py

更换 assets/logo.png 后重新运行本脚本即可。
"""
from pathlib import Path
import base64
import io

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TARGET_HEIGHT = 92  # 46px 显示 × 2x

src = Image.open(ROOT / "assets" / "logo.png").convert("RGBA")
width = max(1, round(src.width * TARGET_HEIGHT / src.height))
resized = src.resize((width, TARGET_HEIGHT), Image.Resampling.LANCZOS)
buf = io.BytesIO()
resized.save(buf, format="PNG", optimize=True)
png_bytes = buf.getvalue()
b64 = base64.b64encode(png_bytes).decode("ascii")

js = (
    "/* 由 tools/gen_itinerary_seal.py 自动生成，请勿手改。\n"
    "   assets/logo.png 缩放至 %dpx 高（46px 显示 x2）的 base64，\n"
    "   供「行程单导出」离线单文件内嵌使用；更换 logo 后重新运行生成脚本。 */\n"
    "window.ITINERARY_SEAL_URI = 'data:image/png;base64,%s';\n"
) % (TARGET_HEIGHT, b64)

out_path = ROOT / "js" / "logo-seal.js"
out_path.write_text(js, encoding="utf-8")
print("logo-seal.js 已生成: %dx%d, png=%dB, base64=%dchars -> %s"
      % (width, TARGET_HEIGHT, len(png_bytes), len(b64), out_path))
