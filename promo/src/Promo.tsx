import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { COPY, type Locale } from "./copy";
import { AT, BEAT, INTRO } from "./cues.mjs";

type Format = "wide" | "story";

const INK = "#f4f4f5";
const MUTED = "#a1a1aa";
const BG = "#0f1015";
const ACCENT = "#6366f1"; // the app's selection color
const MARK = "#ff6b3d";
const SANS = "'Plus Jakarta Sans', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const fonts = `
@font-face{font-family:'Plus Jakarta Sans';font-weight:400 800;src:url('${staticFile("fonts/plus-jakarta-sans-latin.woff2")}') format('woff2');unicode-range:U+0000-00FF,U+2000-206F,U+2022}
@font-face{font-family:'Plus Jakarta Sans';font-weight:400 800;src:url('${staticFile("fonts/plus-jakarta-sans-latin-ext.woff2")}') format('woff2');unicode-range:U+0100-02BA,U+1E00-1E9F}
@font-face{font-family:'Plus Jakarta Sans';font-weight:400 800;src:url('${staticFile("fonts/plus-jakarta-sans-vietnamese.woff2")}') format('woff2');unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+1EA0-1EF9}
@font-face{font-family:'JetBrains Mono';font-weight:400 800;src:url('${staticFile("fonts/jetbrains-mono-latin.woff2")}') format('woff2')}
`;

const ease = Easing.bezier(0.22, 1, 0.36, 1);
const inOut = Easing.bezier(0.65, 0, 0.35, 1);

const ramp = (f: number, a: number, b: number, from = 0, to = 1, easing = ease) =>
  interpolate(f, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

// The screen layout. All capture coordinates are in screen pixels.
const WIN = { x: 150, y: 110, w: 980, h: 640 };
const CHAT = { x: 1190, y: 150, w: 590, h: 600 };
const REGION = { x: 170, y: 176, w: 900, h: 400 };
const LINE_H = 62;
const CHAR_W = 18; // JetBrains Mono at 30px
const textX = WIN.x + 40;
const lineY = (i: number) => WIN.y + 80 + i * LINE_H;

const CONFIG = [
  "# deploy.env",
  "DATABASE_HOST=db.internal",
  "API_KEY=sk_demo_4f9a1c7e2b8d03",
  "REGION=ap-southeast-1",
  "PASSWORD=demo-not-real-93",
  "LOG_LEVEL=info",
];
const LOG = [
  "$ ./deploy --prod",
  "building image...      41s",
  "running migrations...  ok",
  "health check...        200",
  "Deployed to production",
  "https://app.example.com",
];

const REDACTIONS = [
  { line: 2, from: 8, chars: 22, start: AT.redact1Start, end: AT.redact1End },
  { line: 4, from: 9, chars: 16, start: AT.redact2Start, end: AT.redact2End },
];

const Lines = ({ lines }: { lines: string[] }) => (
  <>
    {lines.map((line, i) => (
      <div
        key={line}
        style={{
          position: "absolute",
          left: textX,
          top: lineY(i),
          font: `500 30px/40px ${MONO}`,
          color: line.startsWith("#") || line.startsWith("$") ? "#71717a" : "#d4d4d8",
          whiteSpace: "pre",
        }}
      >
        {line}
      </div>
    ))}
  </>
);

// The captured region, redrawn at any scale for the editor, thumbnail, and chat.
const Capture = ({ scale, frame, showRedactions }: { scale: number; frame: number; showRedactions: boolean }) => (
  <div style={{ width: REGION.w * scale, height: REGION.h * scale, overflow: "hidden", position: "relative", background: "#1b1c21" }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${scale}) translate(${-REGION.x}px, ${-REGION.y}px)`, transformOrigin: "0 0" }}>
      <Lines lines={CONFIG} />
      {showRedactions &&
        REDACTIONS.map((r) => (
          <div
            key={r.line}
            style={{
              position: "absolute",
              left: textX + r.from * CHAR_W - 3,
              top: lineY(r.line) - 2,
              height: 44,
              width: (r.chars * CHAR_W + 6) * ramp(frame, r.start, r.end, 0, 1, inOut),
              background: "#000",
            }}
          />
        ))}
    </div>
  </div>
);

