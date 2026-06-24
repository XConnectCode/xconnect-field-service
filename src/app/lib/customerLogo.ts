import { projectId } from '../../../utils/supabase/info';

export function customerLogoUrl(logo?: string | null): string | null {
  if (!logo || !logo.trim()) return null;
  const v = logo.trim();
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  return `https://${projectId}.supabase.co/storage/v1/object/public/Native%20Files/Customer%20Districts_Images/${v}`;
}
