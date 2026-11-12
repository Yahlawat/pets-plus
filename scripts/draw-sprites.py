"""Render the original Pets+ sprites from the species and animations in the manifest."""

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "media" / "pets"
INK = "#242033"
CREAM = "#ffe4b3"
ROSE = "#f18da3"
GOLD = "#ffc864"
COLORS = {
    "akita": "#d6965b", "beige": "#d9b68d", "black": "#59617a", "blue": "#5aafdc",
    "brown": "#b87550", "gray": "#939cad", "green": "#6cba86", "lightbrown": "#dca16c",
    "magical": "#b48ce6", "orange": "#f1a052", "pink": "#eb9bbb", "purple": "#aa83db",
    "red": "#ed765c", "warrior": "#a7b4ce", "white": "#ececf5", "yellow": "#f8cd66",
}


def shade(color, target, fraction):
    channels = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(c * (1 - fraction) + target * fraction):02x}" for c in channels)


def sprite(species, variant, animation, frame):
    image = Image.new("RGBA", (32, 32))
    draw = ImageDraw.Draw(image)
    base = COLORS[variant.rsplit("_", 1)[-1] if variant.startswith(("paint_", "socks_")) else variant.split("_")[0]]
    dark = shade(base, 28, 0.29)
    light = shade(base, 255, 0.42)
    rest = animation in {"lie", "wallnap"}
    moving = animation in {"walk", "walk_fast", "run", "wallclimb", "with_ball"}
    height = 3 if rest else -(frame % 2) if moving else 0
    if animation == "jump":
        height = [0, -2, -3, -1][frame % 4]
    step = [0, 2, 0, -1][frame % 4] if moving else 0
    blink = rest or (animation == "idle" and frame == 6)

    def box(x, y, w, h, fill):
        draw.rectangle((x, y + height, x + w - 1, y + height + h - 1), fill=fill)

    def oval(x, y, w, h, fill, line=INK):
        draw.ellipse((x, y + height, x + w - 1, y + height + h - 1), fill=fill, outline=line)

    def poly(points, fill, line=INK):
        draw.polygon([(x, y + height) for x, y in points], fill=fill, outline=line)

    def eyes(x, y):
        box(x, y + int(blink), 3 if blink else 2, 1 if blink else 3, INK)
        if not blink:
            box(x, y, 1, 1, CREAM)

    def feet(x1=10, x2=19):
        if not rest:
            box(x1 - step, 24, 4, 5, dark)
            box(x2 + step, 24, 4, 5, INK)
            box(x2 + step, 25, 3, 3, light if variant.startswith("socks_") else base)
        if animation == "swipe":
            oval(22 + frame % 2, 22, 6, 4, light)

    def furry():
        if species in {"cat", "fox", "raccoon", "squirrel", "rat", "monkey", "dog", "horse"}:
            tip = frame % 3 - 1
            if species == "squirrel":
                oval(2, 7 + tip, 12, 17, dark)
                oval(4, 9 + tip, 6, 10, base, dark)
            elif species in {"fox", "raccoon"}:
                poly([(12, 23), (5, 23), (1, 19 + tip), (2, 13 + tip), (7, 16 + tip), (13, 19)], dark)
                box(2, 17 + tip, 4, 3, light)
                if species == "raccoon":
                    box(7, 17 + tip, 2, 5, INK)
            else:
                poly([(12, 24), (6, 24), (3, 20 + tip), (3, 15 + tip), (5, 15 + tip), (7, 21), (13, 21)], dark)
        if species == "bunny":
            oval(4, 21, 7, 7, CREAM)

        feet()
        oval(7, 17 if rest else 16, 17, 10 if rest else 12, base)
        if variant.startswith("paint_") or species in {"fox", "dog", "panda"}:
            oval(10, 19, 8, 6, light, light)
        y = 17 if rest else 12
        if species == "horse":
            poly([(16, 24), (16, y - 3), (21, y - 6), (25, y - 4), (28, y + 4), (27, y + 8), (22, y + 8), (20, 24)], base)
            box(17, y - 2, 3, 11, dark)
            box(24, y + 5, 4, 2, light)
            if variant == "magical":
                poly([(23, y - 4), (28, y - 9), (27, y - 3)], GOLD)
            eyes(23, y)
            return
        if species in {"cat", "fox"}:
            poly([(15, y + 7), (15, y - 5), (21, y), (25, y), (29, y - 4), (29, y + 9), (25, y + 13), (20, y + 13)], base)
            poly([(17, y - 2), (17, y + 3), (20, y + 1)], ROSE, ROSE)
            box(27, y + 6, 3, 2, light)
        elif species == "bunny":
            oval(16, y - 8, 5, 13, base)
            oval(22, y - 9, 5, 15, base)
            box(24, y - 6, 1, 5, ROSE)
            oval(15, y, 14, 13, base)
        else:
            oval(15, y, 14, 13, CREAM if species == "panda" else base)
            if species == "dog":
                oval(14, y, 6, 10, dark)
                oval(23, y + 6, 8, 6, light)
            elif species in {"rat", "squirrel", "panda", "monkey"}:
                oval(14, y - 3, 6, 6, dark)
                if species in {"panda", "monkey"}:
                    oval(24, y - 3, 5, 5, dark)
                if species == "panda":
                    oval(21, y + 3, 7, 6, dark, dark)
            elif species == "raccoon":
                box(18, y + 4, 10, 4, dark)
        eyes(24, y + 4)
        box(28, y + 8, 2, 1, INK)

    if species in {"bunny", "cat", "dog", "fox", "horse", "monkey", "panda", "raccoon", "rat", "squirrel"}:
        furry()
    elif species in {"chicken", "cockatiel", "rubber-duck"}:
        feet(13, 19)
        poly([(5, 17), (11, 19), (18, 17), (22, 22), (19, 27), (10, 27), (6, 23)], base)
        oval(10, 20, 8, 5, dark)
        oval(16, 10, 12, 13, base)
        poly([(26, 16), (31, 18), (27, 21)], GOLD)
        if species == "chicken":
            box(19, 8, 6, 3, "#ed6b55")
        if species == "cockatiel":
            poly([(18, 13), (17, 5), (24, 12)], GOLD)
            box(22, 18, 3, 2, ROSE)
        eyes(23, 14)
    elif species in {"turtle", "snail", "frog", "crab", "snake", "deno"}:
        feet()
        if species in {"turtle", "snail"}:
            oval(6, 20, 24, 8, light)
            oval(6, 11, 17, 16, base)
            oval(10, 14, 9, 9, dark)
            oval(12, 16, 5, 5, light, dark)
            oval(22, 17, 8, 8, base if species == "turtle" else light)
            if species == "snail":
                box(24, 14, 1, 5, dark)
                box(28, 13, 1, 6, dark)
            eyes(26, 18)
        elif species == "frog":
            oval(6, 19, 21, 9, base)
            oval(13, 15, 16, 10, light)
            oval(16, 11, 7, 9, base)
            oval(24, 12, 6, 8, base)
            eyes(19, 14)
            eyes(26, 15)
            box(25, 21, 4, 1, dark)
        elif species == "crab":
            oval(8, 19, 17, 9, base)
            for x in (8, 22):
                box(x + 2, 15, 2, 8, dark)
                eyes(x + 2, 13)
            oval(3, 15, 7, 6, light)
            oval(23, 15 - step, 7, 6, light)
        elif species == "snake":
            oval(4, 22, 24, 7, dark)
            oval(14, 20, 13, 8, base)
            oval(20, 14, 10, 9, light)
            eyes(26, 17)
            box(29, 21, 2, 1, ROSE)
        else:
            poly([(4, 22), (11, 21), (17, 15), (19, 8), (25, 7), (29, 12), (23, 16), (21, 25), (12, 27)], base)
            box(20, 19, 4, 3, light)
            eyes(24, 10)
    elif species == "clippy":
        draw.rounded_rectangle((9, 9 + height, 23, 27 + height), radius=5, outline=light, width=2)
        draw.rounded_rectangle((13, 12 + height, 20, 24 + height), radius=3, outline=base, width=2)
        eyes(17, 12)
        eyes(21, 12)
    elif species == "zappy":
        poly([(20, 7), (9, 19), (15, 19), (11, 28), (25, 15), (18, 15)], GOLD)
        eyes(16, 15)
    elif species == "rocky":
        poly([(5, 26), (7, 19), (14, 13), (22, 14), (28, 20), (29, 27), (12, 29)], base)
        poly([(8, 22), (14, 15), (20, 16), (16, 20)], light, light)
        eyes(22, 20)
    elif species == "mod":
        feet()
        box(16, 7, 2, 7, INK)
        box(15, 6, 4, 3, GOLD)
        box(8, 11, 18, 14, INK)
        box(9, 12, 16, 12, base)
        box(12, 15, 11, 6, dark)
        box(14, 17, 2, 2, CREAM)
        box(20, 17, 2, 2, CREAM)
    elif species == "skeleton":
        feet()
        box(13, 21, 8, 6, light)
        box(14, 22, 6, 1, dark)
        box(14, 24, 6, 1, dark)
        oval(11, 9, 15, 14, light)
        eyes(16, 14)
        eyes(22, 14)
        box(19, 18, 2, 1, dark)
    else:
        # Two soft-bodied mascots, with a leaf crown for the woodland one.
        oval(6, 12 if not rest else 16, 21, 16 if not rest else 11, base)
        oval(11, 16, 10, 8, light, light)
        if species == "totoro":
            poly([(15, 13), (12, 8), (12, 5), (20, 9), (23, 7), (23, 11), (20, 14)], "#78be81")
        eyes(19, 16)
        eyes(23, 17)

    if animation == "with_ball":
        oval(25, 24, 6, 6, "#ff7a92")
        box(27, 25, 2, 1, CREAM)
    return image


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    for species, variants in manifest.items():
        folder = ROOT / species
        folder.mkdir(exist_ok=True)
        for variant, animations in variants.items():
            for animation in animations:
                count = 8 if animation == "idle" else 4
                frames = [sprite(species, variant, animation, frame) for frame in range(count)]
                target = folder / f"{variant}_{animation}_8fps.gif"
                frames[0].save(target, save_all=True, append_images=frames[1:], duration=125, loop=0, disposal=2)


if __name__ == "__main__":
    main()
