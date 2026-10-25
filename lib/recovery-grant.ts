// Marks a session as having arrived from a password-reset link. Kept
// server-side in an httpOnly cookie rather than a URL parameter, so an
// ordinary signed-in session can't claim it and skip the current-password
// check that protects an unattended browser.
export const RECOVERY_COOKIE = "evolve_recovery";
export const RECOVERY_MAX_AGE = 60 * 15; // long enough to choose a password