const Window = ({ x, y, w, h, title, children, style }: { x: number; y: number; w: number; h: number; title: string; children?: ReactNode; style?: CSSProperties }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: "#1b1c21", borderRadius: 14, border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 30px 70px rgba(0,0,0,.5)", overflow: "hidden", ...style }}>
    <div style={{ height: 44, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: "#52525b" }} />
      ))}
      <span style={{ marginLeft: 10, font: `500 16px ${SANS}`, color: MUTED }}>{title}</span>
    </div>
    {children}
  </div>
);

const Key = ({ label, down }: { label: string; down: boolean }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 84,
      height: 84,
      padding: "0 22px",
      borderRadius: 16,
      font: `600 34px ${SANS}`,
      color: down ? "#0f1015" : INK,
      background: down ? INK : "#27272a",
      border: "1px solid rgba(255,255,255,.2)",
      transform: `translateY(${down ? 4 : 0}px)`,
      boxShadow: down ? "none" : "0 5px 0 #18181b",
    }}
  >
    {label}
  </span>
);

const Cursor = ({ x, y, pressed, opacity }: { x: number; y: number; pressed: boolean; opacity: number }) => (
  <svg width="38" height="38" viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${pressed ? 0.88 : 1})`, transformOrigin: "0 0", filter: "drop-shadow(0 3px 5px rgba(0,0,0,.6))" }}>
    <path d="M3 2l7.5 19 2.6-7.9L21 10.6z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const Path = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const OverlayBar = ({ x, y, copy, active, opacity }: { x: number; y: number; copy: (typeof COPY)[Locale]; active: "edit" | "ocr" | null; opacity: number }) => {
  const btn = (on: boolean): CSSProperties => ({ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 9, color: on ? "#fff" : "#cbd5e1", background: on ? "rgba(255,255,255,.16)" : "transparent", font: `600 18px ${SANS}` });
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, display: "flex", alignItems: "center", gap: 4, padding: 6, background: "rgba(18,20,29,.96)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 13, boxShadow: "0 12px 32px rgba(0,0,0,.6)" }}>
      <span style={{ ...btn(false), color: "#f87171" }}><Path d="M6 6l12 12M18 6L6 18" /></span>
      <span style={{ width: 1, height: 22, background: "rgba(255,255,255,.15)", margin: "0 4px" }} />
      <span style={btn(active === "ocr")}><Path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M8 9h8M8 12h8M8 15h5" /></span>
      <span style={btn(false)}><Path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></span>
      <span style={btn(active === "edit")}><Path d="M4 20l4-1L19 8a2 2 0 00-3-3L5 16z" />{copy.edit}</span>
      <span style={{ ...btn(false), color: "#fff", background: ACCENT }}><Path d="M9 9h10v11H9zM5 15V4h10" />{copy.copy}</span>
    </div>
  );
};

// In the app's order. Redact sits at index 7.
const EDITOR_TOOLS = [
  "M6 3l12 9-5 1-3 6z",
  "M7 3v14h14M3 7h14v14",
  "M9 4L7 20M17 4l-2 16M4 9h16M3 15h16",
  "M4 5h16v14H4z",
  "M12 4a8 8 0 100 16 8 8 0 000-16z",
  "M4 20l5-1 11-11-4-4L5 15z",
  "M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7zM4 4l16 16",
  "REDACT",
  "M5 19L19 5M9 5h10v10",
  "M5 6V4h14v2M12 4v16M9 20h6",
  "M4 20l4-1L19 8a2 2 0 00-3-3L5 16z",
  "M4 18c4-8 8 2 15-11M14 6h5v5",
  "M8 20h12M5 16l9-11 6 5-8 10H9z",
];

const Region = ({ size, opacity }: { size: { x: number; y: number; w: number; h: number }; opacity: number }) => (
  <div style={{ position: "absolute", inset: 0, opacity }}>
    <div style={{ position: "absolute", left: size.x, top: size.y, width: size.w, height: size.h, boxShadow: "0 0 0 3000px rgba(0,0,0,.48)", outline: `2px solid ${ACCENT}` }}>
      {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => (
        <span key={`${a}${b}`} style={{ position: "absolute", left: a * size.w - 6, top: b * size.h - 6, width: 12, height: 12, background: "#fff", border: `1.5px solid ${ACCENT}`, borderRadius: 2 }} />
      ))}
    </div>
    <span style={{ position: "absolute", left: size.x, top: size.y - 42, padding: "5px 10px", borderRadius: 6, background: "rgba(15,16,21,.92)", border: "1px solid rgba(255,255,255,.12)", color: "#f8fafc", font: `500 17px ${MONO}` }}>
      {Math.round(size.w * 2)} × {Math.round(size.h * 2)}
    </span>
  </div>
);

// Cursor path: [frame, x, y]. Moves are eased between these points.
const CURSOR: [number, number, number][] = [
  [0, 1250, 860], [50, 1250, 860],
  [72, REGION.x, REGION.y], [104, REGION.x + REGION.w, REGION.y + REGION.h],
  [130, 805, 618], [136, 805, 618],
  [158, 928, 716],
  [170, 555, 330], [190, 1118, 330],
  [202, 580, 504], [220, 992, 504],
  [246, 1450, 80], [258, 1450, 80],
  [284, 1640, 770], [328, 1480, 470],
  [346, 1560, 860], [424, 693, 618], [440, 693, 618], [492, 900, 1200],
];

const cursorAt = (f: number) => {
  let i = 0;
  while (i < CURSOR.length - 2 && f >= CURSOR[i + 1][0]) i++;
  const [a, ax, ay] = CURSOR[i];
  const [b, bx, by] = CURSOR[i + 1];
  const t = ramp(f, a, b, 0, 1, inOut);
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
};

const Caption = ({ text, from, to, frame, story }: { text: string; from: number; to: number; frame: number; story: boolean }) => {
  const opacity = ramp(frame, from, from + 8) * ramp(frame, to - 6, to, 1, 0);
  if (opacity <= 0) return null;
  return (
    <div style={{ position: "absolute", left: story ? 60 : 150, right: story ? 60 : 150, top: story ? 1280 : 900, opacity, transform: `translateY(${ramp(frame, from, from + 10, 14, 0)}px)`, font: `700 ${story ? 68 : 60}px/1.15 ${SANS}`, letterSpacing: "-0.02em", color: INK }}>
      {text}
    </div>
  );
};

// Story format only: the camera follows the action, centered above the caption.
const CAMERA: [number, number, number, number][] = [
  [0, 640, 430, 1.04],
  [AT.editorOpen, 640, 430, 1.04],
  [AT.editorOpen + 14, 960, 408, 0.74],
  [AT.clickCopy + 4, 960, 408, 0.74],
  [AT.thumbIn + 12, 1485, 470, 1.45],
  [AT.drop + 24, 1485, 470, 1.45],
  [BEAT.previous + 4, 640, 430, 1.04],
  [BEAT.end + 12, 640, 430, 1.04],
];

const cameraAt = (f: number) => {
  const frames = CAMERA.map((k) => k[0]);
  const at = (i: number) => interpolate(f, frames, CAMERA.map((k) => k[i]), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inOut });
  return `translate(540px, 740px) scale(${at(3)}) translate(${-at(1)}px, ${-at(2)}px)`;
};

const Intro = ({ c, story }: { c: (typeof COPY)[Locale]; story: boolean }) => {
  const f = useCurrentFrame();
  const beats: [string, number, number][] = [
    [c.intro1, 12, 48],
    [c.intro2, 52, 94],
    [c.intro3, 98, 144],
  ];
  return (
    <AbsoluteFill style={{ background: BG, alignItems: "center", justifyContent: "center", opacity: ramp(f, INTRO - 6, INTRO + 6, 1, 0) }}>
      <Img src={staticFile("eisen-horizontal-reversed.svg")} style={{ height: story ? 120 : 130, marginTop: -180, opacity: ramp(f, 2, 14), transform: `scale(${ramp(f, 2, 22, 0.92, 1)})` }} />
      {beats.map(([text, from, to]) => {
        const opacity = ramp(f, from, from + 8) * ramp(f, to - 5, to, 1, 0);
        if (opacity <= 0) return null;
        return (
          <div key={text} style={{ position: "absolute", top: "50%", left: story ? 60 : 150, right: story ? 60 : 150, textAlign: "center", opacity, transform: `translateY(${ramp(f, from, from + 10, 14, 0)}px)`, font: `700 ${story ? 76 : 72}px/1.15 ${SANS}`, letterSpacing: "-0.025em", color: INK }}>
            {text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Promo = ({ locale, format }: { locale: Locale; format: Format }) => {
  const f = useCurrentFrame();
  const c = COPY[locale];
  const story = format === "story";
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: SANS }}>
      <style>{fonts}</style>
      <Audio src={staticFile("soundtrack.wav")} />
      <Sequence from={INTRO}>
        <Scene c={c} story={story} />
      </Sequence>
      {f < INTRO + 6 && <Intro c={c} story={story} />}
    </AbsoluteFill>
  );
};

const Scene = ({ c, story }: { c: (typeof COPY)[Locale]; story: boolean }) => {
  const f = useCurrentFrame();

  const inEditor = f >= AT.editorOpen && f < AT.thumbIn;
  const inEnd = f >= BEAT.end;
  const lines = f < BEAT.previous ? CONFIG : LOG;
  const title = f < BEAT.previous ? "deploy.env" : "Terminal";

  // First selection, then the same region returning instantly.
  const firstDrag = ramp(f, AT.dragStart, AT.dragEnd, 0, 1, inOut);
  const firstRegion = f >= AT.dragStart && f < AT.editorOpen;
  const repeatRegion = f >= AT.regionBack && f < AT.ocrDone - 6;
  const regionSize = firstRegion ? { ...REGION, w: REGION.w * firstDrag, h: REGION.h * firstDrag } : REGION;

  const editorIn = ramp(f, AT.editorOpen, AT.editorOpen + 12);
  const editorOut = ramp(f, AT.clickCopy + 4, AT.thumbIn, 1, 0, inOut);

  // Thumbnail floats in, then follows the cursor to the chat.
  const thumbScale = 300 / REGION.w;
  const cursor = cursorAt(f);
  const thumbIn = ramp(f, AT.thumbIn, AT.thumbIn + 12);
  const dragging = f >= AT.grab && f < AT.drop;
  const homeX = 1490;
  const homeY = 690;
  const thumbX = dragging ? cursor.x - 150 : homeX;
  const thumbY = dragging ? cursor.y - 70 : homeY + (1 - thumbIn) * 40;
  const showThumb = f >= AT.thumbIn && f < AT.drop;
  const dropped = ramp(f, AT.drop, AT.drop + 9);

  const pressed =
    (f >= AT.dragStart && f < AT.dragEnd) ||
    (f >= AT.redact1Start && f < AT.redact1End) ||
    (f >= AT.redact2Start && f < AT.redact2End) ||
    dragging ||
    [AT.clickEdit, AT.pickRedact, AT.clickCopy, AT.clickOcr].some((a) => f >= a - 1 && f < a + 3);

  const freezeFlash = ramp(f, AT.freeze, AT.freeze + 2, 0, 0.16) * ramp(f, AT.freeze + 2, AT.freeze + 9, 1, 0);
  const endIn = ramp(f, BEAT.end, BEAT.end + 12);
  const keyPlace: CSSProperties = story ? { left: 60, top: 1130 } : { right: 150, top: 880 };

  return (
    <AbsoluteFill>
      {/* Desktop */}
      <AbsoluteFill style={{ background: "linear-gradient(160deg,#23252c 0%,#141519 60%,#0f1015 100%)", opacity: 1 - endIn }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: story ? cameraAt(f) : undefined }}>
        {!story && (
          <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 18, padding: "0 24px", background: "rgba(0,0,0,.3)" }}>
            <Img src={staticFile("eisen-mark-reversed.svg")} style={{ height: 22 }} />
            <span style={{ font: `500 15px ${SANS}`, color: "#d4d4d8" }}>10:42</span>
          </div>
        )}

        <Window {...WIN} title={title}>
          <div style={{ position: "absolute", left: -WIN.x, top: -WIN.y, width: 1920, height: 1080 }}>
            <Lines lines={lines} />
          </div>
        </Window>

        <Window {...CHAT} title={c.chatName}>
          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
            <div style={{ padding: "12px 16px", borderRadius: 14, background: "#2a2b31", color: INK, font: `500 21px/1.35 ${SANS}`, maxWidth: 480 }}>{c.chatMsg1}</div>
            {f >= AT.drop && (
              <div style={{ alignSelf: "flex-end", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end", opacity: dropped, transform: `scale(${0.94 + 0.06 * dropped})`, transformOrigin: "100% 0" }}>
                <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,.15)" }}>
                  <Capture scale={480 / REGION.w} frame={f} showRedactions />
                </div>
                <div style={{ padding: "12px 16px", borderRadius: 14, background: ACCENT, color: "#fff", font: `500 21px/1.35 ${SANS}` }}>{c.chatMsg2}</div>
              </div>
            )}
          </div>
        </Window>

        {(firstRegion || repeatRegion) && <Region size={regionSize} opacity={firstRegion ? 1 : ramp(f, AT.regionBack, AT.regionBack + 2)} />}
        {f >= AT.toolbar && f < AT.editorOpen && (
          <OverlayBar x={REGION.x + REGION.w - 470} y={REGION.y + REGION.h + 14} copy={c} active={f >= AT.clickEdit - 4 ? "edit" : null} opacity={ramp(f, AT.toolbar, AT.toolbar + 5)} />
        )}
        {f >= AT.regionBack + 4 && repeatRegion && (
          <OverlayBar x={REGION.x + REGION.w - 470} y={REGION.y + REGION.h + 14} copy={c} active={f >= AT.clickOcr - 4 ? "ocr" : null} opacity={ramp(f, AT.regionBack + 4, AT.regionBack + 9)} />
        )}

        {/* OCR scan, then the same confirmation toast the app shows */}
        {f >= AT.clickOcr && f < AT.ocrDone - 6 && (
          <div style={{ position: "absolute", left: REGION.x, width: REGION.w, top: REGION.y + REGION.h * ramp(f, AT.clickOcr, AT.ocrDone - 6, 0, 1, inOut) - 1, height: 3, background: ACCENT, boxShadow: `0 0 18px ${ACCENT}` }} />
        )}
        {f >= AT.ocrDone && f < BEAT.end && (
          <div style={{ position: "absolute", left: story ? 400 : 1400, top: story ? 620 : 690, padding: "16px 22px", borderRadius: 12, background: "rgba(15,16,21,.94)", border: "1px solid rgba(255,255,255,.14)", color: "#fff", font: `500 22px ${SANS}`, opacity: ramp(f, AT.ocrDone, AT.ocrDone + 6) }}>
            {c.textCopied}
          </div>
        )}

        {/* Editor */}
        {inEditor && (
          <AbsoluteFill style={{ opacity: editorIn * editorOut }}>
            <div style={{ position: "absolute", inset: -2000, background: "rgba(0,0,0,.5)" }} />
            <div style={{ position: "absolute", left: 250, top: 58, width: 1420, height: 700, background: BG, borderRadius: 16, border: "1px solid rgba(255,255,255,.12)", transform: `scale(${0.97 + 0.03 * editorIn})` }}>
              <div style={{ position: "absolute", left: 80, top: 50 }}>
                <Capture scale={1.4} frame={f} showRedactions />
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 0 18px", borderBottom: "1px solid rgba(255,255,255,.08)", color: "#cbd5e1" }}>
                <span style={{ font: `600 16px ${SANS}` }}>{c.editorTitle}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "flex", padding: 7 }}><Path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M8 9h8M8 12h8M8 15h5" /></span>
                  <span style={{ display: "flex", padding: 7, borderRadius: 8, background: f >= AT.clickCopy - 4 ? "rgba(255,255,255,.16)" : "transparent", color: f >= AT.clickCopy - 4 ? "#fff" : "#cbd5e1" }}><Path d="M9 9h10v11H9zM5 15V4h10" /></span>
                  <span style={{ display: "flex", padding: 7 }}><Path d="M9 9h10v11H9zM5 15V4h10M11 14l2 2 4-4" /></span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: ACCENT, color: "#fff", font: `600 15px ${SANS}` }}><Path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />{c.save}</span>
                  <span style={{ width: 1, height: 22, background: "rgba(255,255,255,.15)" }} />
                  <span style={{ display: "flex", padding: 6 }}><Path d="M6 6l12 12M18 6L6 18" /></span>
                </div>
              </div>
              <div style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "rgba(22,24,34,.94)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 16, boxShadow: "0 16px 40px rgba(0,0,0,.7)", color: "#cbd5e1" }}>
                {EDITOR_TOOLS.map((d) =>
                  d === "REDACT" ? (
                    <span key={d} style={{ padding: 9, display: "flex", borderRadius: 9, background: f >= AT.pickRedact ? ACCENT : "transparent", color: f >= AT.pickRedact ? "#fff" : "#cbd5e1" }}>
                      <Path d="M3 7h18v10H3z" fill />
                    </span>
                  ) : (
                    <span key={d} style={{ padding: 9, display: "flex" }}><Path d={d} /></span>
                  ),
                )}
                <span style={{ width: 1, height: 24, background: "rgba(255,255,255,.15)", margin: "0 6px" }} />
                <span style={{ padding: 9, display: "flex" }}><Path d="M3 21l3-1 10-10-2-2L4 18zM13 7l4 4M15 5l2-2 4 4-2 2" /></span>
                <span style={{ width: 22, height: 22, margin: 9, borderRadius: 11, background: "#ef4444", border: "2px solid rgba(255,255,255,.7)" }} />
                <span style={{ padding: 9, display: "flex" }}><Path d="M5 12h14" /></span>
              </div>
            </div>
          </AbsoluteFill>
        )}

        {/* Floating thumbnail */}
        {showThumb && (
          <div style={{ position: "absolute", left: thumbX, top: thumbY, opacity: thumbIn, borderRadius: 10, overflow: "hidden", border: "2px solid rgba(255,255,255,.75)", boxShadow: "0 18px 40px rgba(0,0,0,.6)", transform: dragging ? "rotate(-2deg) scale(1.03)" : undefined }}>
            <Capture scale={thumbScale} frame={f} showRedactions />
          </div>
        )}

        {!inEnd && f >= 48 && <Cursor x={cursor.x} y={cursor.y} pressed={pressed} opacity={ramp(f, 48, 54)} />}

        </div>

        {/* Double-tap Option */}
        {f >= 22 && f < AT.dragStart && (
          <div style={{ ...keyPlace, position: "absolute", display: "flex", gap: 16, opacity: ramp(f, 22, 30) * ramp(f, AT.freeze + 8, AT.dragStart, 1, 0) }}>
            <Key label="⌥" down={f >= AT.tap1 && f < AT.tap1 + 4} />
            <Key label="⌥" down={f >= AT.tap2 && f < AT.tap2 + 4} />
          </div>
        )}

        {/* Ctrl+Shift+2 */}
        {f >= BEAT.previous && f < BEAT.ocr && (
          <div style={{ ...keyPlace, position: "absolute", display: "flex", gap: 16, opacity: ramp(f, BEAT.previous, BEAT.previous + 6) * ramp(f, BEAT.ocr - 8, BEAT.ocr, 1, 0) }}>
            <Key label="Ctrl" down={f >= AT.key1 && f < AT.key3 + 8} />
            <Key label="Shift" down={f >= AT.key2 && f < AT.key3 + 8} />
            <Key label="2" down={f >= AT.key3 && f < AT.key3 + 8} />
          </div>
        )}

        <AbsoluteFill style={{ background: "#fff", opacity: freezeFlash, pointerEvents: "none" }} />

        <Caption text={c.trigger} from={8} to={BEAT.select + 2} frame={f} story={story} />
        <Caption text={c.select} from={BEAT.select + 4} to={BEAT.editor} frame={f} story={story} />
        <Caption text={c.redact} from={BEAT.editor + 8} to={BEAT.thumbnail} frame={f} story={story} />
        <Caption text={c.drop} from={BEAT.thumbnail + 4} to={BEAT.previous} frame={f} story={story} />
        <Caption text={c.previous} from={BEAT.previous + 2} to={BEAT.ocr} frame={f} story={story} />
        <Caption text={c.ocr} from={BEAT.ocr + 2} to={BEAT.end} frame={f} story={story} />
      </AbsoluteFill>

      {/* End card */}
      {inEnd && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: story ? "0 60px" : "0 150px", opacity: endIn }}>
          <Img src={staticFile("eisen-horizontal-reversed.svg")} style={{ height: 96, opacity: ramp(f, AT.logo, AT.logo + 10), transform: `scale(${ramp(f, AT.logo, AT.logo + 14, 0.94, 1)})` }} />
          <div style={{ marginTop: 44, font: `700 ${story ? 84 : 72}px/1.1 ${SANS}`, letterSpacing: "-0.025em", color: INK, opacity: ramp(f, AT.logo + 6, AT.logo + 16) }}>{c.tagline}</div>
          <div style={{ marginTop: 22, font: `500 ${story ? 40 : 36}px/1.3 ${SANS}`, color: "#d4d4d8", opacity: ramp(f, AT.line, AT.line + 10) }}>{c.subline}</div>
          <div style={{ marginTop: 48, font: `600 40px ${MONO}`, color: MARK, opacity: ramp(f, AT.link, AT.link + 10) }}>eisen.a302.link</div>
          <div style={{ marginTop: 14, font: `500 24px ${SANS}`, color: MUTED, opacity: ramp(f, AT.link, AT.link + 10) }}>{c.specs}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
