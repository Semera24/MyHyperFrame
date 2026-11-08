// Viral Karaoke Caption Presets
// Pre-configured styling tokens for high-energy social and documentary captions.

import type { CaptionStyle, CaptionContainerStyle } from "./types";

export type ViralPresetName = "hormozi" | "neon" | "clean";

export interface ViralPresetConfig {
  name: ViralPresetName;
  label: string;
  description: string;
  style: Partial<CaptionStyle>;
  containerStyle: Partial<CaptionContainerStyle>;
  wordsPerGroup: number;
}

export const VIRAL_PRESETS: Record<ViralPresetName, ViralPresetConfig> = {
  hormozi: {
    name: "hormozi",
    label: "Hormozi Viral Pop",
    description: "High-voltage yellow active highlight, bold uppercase with heavy drop shadow and spring pop",
    wordsPerGroup: 3,
    style: {
      fontFamily: "Inter, Montserrat, sans-serif",
      fontSize: 54,
      fontWeight: 900,
      textTransform: "uppercase",
      letterSpacing: -0.02,
      color: "#FFFFFF",
      activeColor: "#FFE600", // High-voltage yellow
      dimColor: "rgba(255, 255, 255, 0.45)",
      strokeWidth: 3,
      strokeColor: "#000000",
      shadows: [
        { offsetX: 0, offsetY: 4, blur: 8, color: "rgba(0, 0, 0, 0.9)" },
        { offsetX: 0, offsetY: 2, blur: 4, color: "#000000" },
      ],
      glow: null,
    },
    containerStyle: {
      backgroundColor: "transparent",
      backgroundOpacity: 0,
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 24,
      paddingRight: 24,
      borderRadius: 12,
    },
  },
  neon: {
    name: "neon",
    label: "Neon Cyberpunk",
    description: "Vibrant cyan glow with deep contrast and kinetic pulse",
    wordsPerGroup: 2,
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 52,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: 0.04,
      color: "#FFFFFF",
      activeColor: "#00F0FF", // Electric cyan
      dimColor: "rgba(160, 210, 255, 0.35)",
      strokeWidth: 1,
      strokeColor: "rgba(0, 240, 255, 0.5)",
      shadows: [
        { offsetX: 0, offsetY: 0, blur: 16, color: "rgba(0, 240, 255, 0.85)" },
        { offsetX: 0, offsetY: 0, blur: 32, color: "rgba(0, 240, 255, 0.5)" },
      ],
      glow: { blur: 20, color: "#00F0FF", opacity: 0.9 },
    },
    containerStyle: {
      backgroundColor: "rgba(5, 12, 24, 0.75)",
      backgroundOpacity: 0.75,
      paddingTop: 14,
      paddingBottom: 14,
      paddingLeft: 28,
      paddingRight: 28,
      borderRadius: 16,
      borderColor: "rgba(0, 240, 255, 0.4)",
      borderWidth: 1,
      borderStyle: "solid",
    },
  },
  clean: {
    name: "clean",
    label: "Documentary Clean",
    description: "Crisp white active text on subtle translucent backing for clarity",
    wordsPerGroup: 4,
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 44,
      fontWeight: 700,
      textTransform: "none",
      letterSpacing: -0.01,
      color: "#FFFFFF",
      activeColor: "#FFFFFF",
      dimColor: "rgba(255, 255, 255, 0.5)",
      strokeWidth: 0,
      strokeColor: "transparent",
      shadows: [{ offsetX: 0, offsetY: 2, blur: 4, color: "rgba(0, 0, 0, 0.7)" }],
      glow: null,
    },
    containerStyle: {
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      backgroundOpacity: 0.65,
      paddingTop: 10,
      paddingBottom: 10,
      paddingLeft: 20,
      paddingRight: 20,
      borderRadius: 8,
    },
  },
};
