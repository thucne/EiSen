// One timeline for picture and sound, so they can't drift apart. Frames at 30 fps.
export const FPS = 30;
// The intro is exactly two bars of the music, so the groove starts with the demo.
export const INTRO = 144;
export const TOTAL_FRAMES = INTRO + 600;

// Absolute frames. Everything else on this timeline starts after the intro.
export const INTRO_CUES = [
  ["bloom", 8],
  ["pop", 50],
  ["pop", 96],
  ["whoosh", INTRO - 8],
];

export const BEAT = {
  trigger: 0,
  select: 62,
  editor: 136,
  thumbnail: 258,
  previous: 362,
  ocr: 412,
  end: 492,
};

// Exact moments of action, used by the scene and the sound.
export const AT = {
  tap1: 34,
  tap2: 42,
  freeze: 50,
  dragStart: 72,
  dragEnd: 104,
  toolbar: 108,
  clickEdit: 130,
  editorOpen: 136,
  pickRedact: 158,
  redact1Start: 170,
  redact1End: 190,
  redact2Start: 202,
  redact2End: 220,
  clickCopy: 246,
  thumbIn: 258,
  grab: 284,
  drop: 328,
  key1: 372,
  key2: 377,
  key3: 382,
  regionBack: 386,
  clickOcr: 424,
  ocrDone: 450,
  logo: 498,
  line: 516,
  link: 534,
};

export const CUES = [
  ["tap", AT.tap1],
  ["tap", AT.tap2],
  ["shutter", AT.freeze],
  ["slide", AT.dragStart],
  ["pop", AT.toolbar],
  ["click", AT.clickEdit],
  ["whoosh", AT.editorOpen - 3],
  ["click", AT.pickRedact],
  ["stamp", AT.redact1End],
  ["stamp", AT.redact2End],
  ["click", AT.clickCopy],
  ["whoosh", AT.thumbIn - 3],
  ["click", AT.grab],
  ["drop", AT.drop],
  ["tap", AT.key1],
  ["tap", AT.key2],
  ["tap", AT.key3],
  ["shutter", AT.regionBack],
  ["click", AT.clickOcr],
  ["chime", AT.ocrDone],
  ["bloom", AT.logo],
];
