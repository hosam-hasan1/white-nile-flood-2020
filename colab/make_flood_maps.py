# ===== PROJECT A – BOTH FLOOD MAPS (Aba Island + Jebel Aulia) =====
# Run in Google Colab after exporting the files from Earth Engine
# (gee/flood_mapping_sentinel1.js) to the Google Drive folder ProjectA_GEE.
#
# In Colab, first run:
#   !pip install -q rasterio matplotlib-scalebar
#   from google.colab import drive; drive.mount('/content/drive')

FOLDER = '/content/drive/MyDrive/ProjectA_GEE'

import numpy as np, pandas as pd, rasterio
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter, MultipleLocator
from matplotlib_scalebar.scalebar import ScaleBar

FLOOD_COLOR = '#00b4ff'
halo = [pe.withStroke(linewidth=3, foreground='black')]
CREDIT = ('Flood: Sentinel-1 SAR (VH) change detection, 11 Sep 2020 vs. median of 1–20 Sep 2017–2023 '
          '(UN-SPIDER method, threshold 1.25); JRC permanent water removed.\n'
          'Background: Sentinel-2 L2A median, Jan–Apr 2020. Contains modified Copernicus Sentinel data (2020). '
          'Processing: Google Earth Engine, Python. Map: Hosam Hasan, Oct 2026.')

# Title and town labels (name, longitude, latitude) for each site
SITES = {
    'AbaIsland': {
        'title': 'White Nile flood, 11 September 2020 – Aba Island area, White Nile State, Sudan',
        'labels': [('Kosti', 32.664, 13.162), ('Rabak', 32.740, 13.180), ('Aba Island', 32.625, 13.340)],
    },
    'JebelAulia': {
        'title': 'White Nile flood, 11 September 2020 – Jebel Aulia to south Khartoum, Sudan',
        'labels': [('Jebel Aulia dam', 32.495, 15.240), ('Soba', 32.670, 15.520), ('Khartoum ↑', 32.600, 15.585)],
    },
}


def make_map(site):
    cfg = SITES[site]

    # 1. Read background photo and flood map
    with rasterio.open(f'{FOLDER}/Background_S2_{site}.tif') as src:
        rgb = src.read([1, 2, 3]).transpose(1, 2, 0)
        b = src.bounds
    with rasterio.open(f'{FOLDER}/FloodExtent_{site}_vsSept.tif') as src:
        fl = src.read(1)
        fb = src.bounds

    # 2. Shrink flood map 2x, keeping small patches
    h, w = fl.shape[0] // 2 * 2, fl.shape[1] // 2 * 2
    fl2 = fl[:h, :w].reshape(h // 2, 2, w // 2, 2).max(axis=(1, 3))
    flood = np.ma.masked_where(fl2 != 1, fl2)

    # 3. Draw photo + new water
    lat0 = (b.top + b.bottom) / 2
    fig, ax = plt.subplots(figsize=(9, 10))
    ax.imshow(rgb, extent=[b.left, b.right, b.bottom, b.top])
    ax.imshow(flood, extent=[fb.left, fb.right, fb.bottom, fb.top],
              cmap=ListedColormap([FLOOD_COLOR]), vmin=0, vmax=1, interpolation='nearest')
    ax.set_aspect(1 / np.cos(np.radians(lat0)))

    # 4. Town labels
    for name, x, y in cfg['labels']:
        ax.text(x, y, name, color='white', fontsize=10, fontweight='bold',
                ha='center', va='center', path_effects=halo)

    # 5. Scale bar, north arrow, legend
    ax.add_artist(ScaleBar(111320 * np.cos(np.radians(lat0)), units='m',
                           location='lower left', box_alpha=0.8))
    ax.annotate('N', xy=(0.95, 0.97), xytext=(0.95, 0.88), xycoords='axes fraction',
                ha='center', va='center', fontsize=13, fontweight='bold', color='white',
                path_effects=halo,
                arrowprops=dict(facecolor='white', edgecolor='black', width=4, headwidth=12))
    ax.legend(handles=[Patch(color=FLOOD_COLOR,
                             label='New surface water, 11 Sep 2020\n(compared with a normal September)')],
              loc='lower right', framealpha=0.9, fontsize=9)

    # 6. Key numbers from the exported table (rounded to nearest 100)
    try:
        df = pd.read_csv(f'{FOLDER}/FloodStats_{site}_vsSept.csv')
        z5 = df[(df['row'] == 'river_zone') & (df['zone_km'] == 5)].iloc[0]
        whole = df[df['row'] == 'whole_box'].iloc[0]
        txt = (f"Within 5 km of the river: ~{round(z5.flooded_ha, -2):,.0f} ha, "
               f"~{round(z5.people_exposed, -2):,.0f} people\n"
               f"Whole area (incl. rain ponds and field changes): ~{round(whole.flooded_ha, -2):,.0f} ha")
        ax.text(0.02, 0.98, txt, transform=ax.transAxes, va='top', fontsize=9,
                bbox=dict(facecolor='white', alpha=0.85, edgecolor='none'))
    except Exception as e:
        print('Numbers box skipped:', e)

    # 7. Coordinates every 0.1°, title, credits, save
    ax.xaxis.set_major_locator(MultipleLocator(0.1))
    ax.yaxis.set_major_locator(MultipleLocator(0.1))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{v:.1f}°E'))
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{v:.1f}°N'))
    ax.tick_params(labelsize=8)
    ax.set_title(cfg['title'], fontsize=11, fontweight='bold', loc='left')
    fig.text(0.01, 0.005, CREDIT, fontsize=6.5, color='#444', ha='left', va='bottom')
    fig.subplots_adjust(bottom=0.09)

    out = f'{FOLDER}/Map_{site}_2020flood.png'
    fig.savefig(out, dpi=300, bbox_inches='tight')
    plt.show()
    print('Saved to Google Drive:', out)


if __name__ == '__main__':
    make_map('AbaIsland')
    make_map('JebelAulia')
