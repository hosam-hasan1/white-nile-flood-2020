/*****************************************************************
 PROJECT A – Sentinel-1 SAR flood mapping, 2020 White Nile flood, Sudan
 Author:   Hosam Hasan Abdalla
 Platform: Google Earth Engine Code Editor (code.earthengine.google.com)
 Version:  2 (8 Oct 2026)

 METHOD
 - Change detection after/before on Sentinel-1 VH backscatter
   (UN-SPIDER Recommended Practice, threshold 1.25).
 - Baseline: median of 1-20 September 2017-2023 (2020 excluded), same
   satellite track as the flood image ("normal September"), so normal
   seasonal water and reservoir filling cancel out.
   The first test used a dry-season (May-June 2020) baseline; it can be
   reproduced with BASELINE = 'dryMayJune'.
 - Masks: JRC permanent water, isolated noise pixels, slopes > 5 degrees.
 - Outputs: flooded area (ha), people in flooded cells (WorldPop 2020),
   threshold sensitivity (1.15-1.35), flood within 2 km and 5 km of the
   permanent river (river corridor), HAND layer (tested, not used).

 HOW TO RUN
 1. Set AOI_NAME (and BASELINE) in SECTION 1.
 2. Click Run. Results appear in the Console and on the map.
 3. Tasks tab -> RUN the exports. Files go to Google Drive, folder
    "ProjectA_GEE", named automatically, e.g. FloodExtent_AbaIsland_vsSept.
*****************************************************************/

// ================= SECTION 1: SETTINGS (edit these) =================

var AOIS = {
  'JebelAulia': ee.Geometry.Rectangle([32.30, 15.10, 32.70, 15.60]), // Jebel Aulia reservoir to south Khartoum
  'AbaIsland':  ee.Geometry.Rectangle([32.30, 13.00, 32.80, 13.60])  // El Gezira Aba, Kosti / Rabak
};
var AOI_NAME = 'JebelAulia';      // 'JebelAulia' or 'AbaIsland'
var BASELINE = 'normalSept';      // 'normalSept' (final) or 'dryMayJune' (first test)
var aoi = AOIS[AOI_NAME];

// Flood image window (2020 peak: Khartoum record 17.67 m on 7 Sep 2020)
var AFTER_START = '2020-09-01', AFTER_END = '2020-09-20';
// Dry-season window (only used when BASELINE = 'dryMayJune')
var BEFORE_START = '2020-05-01', BEFORE_END = '2020-06-15';
// Years for the normal-September baseline (2020 is excluded below)
var SEPT_FROM = '2017-01-01', SEPT_TO = '2024-01-01';

var POLARIZATION = 'VH';   // VH is most sensitive to open flood water
var PASS = 'DESCENDING';   // same orbit direction for all images
var THRESHOLD = 1.25;      // UN-SPIDER default
var SMOOTH_RADIUS = 50;    // metres, speckle reduction
var ZONES_KM = [2, 5];     // river-corridor distances
var EXPORT_FOLDER = 'ProjectA_GEE';
var TAG = AOI_NAME + (BASELINE === 'normalSept' ? '_vsSept' : '_vsMayJune');

// ================= SECTION 2: SENTINEL-1 DATA =================

var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', POLARIZATION))
  .filter(ee.Filter.eq('orbitProperties_pass', PASS))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filterBounds(aoi)
  .select(POLARIZATION);

// Flood image(s)
var afterCol = s1.filterDate(AFTER_START, AFTER_END);
var afterOrbit = afterCol.first().get('relativeOrbitNumber_start');
var after = afterCol.mosaic().clip(aoi);

