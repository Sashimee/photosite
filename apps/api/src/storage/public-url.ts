export type UploadVariants = Record<string, string> | null | undefined;

export function publicVariantUrl(
  baseUrl: string,
  variants: UploadVariants,
  variantKey: string,
): string | null {
  const key = variants?.[variantKey];
  if (!key) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, '')}/${key}`;
}
