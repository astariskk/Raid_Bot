export function normalizeRoomNumber(input) {
  return String(input ?? '').replace(/\D+/g, '');
}

