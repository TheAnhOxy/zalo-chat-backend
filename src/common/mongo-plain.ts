/** Mongoose toObject() không khớp Record<string, unknown> — ép kiểu an toàn cho API */
export function toPlainDoc(doc: { toObject(): unknown }): Record<string, unknown> {
  return doc.toObject() as Record<string, unknown>;
}
