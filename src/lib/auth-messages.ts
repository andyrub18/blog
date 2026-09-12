import { m } from '../paraglide/messages'
import type { SignInErrorCode, SignUpErrorCode } from './auth-actions'

/**
 * One translation of each auth refusal, shared by every form that can hit it.
 *
 * Three forms return codes from the same two unions. Keeping a map in each of
 * them meant a new code silently had no message on the forms nobody thought to
 * update; here the compiler refuses to build until every code has words.
 */
export const SIGN_IN_ERROR_MESSAGE: Record<SignInErrorCode, () => string> = {
  RATE_LIMITED: m.auth_login_errors_rateLimited,
  ACCOUNT_BLOCKED: m.auth_login_errors_accountBlocked,
  INVALID_EMAIL_OR_PASSWORD: m.auth_login_errors_invalidCredentials,
  INVALID_EMAIL: m.auth_login_errors_emailInvalid,
  INVALID_PASSWORD: m.auth_login_errors_passwordTooShort,
  EMAIL_NOT_VERIFIED: m.auth_login_errors_emailNotVerified,
  USER_NOT_FOUND: m.auth_login_errors_userNotFound,
  CREDENTIAL_ACCOUNT_NOT_FOUND: m.auth_login_errors_accountNotFound,
  FAILED_TO_CREATE_SESSION: m.auth_login_errors_sessionFailed,
  UNEXPECTED: m.auth_login_errors_unexpected,
}

export const SIGN_UP_ERROR_MESSAGE: Record<SignUpErrorCode, () => string> = {
  RATE_LIMITED: m.auth_register_errors_rateLimited,
  CAPTCHA_FAILED: m.auth_register_errors_captchaFailed,
  INVALID_EMAIL: m.auth_login_errors_emailInvalid,
  INVALID_PASSWORD: m.auth_login_errors_passwordTooShort,
  INVALID_NAME: m.auth_register_errors_nameInvalid,
  INVALID_DATE_OF_BIRTH: m.auth_register_errors_dobInvalid,
  TOO_YOUNG: m.auth_register_errors_tooYoung,
  INVALID_ESSAY: m.auth_register_errors_essayTooShort,
  INVALID_PDF: m.auth_register_errors_invalidPdf,
  PDF_TOO_LARGE: m.auth_register_errors_pdfTooLarge,
  EMAIL_ALREADY_EXISTS: m.auth_register_errors_emailExists,
  INVITATION_NOT_FOUND: m.auth_register_errors_invitationNotFound,
  INVITATION_EXPIRED: m.auth_register_errors_invitationExpired,
  INVITATION_ALREADY_USED: m.auth_register_errors_invitationUsed,
  INVITATION_REVOKED: m.auth_register_errors_invitationRevoked,
  INVALID_PLAN: m.auth_register_errors_invalidPlan,
  UNEXPECTED: m.auth_register_errors_unexpected,
}
