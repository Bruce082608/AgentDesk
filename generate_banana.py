from PIL import Image, ImageDraw, ImageFilter
import math, os

# 创建画布 800x600，浅蓝背景
W, H = 800, 600
img = Image.new('RGB', (W, H), (200, 230, 255))
draw = ImageDraw.Draw(img)

# --- 绘制大香蕉 ---
# 用贝塞尔曲线风格的椭圆+旋转来画香蕉主体
# 香蕉主体：一个弯曲的黄色形状

cx, cy = 400, 320  # 中心

# 方法：用多个重叠椭圆模拟弯曲香蕉
banana_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
banana_draw = ImageDraw.Draw(banana_layer)

# 香蕉主体颜色 (金黄色)
banana_color = (255, 220, 50)
banana_dark = (240, 190, 30)
banana_light = (255, 240, 100)

# 绘制弯曲香蕉 - 使用多个椭圆沿着弧线排列
# 香蕉弯曲中心在左边，两端翘起
points = []
for t in range(0, 101):
    angle = math.radians(-60 + t * 120)  # 从-60度到60度
    r = 220
    x = cx + r * math.sin(angle) * 0.7
    y = cy - r * math.cos(angle) * 0.6
    points.append((int(x), int(y)))

# 绘制香蕉主体用一系列重叠椭圆
for i, (px, py) in enumerate(points):
    if i % 3 == 0:  # 每隔一段画椭圆
        # 椭圆大小随位置变化
        frac = i / 100.0
        if frac < 0.15:
            w, h_ell = 40, 25
        elif frac < 0.3:
            w, h_ell = 70, 45
        elif frac < 0.7:
            w, h_ell = 90, 55
        elif frac < 0.85:
            w, h_ell = 70, 40
        else:
            w, h_ell = 35, 20
        
        banana_draw.ellipse(
            [px - w, py - h_ell, px + w, py + h_ell],
            fill=banana_color
        )

# 香蕉主体高光
for i, (px, py) in enumerate(points):
    if i % 6 == 0:
        frac = i / 100.0
        if 0.2 < frac < 0.8:
            w, h_ell = 55, 30
            banana_draw.ellipse(
                [px - w, py - h_ell - 5, px + w, py + h_ell - 10],
                fill=(255, 235, 80)
            )

# 香蕉暗面（底部边缘）
for i, (px, py) in enumerate(points):
    if i % 5 == 0:
        frac = i / 100.0
        if 0.15 < frac < 0.85:
            w, h_ell = 50, 28
            banana_draw.ellipse(
                [px - w, py - h_ell + 15, px + w, py + h_ell + 10],
                fill=banana_dark
            )

# 合并香蕉到主图
img = Image.alpha_composite(img.convert('RGBA'), banana_layer)

# 重新获取draw用于后续绘制
draw = ImageDraw.Draw(img)

# --- 香蕉蒂（绿色） ---
stem_points_top = points[0]
stem_x, stem_y = stem_points_top
stem_draw = ImageDraw.Draw(img)
# 画香蕉蒂
stem_draw.ellipse([stem_x - 8, stem_y - 40, stem_x + 12, stem_y + 5], fill=(60, 140, 40))
stem_draw.ellipse([stem_x - 12, stem_y - 38, stem_x + 16, stem_y - 10], fill=(80, 160, 50))
# 蒂的暗面
stem_draw.ellipse([stem_x + 5, stem_y - 35, stem_x + 16, stem_y - 8], fill=(40, 110, 30))

# --- 香蕉底部小黑头 ---
tip = points[-1]
tip_x, tip_y = tip
draw.ellipse([tip_x - 6, tip_y - 2, tip_x + 10, tip_y + 10], fill=(60, 40, 10))

# --- 香蕉上的斑点 ---
import random
random.seed(42)
for _ in range(15):
    # 斑点在香蕉主体上
    idx = random.randint(15, 85)
    px, py = points[idx]
    offset_x = random.randint(-30, 30)
    offset_y = random.randint(-20, 20)
    spot_r = random.randint(2, 5)
    spot_color = (180 + random.randint(0, 30), 140 + random.randint(0, 30), 30)
    draw.ellipse(
        [px + offset_x - spot_r, py + offset_y - spot_r,
         px + offset_x + spot_r, py + offset_y + spot_r],
        fill=spot_color
    )

# --- 地面阴影 ---
shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow)
shadow_draw.ellipse([cx - 140, cy + 140, cx + 140, cy + 175], fill=(0, 0, 0, 60))
img = Image.alpha_composite(img, shadow)

# --- 添加文字 ---
from PIL import ImageFont
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 48)
except:
    font = ImageFont.load_default()

# 文字阴影
draw = ImageDraw.Draw(img)
draw.text((402, 42), "🍌 大香蕉 🍌", fill=(0, 0, 0, 180), font=font)
draw.text((400, 40), "🍌 大香蕉 🍌", fill=(255, 200, 30), font=font)

# 保存
output_path = "C:/code/AgentDesk/big_banana.png"
img = img.convert('RGB')
img.save(output_path, quality=95)
print(f"香蕉图片已保存到: {output_path}")
print(f"文件大小: {os.path.getsize(output_path)} bytes")
