const ALLOWED_ROLES = new Set(["admin", "staff"]);

/**
 * Gate for write actions: the caller's role must be admin or staff (never
 * shopper), AND confirmed must be true. Both conditions, not just one.
 * Never throws - callers turn a rejection into a clean tool error.
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
