export function getSerial(p: any): string {
  return p?.['serial#'] || p?.serial_number || p?.serial || '';
}
