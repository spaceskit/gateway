export type SpaceExperienceCaptureMode = "INHERIT" | "ENABLED" | "DISABLED";
export type SpacePrivacyMode = "STANDARD" | "INCOGNITO_SESSION";
export type ThinkingCapturePolicy = "OFF" | "SUMMARY" | "FULL";

export interface SpaceMemoryPolicy {
  experienceCapture: SpaceExperienceCaptureMode;
  privacyMode: SpacePrivacyMode;
}

export interface GatewayMemoryDefaults {
  defaultExperienceCapture: Exclude<SpaceExperienceCaptureMode, "INHERIT">;
  defaultSpacePrivacyMode: "STANDARD";
  updatedAt: Date;
}
