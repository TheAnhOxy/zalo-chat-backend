const VN_PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)\d{8}$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const compact = phone.replace(/[\s.-]/g, '');
  if (compact.startsWith('+84')) {
    return `0${compact.slice(3)}`;
  }
  return compact;
}

export function isValidVietnamPhone(phone: string): boolean {
  return VN_PHONE_REGEX.test(phone);
}

export function isStrongPassword(password: string): boolean {
  return STRONG_PASSWORD_REGEX.test(password);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function generateOtpCode(): string {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

export function generateOtpSessionId(): string {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `OTP_${Date.now()}_${random}`;
}
