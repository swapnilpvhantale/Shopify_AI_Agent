const ALLOWED_ROLES = new Set(["admin", "staff"]);

/**
 * Gate for write actions: the operator's role (set once per session from the
 * frontend's role picker, never taken from the model) must be admin or
 * staff, AND the model must have passed confirmed: true after explicitly
 * asking the operator to confirm. Never throws - callers turn a rejection
 * into a clean tool error.
 */
export function requireApproval({ role, confirmed }) {
  if (!ALLOWED_ROLES.has(role)) {
    return {
      approved: false,
      reason: `Role "${role}" is not permitted to perform this action. Requires "admin" or "staff".`,
    };
  }
  if (confirmed !== true) {
    return {
      approved: false,
      reason: "This action requires explicit confirmation (confirmed: true) before it runs.",
    };
  }
  return { approved: true };
}
