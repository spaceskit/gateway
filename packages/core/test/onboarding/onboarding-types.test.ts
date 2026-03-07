import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ONBOARDING_STATE,
} from "../../src/onboarding/types.js";
import type {
  AppLaunchPhase,
  OnboardingGoal,
  OnboardingCaptureMode,
  OnboardingProfile,
  OnboardingState,
} from "../../src/onboarding/types.js";

describe("DEFAULT_ONBOARDING_STATE", () => {
  test("phase is 'onboarding'", () => {
    expect(DEFAULT_ONBOARDING_STATE.phase).toBe("onboarding");
  });

  test("profile is undefined", () => {
    expect(DEFAULT_ONBOARDING_STATE.profile).toBeUndefined();
  });
});

describe("OnboardingGoal values", () => {
  test("all goal values are assignable", () => {
    const goals: OnboardingGoal[] = [
      "personal_assistant",
      "family_hub",
      "work_collaboration",
      "exploration",
    ];
    expect(goals).toHaveLength(4);
    for (const g of goals) {
      expect(typeof g).toBe("string");
    }
  });
});

describe("OnboardingCaptureMode values", () => {
  test("all capture mode values are assignable", () => {
    const modes: OnboardingCaptureMode[] = ["typing", "preset", "voice"];
    expect(modes).toHaveLength(3);
    for (const m of modes) {
      expect(typeof m).toBe("string");
    }
  });
});

describe("OnboardingProfile interface", () => {
  test("complete profile object is assignable", () => {
    const now = new Date().toISOString();
    const profile: OnboardingProfile = {
      id: "abc-123",
      displayName: "Test User",
      goal: "personal_assistant",
      captureMode: "typing",
      goalDescription: "I want a smart assistant",
      completed: true,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    expect(profile.id).toBe("abc-123");
    expect(profile.displayName).toBe("Test User");
    expect(profile.goal).toBe("personal_assistant");
    expect(profile.captureMode).toBe("typing");
    expect(profile.goalDescription).toBe("I want a smart assistant");
    expect(profile.completed).toBe(true);
    expect(profile.completedAt).toBe(now);
    expect(profile.createdAt).toBe(now);
    expect(profile.updatedAt).toBe(now);
  });

  test("profile without optional fields is valid", () => {
    const now = new Date().toISOString();
    const profile: OnboardingProfile = {
      id: "def-456",
      displayName: "Minimal",
      goal: "exploration",
      captureMode: "preset",
      completed: false,
      createdAt: now,
      updatedAt: now,
    };

    expect(profile.goalDescription).toBeUndefined();
    expect(profile.completedAt).toBeUndefined();
    expect(profile.completed).toBe(false);
  });
});

describe("OnboardingState with profile", () => {
  test("ready state with profile", () => {
    const now = new Date().toISOString();
    const state: OnboardingState = {
      phase: "ready",
      profile: {
        id: "p-1",
        displayName: "Ready User",
        goal: "work_collaboration",
        captureMode: "voice",
        completed: true,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    };

    expect(state.phase).toBe("ready");
    expect(state.profile).toBeDefined();
    expect(state.profile!.completed).toBe(true);
  });

  test("AppLaunchPhase values", () => {
    const phases: AppLaunchPhase[] = ["onboarding", "ready"];
    expect(phases).toHaveLength(2);
  });
});