// Baseline image(s)
var beforeCol, before;
if (BASELINE === 'normalSept') {
  beforeCol = s1
    .filterDate(SEPT_FROM, SEPT_TO)
    .filter(ee.Filter.calendarRange(2020, 2020, 'year').not())
    .filter(ee.Filter.calendarRange(9, 9, 'month'))
    .filter(ee.Filter.calendarRange(1, 20, 'day_of_month'))
    .filter(ee.Filter.eq('relativeOrbitNumber_start', afterOrbit));
  before = beforeCol.median().clip(aoi);
} else {
  beforeCol = s1.filterDate(BEFORE_START, BEFORE_END);
  before = beforeCol.mosaic().clip(aoi);
}

var listDates = function (col) {
  return col.aggregate_array('system:time_start')
    .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); });
};
print('Study area:', AOI_NAME, 'Baseline:', BASELINE);
print('Baseline images:', beforeCol.size(), 'Flood images:', afterCol.size());
print('Baseline dates:', listDates(beforeCol));
print('Flood image date:', listDates(afterCol));
// If a count is 0, widen the dates or switch PASS to 'ASCENDING'.

var beforeF = before.focal_mean(SMOOTH_RADIUS, 'circle', 'meters');
var afterF  = after.focal_mean(SMOOTH_RADIUS, 'circle', 'meters');

// ================= SECTION 3: CHANGE DETECTION =================

// Values are in dB (negative). Water darkens the image, so after/before > 1 where water appeared.
var ratio = afterF.divide(beforeF);
var floodRaw = ratio.gt(THRESHOLD);

// ================= SECTION 4: MASKS =================

// 4a. Permanent water (water >= 10 months a year, JRC Global Surface Water)
var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');
var permanentWater = gsw.select('seasonality').gte(10).unmask(0).clip(aoi);
var flooded = floodRaw.where(permanentWater, 0);

// 4b. Isolated noise pixels (keep clusters of >= 8 connected pixels)
var connections = flooded.updateMask(flooded).connectedPixelCount(25);
flooded = flooded.updateMask(connections.gte(8));

// 4c. Slopes > 5 degrees (floodwater cannot pond there)
var dem = ee.Image('WWF/HydroSHEDS/03VFDEM');
var slope = ee.Algorithms.Terrain(dem).select('slope');
flooded = flooded.updateMask(slope.lt(5)).selfMask();

// ================= SECTION 5: STATISTICS =================

var sumHa = function (img, scale) {
  return ee.Number(img.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, scale: scale,
    maxPixels: 1e10, bestEffort: true
  }).values().get(0)).divide(10000);
};

// 5a. Whole study box
var floodAreaHa = sumHa(flooded, 10);
print('Flooded area, whole box (ha):', floodAreaHa);

// 5b. People living in cells mapped as flooded (WorldPop 2020, 100 m)
var pop = ee.ImageCollection('WorldPop/GP/100m/pop')
  .filter(ee.Filter.eq('country', 'SDN'))
  .filter(ee.Filter.eq('year', 2020))
  .first().clip(aoi);
var peopleIn = function (floodImg) {
  return pop.updateMask(floodImg.reproject({crs: pop.projection()}))
    .reduceRegion({reducer: ee.Reducer.sum(), geometry: aoi, scale: 100,
                   maxPixels: 1e10, bestEffort: true})
    .get('population');
};
var popExposed = peopleIn(flooded);
print('People in flooded cells, whole box (WorldPop 2020):', popExposed);

// 5c. Threshold sensitivity (30 m, without the noise filter)
var thresholds = [1.15, 1.20, 1.25, 1.30, 1.35];
var sens = ee.FeatureCollection(thresholds.map(function (t) {
  var f = ratio.gt(t).where(permanentWater, 0).updateMask(slope.lt(5)).selfMask();
  return ee.Feature(null, {row: 'sensitivity', threshold: t, flooded_ha: sumHa(f, 30)});
}));
print('Thresholds:', sens.aggregate_array('threshold'),
      'Flooded ha:', sens.aggregate_array('flooded_ha'));

