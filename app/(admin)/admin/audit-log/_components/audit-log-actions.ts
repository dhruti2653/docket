// Display-only labels for known audit action slugs. A missing entry never breaks
// anything — getAuditActionLabel falls back to the raw slug, and the filter's
// options come from a live SELECT DISTINCT — but keep it current for readability.
export const AUDIT_ACTIONS: { label: string; value: string }[] = [
  { label: "Logout", value: "auth.logout" },
  { label: "Magic Link Sent", value: "auth.magic_link_sent" },
  { label: "Password Reset Requested", value: "auth.password_reset_requested" },
  { label: "Role Updated (Orbit)", value: "orbit.user_role_updated" },
  { label: "User Banned (Orbit)", value: "orbit.user_banned" },
  { label: "User Unbanned (Orbit)", value: "orbit.user_unbanned" },
  { label: "Name Updated", value: "profile.name_updated" },
  { label: "Email Updated", value: "profile.email_updated" },
  { label: "Session Revoked", value: "profile.session_revoked" },
  { label: "Other Sessions Revoked", value: "profile.other_sessions_revoked" },
  { label: "Account Deleted", value: "profile.account_deleted" },
  { label: "Data Exported", value: "profile.data_exported" },
  { label: "User Created", value: "user.created" },
  { label: "User Role Updated", value: "user.role_updated" },
  // Slugs stay `user.banned`/`user.unbanned` so historical rows keep matching
  // the filter — only the display label follows the UI's "deactivate" wording.
  { label: "User Deactivated", value: "user.banned" },
  { label: "User Reactivated", value: "user.unbanned" },
  { label: "User Deleted", value: "user.deleted" },
  { label: "Password Set by Admin", value: "user.password_set_by_admin" },
  { label: "Ticket Deleted", value: "ticket.deleted" },
  { label: "Bulk Update", value: "ticket.bulk_update" },
  { label: "Bulk Delete", value: "ticket.bulk_delete" },
  { label: "Ticket Merged", value: "ticket.merged" },
  { label: "Ticket Split", value: "ticket.split" },
  { label: "Canned Response Deleted", value: "canned_response.deleted" },
  { label: "Webhook Created", value: "webhook.created" },
  { label: "Webhook Updated", value: "webhook.updated" },
  { label: "Webhook Deleted", value: "webhook.deleted" },
  { label: "Webhook Secret Rotated", value: "webhook.secret_rotated" },
  { label: "Status Created", value: "ticket_config.status_created" },
  { label: "Status Updated", value: "ticket_config.status_updated" },
  { label: "Status Deleted", value: "ticket_config.status_deleted" },
  { label: "Category Created", value: "ticket_config.category_created" },
  { label: "Category Updated", value: "ticket_config.category_updated" },
  { label: "Category Deleted", value: "ticket_config.category_deleted" },
  { label: "Priority Created", value: "ticket_config.priority_created" },
  { label: "Priority Updated", value: "ticket_config.priority_updated" },
  { label: "Priority Deleted", value: "ticket_config.priority_deleted" },
  { label: "SLA Policy Created", value: "sla_policy.created" },
  { label: "SLA Policy Updated", value: "sla_policy.updated" },
  { label: "SLA Policy Deleted", value: "sla_policy.deleted" },
  { label: "Custom Field Created", value: "custom_field.created" },
  { label: "Custom Field Updated", value: "custom_field.updated" },
  { label: "Custom Field Deleted", value: "custom_field.deleted" },
  { label: "Email Template Updated", value: "email_template.updated" },
  { label: "Platform Settings Updated", value: "settings.updated" },
  { label: "API Key Created", value: "api_key.created" },
  { label: "API Key Revoked", value: "api_key.revoked" },
];

const AUDIT_ACTION_LABEL_MAP: Record<string, string> = Object.fromEntries(
  AUDIT_ACTIONS.map((a) => [a.value, a.label])
);

export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL_MAP[action] ?? action;
}
