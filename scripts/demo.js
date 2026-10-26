// Run against the live local server; this intentionally creates a real demo reservation.
const base = process.env.DEMO_URL || 'http://localhost:3000';
async function call(path, body) {
  const response = await fetch(base + '/api' + path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  const result = await response.json(); return {status:response.status,...result};
}
function expect(result, status, label) { if (result.status !== status) throw new Error(`${label}: expected ${status}, received ${result.status}: ${result.message}`); console.log(`${label}: HTTP ${result.status}${result.message ? ` — ${result.message}` : ''}`); }
try {
  const movies = await call('/movies'); expect(movies,200,'GET movie catalog');
  const shows = await call('/movies/6/showtimes');
  const show = shows.data?.find(s=>s.available >= 2); if (!show) throw new Error('No upcoming screening with two free seats.');
  const availability = await call(`/showtimes/${show.id}/seats`);
  const free = availability.data.seats.filter(s=>!s.booked);
  const preferred = ['D4','H4'].map(id=>free.find(s=>s.id === id)).filter(Boolean);
  const seatIds = [...new Set([...preferred,...free].map(s=>s.id))].slice(0,2);
  const payload = {showtimeId:show.id,seatIds,customerName:'Practical Demo',customerEmail:'demo@example.com'};
  console.log(`Screening ${show.id}: Interstellar, ${new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(show.starts_at))} IST; seats ${seatIds.join(', ')}`);
  expect(await call('/reservations',{...payload,customerName:'  ',customerEmail:'invalid'}),422,'Server rejects invalid customer data');
  const booking = await call('/reservations',payload); expect(booking,201,'POST successful reservation');
  console.log(`Saved ticket: ${booking.data.reference}; server total: ₹${booking.data.total}`);
  expect(await call('/reservations',payload),409,'Same seats rejected');
  expect(await call(`/reservations/${booking.data.reference}`),200,'GET saved ticket');
  console.log('Demo complete. Paste the reference into My bookings to retrieve the ticket.');
} catch(error) { console.error(error.message); process.exitCode=1; }
