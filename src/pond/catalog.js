// Furniture catalog. Pieces are sliced out of a few packed spritesheets in
// assets/furniture/. Each item records which sheet it belongs to and its tight
// pixel bounding box within that sheet; both the settings picker (previews) and
// the spawned furniture windows read from here, so the boxes live in one place.
//
// Art: "Classic Furniture" + "Garden Planters" pixel packs by 0-mem0ry
// (https://0-mem0ry.itch.io/). Boxes were measured from each sheet's alpha
// channel (connected components), then curated and hand-verified.

const path = require('path');

const dir = path.join(__dirname, '..', '..', 'assets', 'furniture');

// id -> { file, w, h }. `w`/`h` are the full sheet dimensions (needed so the
// renderer can scale the background correctly to show one slice).
const SHEETS = {
  classic: { file: path.join(dir, 'classic.png'), w: 352, h: 352 },
  'garden-barrel': { file: path.join(dir, 'garden-barrel.png'), w: 416, h: 352 },
  'garden-bucket': { file: path.join(dir, 'garden-bucket.png'), w: 416, h: 384 },
  'garden-tire': { file: path.join(dir, 'garden-tire.png'), w: 416, h: 352 },
  'garden-toilet': { file: path.join(dir, 'garden-toilet.png'), w: 416, h: 384 }
};

