/**
 * Onboarding types — app launch phase routing and profile capture.
 */

export type AppLaunchPhase = "onboarding" | "ready";

export type OnboardingGoal =
  | "personal_assistant"
  | "family_hub"
  | "work_collaboration"
  | "exploration";

export type OnboardingCaptureMode = "typing" | "preset" | "voice";

export interface OnboardingProfile {
  /** Unique profile ID (UUID) */
  id: string;
  /** Display name chosen during onboarding */
  displayName: string;
  /** Primary goal selected */
  goal: OnboardingGoal;
  /** How the profile was captured */
  captureMode: OnboardingCaptureMode;
  /** Optional free-text description of what they want */
  goalDescription?: string;
  /** Whether onboarding is complete */
  completed: boolean;
  /** ISO timestamp */
  completedAt?: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
}

export interface OnboardingState {
  phase: AppLaunchPhase;
  profile?: OnboardingProfile;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  phase: "onboarding",
};
