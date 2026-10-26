export class AppError extends Error {
  constructor(status, code, message, details = {}) { super(message); Object.assign(this, { status, code, details }); }
}
export function resourceId(value) {
  if (!/^[1-9]\d{0,8}$/.test(value)) throw new AppError(400, 'INVALID_ID', 'Use a positive numeric resource ID.');
  return Number(value);
}
export function validateReservation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'INVALID_BODY', 'Send a JSON object containing your reservation details.');
  const allowed = ['showtimeId', 'seatIds', 'customerName', 'customerEmail'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AppError(422, 'VALIDATION_ERROR', 'Unexpected fields. Prices and totals are calculated by the server.');
  const fields = {};
  if (typeof body.customerName !== 'string' || !body.customerName.trim()) fields.customerName = 'Please enter your name.';
  else if (body.customerName.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(body.customerName)) fields.customerName = 'Use a name of 100 characters or fewer, without control characters.';
  if (typeof body.customerEmail !== 'string' || body.customerEmail.length > 254 || !/^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/.test(body.customerEmail.trim())) fields.customerEmail = 'Enter a valid email address.';
  if (!Number.isSafeInteger(body.showtimeId) || body.showtimeId < 1) fields.showtimeId = 'Choose a valid showtime.';
  if (!Array.isArray(body.seatIds) || body.seatIds.length === 0) fields.seatIds = 'Choose at least one seat.';
  else if (body.seatIds.length > 6) fields.seatIds = 'You can reserve a maximum of 6 seats.';
  else if (body.seatIds.some(id => typeof id !== 'string' || !/^[A-Z][1-9]\d?$/.test(id))) fields.seatIds = 'Use valid seat IDs, such as C4.';
  else if (new Set(body.seatIds).size !== body.seatIds.length) fields.seatIds = 'Each seat can only be selected once.';
  if (Object.keys(fields).length) throw new AppError(422, 'VALIDATION_ERROR', Object.values(fields)[0], { fields });
  return { ...body, customerName: body.customerName.trim(), customerEmail: body.customerEmail.trim().toLowerCase() };
}
