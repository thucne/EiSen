import { Composition } from "remotion";
import { Promo } from "./Promo";
import { FPS, TOTAL_FRAMES } from "./cues.mjs";

const common = { component: Promo, durationInFrames: TOTAL_FRAMES, fps: FPS };
const wide = { ...common, width: 1920, height: 1080 };
const story = { ...common, width: 1080, height: 1920 };

export const Root = () => (
  <>
    <Composition id="EiSenPromoEn" {...wide} defaultProps={{ locale: "en" as const, format: "wide" as const }} />
    <Composition id="EiSenPromoVi" {...wide} defaultProps={{ locale: "vi" as const, format: "wide" as const }} />
    <Composition id="EiSenStoryEn" {...story} defaultProps={{ locale: "en" as const, format: "story" as const }} />
    <Composition id="EiSenStoryVi" {...story} defaultProps={{ locale: "vi" as const, format: "story" as const }} />
  </>
);
