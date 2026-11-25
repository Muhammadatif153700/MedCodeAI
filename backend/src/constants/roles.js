/**
 * Confirmed business roles from MedCodeAI Deliverable 2 (Table 2).
 */
const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  BILLING_SPECIALIST: 'BILLING_SPECIALIST',
  CODER: 'CODER',
  REVIEWER: 'REVIEWER',
});

/**
 * Proposed non-privileged registration state/role for self-registered users
 * awaiting Administrator role assignment (UC-01 / UC-05).
 * Subject to final confirmation during authentication implementation (KAN-12/KAN-13).
 */
const PENDING_ROLE = 'PENDING';

const ALL_ROLES = Object.freeze([...Object.values(ROLES), PENDING_ROLE]);

module.exports = {
  ROLES,
  PENDING_ROLE,
  ALL_ROLES,
};
