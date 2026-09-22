#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为微信小程序生成标记图标资源（纯标准库实现，无需 Pillow）。

产物（写入 miniprogram/assets/）：
    marker-teal.png    交通（青瓷绿）
    marker-blue.png    住宿（黛蓝）
    marker-orange.png  餐饮（橘）
    marker-red.png     活动（朱砂红）
    marker-gray.png    未安排地点（灰绿小圆点，使用时缩小显示）
    arrow.png          流动箭头（白底深描边，指向上方，靠 rotate 旋转）

用法：
    python tools/gen_mini_assets.py
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, '..', 'miniprogram', 'assets')

SS = 3               # 每个像素的子采样数（3×3 超采样抗锯齿）
CIRCLE_SIZE = 96     # 圆形标记画布
ARROW_SIZE = 96      # 箭头画布

WHITE = (248, 250, 238)   # 与网页版纸面白一致
INK = (29, 42, 38)        # 深墨色（箭头描边）

MARKER_COLORS = {
    'marker-teal.png': '#2fa898',
    'marker-blue.png': '#3f7e93',
    'marker-orange.png': '#e8833a',
    'marker-red.png': '#be4a2d',
    'marker-gray.png': '#3f7e73',
}


def clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def soft(d, radius, feather=0.02):
    """距离 d 处半径 radius 的圆形软边覆盖率"""
    return clamp01((radius - d) / feather + 0.5)


def write_png(path, width, height, rows):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            r, g, b, a = rows[y][x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def render(size, sampler):
    """sampler(x, y) -> (rgb, alpha)，x/y 为 0..1 归一化坐标"""
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            acc_r = acc_g = acc_b = 0.0
            acc_a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    color, alpha = sampler(x, y)
                    if alpha > 0:
                        acc_r += color[0] * alpha
                        acc_g += color[1] * alpha
                        acc_b += color[2] * alpha
                    acc_a += alpha
            n = SS * SS
            avg_a = acc_a / n
            if avg_a <= 0.003:
                row.append((0, 0, 0, 0))
            else:
                r = round(acc_r / acc_a)
                g = round(acc_g / acc_a)
                b = round(acc_b / acc_a)
                row.append((r, g, b, max(0, min(255, round(avg_a * 255)))))
        rows.append(row)
    return rows


def hex2rgb(text):
    text = text.lstrip('#')
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


def make_circle_sampler(color):
    """圆形徽标：中心填色圆 + 外侧浅色描边环。"""
    def sampler(x, y):
        d = math.hypot(x - 0.5, y - 0.5)
        a_out = soft(d, 0.475)
        a_fill = soft(d, 0.400)
        if a_out <= 0:
            return ((0, 0, 0), 0.0)
        # 环区 = 外圈减去内圈，颜色在填色与描边白之间混合
        a_ring = max(0.0, a_out - a_fill)
        total = a_fill + a_ring
        r = (color[0] * a_fill + WHITE[0] * a_ring) / total
        g = (color[1] * a_fill + WHITE[1] * a_ring) / total
        b = (color[2] * a_fill + WHITE[2] * a_ring) / total
        return ((r, g, b), a_out)
    return sampler


# 箭头多边形（归一化坐标，竖直向上）：顶点 / 右翼 / 尾槽 / 左翼，形状与网页版一致
ARROW_POINTS = [(0.5, 0.06), (0.79, 0.83), (0.5, 0.66), (0.21, 0.83)]
ARROW_STROKE = 0.055  # 描边半宽（归一化）


def point_in_polygon(x, y, points):
    inside = False
    j = len(points) - 1
    for i in range(len(points)):
        xi, yi = points[i]
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_segment(x, y, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    length_sq = dx * dx + dy * dy
    if length_sq <= 1e-12:
        return math.hypot(x - x1, y - y1)
    t = clamp01(((x - x1) * dx + (y - y1) * dy) / length_sq)
    return math.hypot(x - (x1 + dx * t), y - (y1 + dy * t))


def make_arrow_sampler():
    def sampler(x, y):
        inside = point_in_polygon(x, y, ARROW_POINTS)
        edge = min(
            dist_to_segment(x, y, *ARROW_POINTS[i], *ARROW_POINTS[(i + 1) % len(ARROW_POINTS)])
            for i in range(len(ARROW_POINTS))
        )
        if edge <= ARROW_STROKE:
            return (INK, 1.0)
        if inside:
            return ((255, 253, 246), 1.0)
        return ((0, 0, 0), 0.0)
    return sampler


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    for filename, hex_color in MARKER_COLORS.items():
        rows = render(CIRCLE_SIZE, make_circle_sampler(hex2rgb(hex_color)))
        write_png(os.path.join(OUT_DIR, filename), CIRCLE_SIZE, CIRCLE_SIZE, rows)
        print('已生成', os.path.join('miniprogram', 'assets', filename))

    rows = render(ARROW_SIZE, make_arrow_sampler())
    write_png(os.path.join(OUT_DIR, 'arrow.png'), ARROW_SIZE, ARROW_SIZE, rows)
    print('已生成', os.path.join('miniprogram', 'assets', 'arrow.png'))


if __name__ == '__main__':
    main()
