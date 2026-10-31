# フィルムの粒子（grain0〜5.png）を作る。動画を書き出す前に 1 回実行する
import numpy as np
from PIL import Image
rng = np.random.default_rng(1)
for i in range(6):
    n = rng.normal(128, 40, (540, 960)).clip(0, 255).astype('uint8')
    a = Image.fromarray(n, 'L').resize((1920, 1080))
    Image.merge('RGBA', (a, a, a, Image.new('L', a.size, 255))).save('grain%d.png' % i)