// { id, name, group, sheet, x, y, w, h } — x/y/w/h are pixels in `sheet`.
const ITEMS = [
  // --- Seating -------------------------------------------------------------
  { id: 'armchair', name: 'Armchair', group: 'Seating', sheet: 'classic', x: 1, y: 26, w: 30, h: 37 },
  { id: 'wingback', name: 'Wingback chair', group: 'Seating', sheet: 'classic', x: 68, y: 23, w: 26, h: 40 },
  { id: 'sofa', name: 'Sofa', group: 'Seating', sheet: 'classic', x: 102, y: 26, w: 52, h: 37 },
  { id: 'sofa_pillows', name: 'Sofa with pillows', group: 'Seating', sheet: 'classic', x: 166, y: 26, w: 52, h: 37 },
  { id: 'wooden_chair', name: 'Wooden chair', group: 'Seating', sheet: 'classic', x: 104, y: 69, w: 16, h: 32 },
  { id: 'dining_chair', name: 'Dining chair', group: 'Seating', sheet: 'classic', x: 135, y: 215, w: 18, h: 34 },

  // --- Storage -------------------------------------------------------------
  { id: 'wardrobe', name: 'Wardrobe', group: 'Storage', sheet: 'classic', x: 195, y: 72, w: 26, h: 55 },
  { id: 'bookshelf', name: 'Bookshelf', group: 'Storage', sheet: 'classic', x: 1, y: 141, w: 30, h: 50 },
  { id: 'cabinet', name: 'Cabinet', group: 'Storage', sheet: 'classic', x: 33, y: 141, w: 30, h: 50 },
  { id: 'dresser', name: 'Dresser', group: 'Storage', sheet: 'classic', x: 109, y: 214, w: 18, h: 42 },
  { id: 'nightstand', name: 'Nightstand', group: 'Storage', sheet: 'classic', x: 1, y: 225, w: 30, h: 31 },
  { id: 'side_table', name: 'Side table', group: 'Storage', sheet: 'classic', x: 224, y: 327, w: 32, h: 24 },

  // --- Surfaces ------------------------------------------------------------
  { id: 'desk', name: 'Writing desk', group: 'Surfaces', sheet: 'classic', x: 134, y: 152, w: 52, h: 39 },
  { id: 'vanity', name: 'Vanity', group: 'Surfaces', sheet: 'classic', x: 96, y: 149, w: 32, h: 42 },

  // --- Beds ----------------------------------------------------------------
  { id: 'bed', name: 'Bed', group: 'Beds', sheet: 'classic', x: 64, y: 263, w: 64, h: 68 },
  { id: 'bed_made', name: 'Made bed', group: 'Beds', sheet: 'classic', x: 129, y: 272, w: 62, h: 48 },

  // --- Decor ---------------------------------------------------------------
  { id: 'potted_palm', name: 'Potted palm', group: 'Decor', sheet: 'classic', x: 228, y: 267, w: 20, h: 52 },
  { id: 'potted_plant', name: 'Potted plant', group: 'Decor', sheet: 'classic', x: 260, y: 289, w: 23, h: 31 },
  { id: 'bonsai', name: 'Bonsai', group: 'Decor', sheet: 'classic', x: 198, y: 261, w: 19, h: 26 },
  { id: 'rose_vase', name: 'Rose in vase', group: 'Decor', sheet: 'classic', x: 258, y: 262, w: 11, h: 25 },
  { id: 'painting', name: 'Framed painting', group: 'Decor', sheet: 'classic', x: 257, y: 200, w: 30, h: 22 },
  { id: 'open_book', name: 'Open book', group: 'Decor', sheet: 'classic', x: 230, y: 210, w: 20, h: 13 },
  { id: 'teapot', name: 'Teapot', group: 'Decor', sheet: 'classic', x: 304, y: 130, w: 16, h: 12 },
  { id: 'teacup', name: 'Teacup', group: 'Decor', sheet: 'classic', x: 288, y: 131, w: 15, h: 11 },
  { id: 'bottle', name: 'Bottle', group: 'Decor', sheet: 'classic', x: 295, y: 166, w: 18, h: 22 },
  { id: 'vase', name: 'Vase', group: 'Decor', sheet: 'classic', x: 339, y: 161, w: 10, h: 15 },
  { id: 'cushion', name: 'Cushion', group: 'Decor', sheet: 'classic', x: 320, y: 241, w: 16, h: 15 },

  // --- Rugs ----------------------------------------------------------------
  { id: 'rug_red', name: 'Red rug', group: 'Rugs', sheet: 'classic', x: 17, y: 257, w: 46, h: 30 },
  { id: 'rug_ornate', name: 'Ornate rug', group: 'Rugs', sheet: 'classic', x: 3, y: 291, w: 58, h: 58 },
  { id: 'rug_cream', name: 'Cream rug', group: 'Rugs', sheet: 'classic', x: 145, y: 321, w: 46, h: 30 },

  // --- Garden planters -----------------------------------------------------
  { id: 'barrel_greens', name: 'Barrel greens', group: 'Garden', sheet: 'garden-barrel', x: 129, y: 129, w: 20, h: 30 },
  { id: 'barrel_blooms', name: 'Barrel blooms', group: 'Garden', sheet: 'garden-barrel', x: 38, y: 262, w: 20, h: 25 },
  { id: 'barrel_berries', name: 'Barrel berries', group: 'Garden', sheet: 'garden-barrel', x: 133, y: 322, w: 22, h: 29 },
  { id: 'bucket_cactus', name: 'Bucket cactus', group: 'Garden', sheet: 'garden-bucket', x: 96, y: 98, w: 16, h: 29 },
  { id: 'bucket_herb', name: 'Bucket herb', group: 'Garden', sheet: 'garden-bucket', x: 69, y: 357, w: 22, h: 26 },
  { id: 'bucket_blooms', name: 'Bucket blooms', group: 'Garden', sheet: 'garden-bucket', x: 101, y: 356, w: 22, h: 27 },
  { id: 'tire_greens', name: 'Tire greens', group: 'Garden', sheet: 'garden-tire', x: 68, y: 325, w: 24, h: 26 },
  { id: 'tire_blooms', name: 'Tire blooms', group: 'Garden', sheet: 'garden-tire', x: 100, y: 324, w: 24, h: 27 },
  { id: 'tire_berries', name: 'Tire berries', group: 'Garden', sheet: 'garden-tire', x: 132, y: 324, w: 24, h: 27 },
  { id: 'toilet_flowers', name: 'Toilet flowers', group: 'Garden', sheet: 'garden-toilet', x: 324, y: 80, w: 22, h: 47 },
  { id: 'toilet_planter', name: 'Toilet planter', group: 'Garden', sheet: 'garden-toilet', x: 356, y: 146, w: 22, h: 45 }
];

const byId = new Map(ITEMS.map((it) => [it.id, it]));

module.exports = {
  SHEETS,
  ITEMS,
  get: (id) => byId.get(id) || null
};