// 5d. River corridor: flood within X km of the permanent river
// (HAND was tested but is ~0-3 m almost everywhere in this flat terrain)
var riverZone = function (km) {
  return permanentWater   // do NOT selfMask here, distance() would skip masked pixels
    .distance(ee.Kernel.euclidean(km * 1000, 'meters'))
    .gte(0).unmask(0).clip(aoi)
    .reproject({crs: 'EPSG:32636', scale: 30});   // UTM 36N, metres
};
var zoneLayers = [];
var zoneStats = ee.FeatureCollection(ZONES_KM.map(function (km) {
  var zone = riverZone(km);
  var fz = flooded.updateMask(zone);
  var ha = sumHa(fz, 10);
  var ppl = peopleIn(fz);
  print('Within ' + km + ' km of river - flooded ha:', ha, 'people:', ppl);
  zoneLayers.push({img: zone.selfMask(), name: 'River zone ' + km + ' km'});
  return ee.Feature(null, {row: 'river_zone', zone_km: km, threshold: THRESHOLD,
                           flooded_ha: ha, people_exposed: ppl});
}));

// ================= SECTION 6: MAP =================

var hand = ee.Image('MERIT/Hydro/v1_0_1').select('hnd').clip(aoi);

Map.centerObject(aoi, 11);
Map.addLayer(before, {min: -25, max: 0}, 'Baseline (VH dB)', false);
Map.addLayer(after,  {min: -25, max: 0}, 'Flood image 2020 (VH dB)', false);
Map.addLayer(ratio,  {min: 0.9, max: 1.6}, 'After/Before ratio', false);
Map.addLayer(hand, {min: 0, max: 20, palette: ['0000ff', '00ffff', 'ffff00', 'ff0000']}, 'HAND (m)', false);
zoneLayers.forEach(function (z) {
  Map.addLayer(z.img, {palette: ['ffffff'], opacity: 0.25}, z.name, false);
});
Map.addLayer(permanentWater.selfMask(), {palette: ['0000aa']}, 'Permanent water (JRC)');
Map.addLayer(flooded, {palette: ['00bfff']}, 'Flood extent');

// ================= SECTION 7: EXPORTS (Tasks tab) =================

// Flood map (1 = flooded) for ArcGIS Pro / QGIS
Export.image.toDrive({
  image: flooded.toByte(),
  description: 'FloodExtent_' + TAG,
  folder: EXPORT_FOLDER,
  region: aoi, scale: 10, maxPixels: 1e10, fileFormat: 'GeoTIFF'
});

// All numbers in one table: whole box, sensitivity, river zones
var summary = ee.Feature(null, {row: 'whole_box', threshold: THRESHOLD,
                                flooded_ha: floodAreaHa, people_exposed: popExposed});
var table = ee.FeatureCollection([summary]).merge(sens).merge(zoneStats)
  .map(function (f) {
    return f.set({aoi: AOI_NAME, baseline: BASELINE,
                  flood_window: AFTER_START + '/' + AFTER_END});
  });
Export.table.toDrive({
  collection: table,
  description: 'FloodStats_' + TAG,
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV',
  selectors: ['row', 'aoi', 'baseline', 'flood_window', 'threshold',
              'zone_km', 'flooded_ha', 'people_exposed']
});

// ================= SECTION 8: MAP BACKGROUND (Sentinel-2) =================

// Cloud-free true-colour background for the final maps (dry season 2020)
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2020-01-01', '2020-04-30')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
  .median().clip(aoi);
var s2rgb = s2.visualize({bands: ['B4', 'B3', 'B2'], min: 0, max: 3500, gamma: 1.2});
Map.addLayer(s2rgb, {}, 'Sentinel-2 true colour (Jan-Apr 2020)', false);
Export.image.toDrive({
  image: s2rgb, description: 'Background_S2_' + AOI_NAME, folder: EXPORT_FOLDER,
  region: aoi, scale: 20, maxPixels: 1e10, fileFormat: 'GeoTIFF'
});
