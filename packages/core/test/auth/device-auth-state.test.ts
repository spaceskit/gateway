import { describe, expect, test } from "bun:test";
import {
  INITIAL_DEVICE_AUTH_STATE,
  transitionDeviceAuth,
} from "../../src/auth/device-auth-state.js";
import type {
  DeviceAuthState,
  DeviceAuthEvent,
} from "../../src/auth/device-auth-state.js";

describe("INITIAL_DEVICE_AUTH_STATE", () => {
  test("phase is unregistered", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.phase).toBe("unregistered");
  });

  test("biometricAvailability is available", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.biometricAvailability).toBe("available");
  });

  test("isFirstConnect is true", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.isFirstConnect).toBe(true);
  });

  test("deviceId is undefined", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.deviceId).toBeUndefined();
  });

  test("principalId is undefined", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.principalId).toBeUndefined();
  });

  test("lastError is undefined", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.lastError).toBeUndefined();
  });

  test("lastAuthenticatedAt is undefined", () => {
    expect(INITIAL_DEVICE_AUTH_STATE.lastAuthenticatedAt).toBeUndefined();
  });
});

describe("transitionDeviceAuth", () => {
  test("unregistered + biometric_requested -> pending_biometric", () => {
    const next = transitionDeviceAuth(INITIAL_DEVICE_AUTH_STATE, {
      type: "biometric_requested",
    });
    expect(next.phase).toBe("pending_biometric");
    expect(next.lastError).toBeUndefined();
  });

  test("pending_biometric + biometric_succeeded -> registered", () => {
    const pending: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "pending_biometric",
    };
    const next = transitionDeviceAuth(pending, {
      type: "biometric_succeeded",
      deviceId: "dev-001",
      principalId: "princ-001",
    });
    expect(next.phase).toBe("registered");
    expect(next.deviceId).toBe("dev-001");
    expect(next.principalId).toBe("princ-001");
    expect(next.isFirstConnect).toBe(false);
    expect(next.lastError).toBeUndefined();
  });

  test("pending_biometric + biometric_failed -> biometric_failed with lastError", () => {
    const pending: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "pending_biometric",
    };
    const next = transitionDeviceAuth(pending, {
      type: "biometric_failed",
      error: "Touch ID not recognized",
    });
    expect(next.phase).toBe("biometric_failed");
    expect(next.lastError).toBe("Touch ID not recognized");
  });

  test("pending_biometric + biometric_cancelled -> biometric_failed with cancelled error", () => {
    const pending: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "pending_biometric",
    };
    const next = transitionDeviceAuth(pending, {
      type: "biometric_cancelled",
    });
    expect(next.phase).toBe("biometric_failed");
    expect(next.lastError).toBe("cancelled");
  });

  test("biometric_failed + biometric_requested -> pending_biometric (retry)", () => {
    const failed: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "biometric_failed",
      lastError: "some error",
    };
    const next = transitionDeviceAuth(failed, {
      type: "biometric_requested",
    });
    expect(next.phase).toBe("pending_biometric");
    expect(next.lastError).toBeUndefined();
  });

  test("registered + session_authenticated -> authenticated with timestamp", () => {
    const registered: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "registered",
      deviceId: "dev-001",
      principalId: "princ-001",
      isFirstConnect: false,
    };
    const ts = "2026-02-28T12:00:00Z";
    const next = transitionDeviceAuth(registered, {
      type: "session_authenticated",
      timestamp: ts,
    });
    expect(next.phase).toBe("authenticated");
    expect(next.lastAuthenticatedAt).toBe(ts);
    expect(next.deviceId).toBe("dev-001");
    expect(next.principalId).toBe("princ-001");
  });

  test("authenticated + session_disconnected -> registered (device info preserved)", () => {
    const authenticated: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "authenticated",
      deviceId: "dev-001",
      principalId: "princ-001",
      isFirstConnect: false,
      lastAuthenticatedAt: "2026-02-28T12:00:00Z",
    };
    const next = transitionDeviceAuth(authenticated, {
      type: "session_disconnected",
    });
    expect(next.phase).toBe("registered");
    expect(next.deviceId).toBe("dev-001");
    expect(next.principalId).toBe("princ-001");
    expect(next.lastAuthenticatedAt).toBe("2026-02-28T12:00:00Z");
  });

  test("authenticated + device_revoked -> unregistered (all cleared)", () => {
    const authenticated: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "authenticated",
      deviceId: "dev-001",
      principalId: "princ-001",
      isFirstConnect: false,
      lastAuthenticatedAt: "2026-02-28T12:00:00Z",
      biometricAvailability: "available",
    };
    const next = transitionDeviceAuth(authenticated, {
      type: "device_revoked",
    });
    expect(next.phase).toBe("unregistered");
    expect(next.deviceId).toBeUndefined();
    expect(next.principalId).toBeUndefined();
    expect(next.lastAuthenticatedAt).toBeUndefined();
    // isFirstConnect is false after revocation (not first-ever)
    expect(next.isFirstConnect).toBe(false);
    // biometricAvailability preserved
    expect(next.biometricAvailability).toBe("available");
  });

  test("no-op: unregistered + session_authenticated -> still unregistered", () => {
    const next = transitionDeviceAuth(INITIAL_DEVICE_AUTH_STATE, {
      type: "session_authenticated",
      timestamp: "2026-02-28T12:00:00Z",
    });
    expect(next.phase).toBe("unregistered");
    expect(next).toBe(INITIAL_DEVICE_AUTH_STATE); // same reference, no change
  });

  test("no-op: unregistered + session_disconnected -> still unregistered", () => {
    const next = transitionDeviceAuth(INITIAL_DEVICE_AUTH_STATE, {
      type: "session_disconnected",
    });
    expect(next).toBe(INITIAL_DEVICE_AUTH_STATE);
  });

  test("no-op: unregistered + device_revoked -> still unregistered", () => {
    const next = transitionDeviceAuth(INITIAL_DEVICE_AUTH_STATE, {
      type: "device_revoked",
    });
    expect(next).toBe(INITIAL_DEVICE_AUTH_STATE);
  });

  test("registered + device_registered -> updates device/principal info", () => {
    const registered: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "registered",
      deviceId: "dev-old",
      principalId: "princ-old",
      isFirstConnect: false,
    };
    const next = transitionDeviceAuth(registered, {
      type: "device_registered",
      deviceId: "dev-new",
      principalId: "princ-new",
    });
    expect(next.phase).toBe("registered");
    expect(next.deviceId).toBe("dev-new");
    expect(next.principalId).toBe("princ-new");
  });

  test("no-op: pending_biometric + session_authenticated -> still pending", () => {
    const pending: DeviceAuthState = {
      ...INITIAL_DEVICE_AUTH_STATE,
      phase: "pending_biometric",
    };
    const next = transitionDeviceAuth(pending, {
      type: "session_authenticated",
      timestamp: "2026-02-28T12:00:00Z",
    });
    expect(next).toBe(pending);
  });

  test("full lifecycle: unregistered -> registered -> authenticated -> disconnected -> authenticated", () => {
    let state: DeviceAuthState = INITIAL_DEVICE_AUTH_STATE;

    // Step 1: biometric requested
    state = transitionDeviceAuth(state, { type: "biometric_requested" });
    expect(state.phase).toBe("pending_biometric");

    // Step 2: biometric succeeded
    state = transitionDeviceAuth(state, {
      type: "biometric_succeeded",
      deviceId: "dev-lifecycle",
      principalId: "princ-lifecycle",
    });
    expect(state.phase).toBe("registered");

    // Step 3: session authenticated
    const ts1 = "2026-02-28T10:00:00Z";
    state = transitionDeviceAuth(state, {
      type: "session_authenticated",
      timestamp: ts1,
    });
    expect(state.phase).toBe("authenticated");
    expect(state.lastAuthenticatedAt).toBe(ts1);

    // Step 4: session disconnected
    state = transitionDeviceAuth(state, { type: "session_disconnected" });
    expect(state.phase).toBe("registered");
    expect(state.deviceId).toBe("dev-lifecycle");

    // Step 5: re-authenticate
    const ts2 = "2026-02-28T11:00:00Z";
    state = transitionDeviceAuth(state, {
      type: "session_authenticated",
      timestamp: ts2,
    });
    expect(state.phase).toBe("authenticated");
    expect(state.lastAuthenticatedAt).toBe(ts2);
  });
});
