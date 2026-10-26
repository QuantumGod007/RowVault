import { archive } from './archive.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(value);
const format = (date, options) => new Intl.DateTimeFormat('en-IN', { timeZone:'Asia/Kolkata', ...options }).format(new Date(date));
const time = date => format(date, { hour:'numeric', minute:'2-digit', hour12:true }).toUpperCase();
const dateKey = date => format(date, { year:'numeric', month:'2-digit', day:'2-digit' });
const duration = minutes => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
let movies = [], activeMovie, showtimes = [], activeShow, availability = [], selected = new Set(), step = 'seats', submitting = false;
let filmRequest = 0, seatsRequest = 0, toastTimer;
let customer = { name:'', email:'' };

async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, { ...options, headers:{ 'Content-Type':'application/json', ...options.headers } }); }
  catch { throw new Error('Could not reach RowVault. Check your connection and try again.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('The server returned an unexpected response. Please try again.'); }
  if (!response.ok || !result.success) {
    const error = new Error(result.message || 'Something went wrong. Please try again.');
    Object.assign(error, result, { status:response.status }); throw error;
  }
  return result.data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3800); }
function image(movie, attributes = '') { return `<img src="${esc(movie.poster)}" data-fallback="${esc(movie.fallback)}" alt="${esc(movie.title)} theatrical poster" ${attributes}>`; }
document.addEventListener('error', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.dataset.fallback) { const fallback = img.dataset.fallback; delete img.dataset.fallback; img.src = fallback; }
}, true);
function openDialog(dialog) { if (!dialog.open) dialog.showModal(); }
function closeBooking() {
  if (submitting) return;
  seatsRequest++; $('#booking-dialog').close(); selected.clear(); activeShow = undefined;
  $('#film-dialog .showtime')?.focus({ preventScroll:true });
}
function navigateFilm(id) { if (location.hash === `#film-${id}`) openFilm(id); else location.hash = `film-${id}`; }
function closeFilm() { $('#film-dialog').close(); filmRequest++; if (/^#film-/.test(location.hash)) history.replaceState(null, '', '#movies'); }
function renderCard(movie) {
  return `<article class="film-card"><button class="poster-button" data-movie="${movie.id}" aria-label="Explore ${esc(movie.title)} showtimes">${image(movie, 'loading="lazy" width="500" height="750"')}<span class="poster-year">${movie.year}</span><span class="poster-action">Discover the film <span aria-hidden="true">↗</span></span></button><h3><button data-movie="${movie.id}">${esc(movie.title)}</button></h3><p class="film-meta"><span>${esc(movie.genre)}</span><span>${duration(movie.runtime)}</span></p><div class="card-footer"><span>ENGLISH <span aria-hidden="true">·</span> ${esc(movie.rating)}</span><button class="card-book" data-movie="${movie.id}" aria-label="Book ${esc(movie.title)}">Book a seat <span aria-hidden="true">↗</span></button></div></article>`;
}
function renderArchive() {
  $('#archive-gallery').innerHTML = archive.map(film => `<article class="film-card archive-card"><div class="archive-poster">${image(film, 'loading="lazy" width="500" height="750"')}<span class="poster-year">${film.year}</span></div><h3>${esc(film.title)}</h3><p class="archive-caption">${film.year} <span aria-hidden="true">/</span> FROM THE ARCHIVE</p></article>`).join('');
}
async function loadMovies() {
  try {
    movies = await api('/movies');
    $('#now-gallery').innerHTML = movies.filter(m => m.collection === 'now').map(renderCard).join('') || '<p class="empty">New films are on their way.</p>';
    $('#classics-gallery').innerHTML = movies.filter(m => m.collection === 'classics').map(renderCard).join('');
    route();
  } catch (error) { $('#now-gallery').innerHTML = `<div class="error-box error">${esc(error.message)}<button id="retry-movies">Try again</button></div>`; }
}
async function openFilm(id) {
  const request = ++filmRequest;
  activeMovie = movies.find(movie => movie.id === id);
  const dialog = $('#film-dialog');
  dialog.innerHTML = '<button class="close" data-close="film-dialog" aria-label="Close film details">×</button><p class="loading">Loading film and showtimes…</p>';
  openDialog(dialog);
  try {
    const [film, shows] = await Promise.all([api(`/movies/${id}`), api(`/movies/${id}/showtimes`)]);
    if (request !== filmRequest || !dialog.open) return;
    activeMovie = film; showtimes = shows;
    dialog.innerHTML = `<button class="close" data-close="film-dialog" aria-label="Close film details">×</button><div class="film-detail"><div class="detail-art">${image(film)}</div><div class="detail-content"><p class="eyebrow brass">${film.collection === 'classics' ? 'CLASSICS REVISITED · SPECIAL SCREENING' : 'THE CURRENT PROGRAMME'}</p><h2 id="film-title">${esc(film.title)}<span class="title-period">.</span></h2><div class="detail-meta"><span>${film.year}</span><span>${duration(film.runtime)}</span><span>${esc(film.language)}</span><span class="certificate">${esc(film.rating)} <span class="sr-only">(US rating)</span></span></div><p class="detail-description">${esc(film.synopsis)}</p><p class="director">Directed by <strong>${esc(film.director)}</strong> <span aria-hidden="true">/</span> ${esc(film.genre)}</p><div class="schedule"><div class="schedule-head"><h3>Make a date with the big screen.</h3><span>All times in IST</span></div><div class="dates" role="group" aria-label="Choose screening date"></div><div id="showtime-list"></div><p class="schedule-note"><span>From ₹250</span> per seat · Simulated screenings for an academic demonstration.</p></div></div></div>`;
    const dates = [...new Set(shows.map(show => dateKey(show.starts_at)))];
    $('.dates').innerHTML = dates.map((date, index) => {
      const source = shows.find(show => dateKey(show.starts_at) === date).starts_at;
      return `<button class="date-button" data-date="${date}" aria-pressed="${index === 0}">${format(source, { weekday:'short' }).toUpperCase()}<strong>${format(source, { day:'2-digit' })}</strong>${format(source, { month:'short' }).toUpperCase()}</button>`;
    }).join('');
    if (dates.length) renderShowtimes(dates[0]);
    else $('#showtime-list').innerHTML = '<p class="empty">No upcoming screenings. Please check back soon.</p>';
    $('.date-button')?.focus({ preventScroll:true });
  } catch (error) {
    if (request !== filmRequest) return;
    dialog.innerHTML = `<button class="close" data-close="film-dialog" aria-label="Close film details">×</button><div class="error-box error">${esc(error.message)}<button data-movie="${id}">Try again</button></div>`;
  }
}
function renderShowtimes(date) {
  const shows = showtimes.filter(show => dateKey(show.starts_at) === date);
  document.querySelectorAll('.date-button').forEach(button => button.setAttribute('aria-pressed', button.dataset.date === date));
  $('#showtime-list').innerHTML = `<p class="auditorium-name">${esc(shows[0]?.auditorium || 'The Vault')} <span class="muted">/ English · 2D</span></p><div class="showtimes">${shows.map(show => `<button class="showtime" data-showtime="${show.id}" ${show.available === 0 ? 'disabled' : ''} aria-label="Select ${esc(time(show.starts_at))}, ${show.available} seats available"><b>${esc(time(show.starts_at))}</b><small>${show.available ? `${show.available} seats available` : 'Fully reserved'}</small></button>`).join('')}</div>`;
}
async function openSeats(id) {
  const request = ++seatsRequest;
  selected.clear(); step = 'seats'; customer = { name:'', email:'' };
  activeShow = showtimes.find(show => show.id === id);
  $('#booking-dialog').innerHTML = '<p class="loading">Preparing your auditorium…</p>';
  openDialog($('#booking-dialog'));
  try {
    const data = await api(`/showtimes/${id}/seats`);
    if (request !== seatsRequest || !$('#booking-dialog').open) return;
    if (data.expired) throw new Error('This screening has started. Please choose another showtime.');
    activeShow = data.showtime; availability = data.seats;
    syncShowtimeCount();
    renderBooking();
  } catch (error) {
    if (request !== seatsRequest) return;
    $('#booking-dialog').innerHTML = `<button class="close" data-close="booking-dialog" aria-label="Back to showtimes">×</button><div class="error-box error">${esc(error.message)}<button data-showtime="${id}">Try again</button></div>`;
  }
}
function syncShowtimeCount() {
  const show = showtimes.find(show => show.id === activeShow.id);
  if (show) show.available = availability.filter(seat => !seat.booked).length;
  const date = $('.date-button[aria-pressed=true]')?.dataset.date;
  if (date) renderShowtimes(date);
}
function chosenSeats() { return availability.filter(seat => selected.has(seat.id)); }
function seatSummary() {
  const seats = chosenSeats();
  const categories = [...new Set(seats.map(seat => seat.category))];
  return `<p class="eyebrow brass">YOUR EVENING, RESERVED</p><h3 class="summary-title">${esc(activeMovie.title)}</h3><p class="summary-meta">${esc(format(activeShow.starts_at, { weekday:'short', day:'numeric', month:'short' }))} · ${esc(time(activeShow.starts_at))}<br>${esc(activeShow.auditorium)}<br>English · 2D</p><div class="summary-line"></div><p class="summary-label">YOUR SEATS <span>${seats.length} / 6</span></p><p class="selected-seats ${seats.length ? '' : 'empty-selection'}">${seats.length ? seats.map(seat => esc(seat.id)).join(' &nbsp; ') : 'Pick your favourite spot.'}</p><div class="price-lines">${categories.map(category => { const group = seats.filter(seat => seat.category === category); return `<div><span>${esc(category)} × ${group.length}</span><span>${money(group.reduce((sum, seat) => sum + seat.price, 0))}</span></div>`; }).join('')}</div><div class="summary-line"></div><p class="summary-note">${step === 'seats' ? 'A little closer, a little further back.<br>Every seat has a story.' : 'Your seats are confirmed only when your reservation is saved.'}<br>No payment required. This is a demo.</p>`;
}
function renderSeatMap() {
  let html = '<div class="cinema-screen"><div class="screen-curve"></div><span>SCREEN THIS WAY</span></div><div class="seat-map" role="group" aria-label="Choose up to six seats">';
  for (const row of 'ABCDEFGH') {
    const seats = availability.filter(seat => seat.id.startsWith(row));
    if ('ACG'.includes(row)) html += `<div class="seat-category">${esc(seats[0].category).toUpperCase()} <small>${money(seats[0].price)}</small></div>`;
    html += `<div class="seat-row"><span class="row-label" aria-hidden="true">${row}</span>`;
    seats.forEach((seat, index) => {
      if (index === 5) html += '<span aria-hidden="true"></span>';
      html += `<button class="seat ${seat.category === 'Recliner' ? 'recliner' : ''}" data-seat="${seat.id}" aria-pressed="${selected.has(seat.id)}" aria-label="Seat ${seat.id}, ${seat.category}, ${money(seat.price)}${seat.booked ? ', reserved' : ''}" ${seat.booked ? 'disabled' : ''}>${seat.booked ? '×' : selected.has(seat.id) ? '✓' : seat.id.slice(1)}</button>`;
    });
    html += `<span class="row-label" aria-hidden="true">${row}</span></div>`;
  }
  return html + '</div><div class="seat-legend"><span class="legend-item"><i class="legend-seat"></i>Available</span><span class="legend-item"><i class="legend-seat selected"></i>Selected ✓</span><span class="legend-item"><i class="legend-seat reserved"></i>Reserved ×</span></div>';
}
function renderBooking(message = '') {
  $('#booking-dialog').innerHTML = `<header class="booking-header"><div><p class="eyebrow brass">A BETTER SEAT FOR A GREAT STORY</p><h2 id="booking-title">${step === 'seats' ? 'Find your place.' : 'Make it yours.'}</h2><p class="booking-subtitle">${esc(activeMovie.title)} <span aria-hidden="true">/</span> ${esc(format(activeShow.starts_at, { day:'numeric', month:'short' }))}, ${esc(time(activeShow.starts_at))} IST <span aria-hidden="true">/</span> ${esc(activeShow.auditorium)}</p></div><div class="booking-steps"><span class="${step === 'seats' ? 'current' : ''}"><b>1</b> Your seats</span><span class="${step === 'details' ? 'current' : ''}"><b>2</b> Your details</span></div><button class="close" data-close="booking-dialog" aria-label="Back to showtimes">×</button></header><div class="booking-body">${step === 'seats' ? `<section class="seating" aria-label="Auditorium seating">${renderSeatMap()}</section>` : `<section class="customer-details"><p class="eyebrow brass">JUST THE ESSENTIALS</p><h3>Who’s joining us?</h3><p class="muted">A name and an email. Then the evening is yours.</p><form class="customer-form" id="customer-form"><div class="field"><label for="customer-name">Your name</label><input id="customer-name" name="customerName" autocomplete="name" required maxlength="100" placeholder="The name for your reservation" value="${esc(customer.name)}"><p id="name-error" class="error"></p></div><div class="field"><label for="customer-email">Email address</label><input id="customer-email" name="customerEmail" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" value="${esc(customer.email)}"><p id="email-error" class="error"></p></div><p class="fine-print">No account. No payment. Save your ticket reference after confirming — we won’t send an email.</p></form></section>`}<aside class="booking-summary" aria-label="Reservation summary">${seatSummary()}</aside></div><footer class="booking-footer"><button class="back" id="booking-back">← ${step === 'seats' ? 'Showtimes' : 'Your seats'}</button><p class="error" id="booking-error" role="alert">${esc(message)}</p><div class="booking-footer-right"><div><div class="total-label">RESERVATION TOTAL</div><div class="total-price" id="booking-total">${money(chosenSeats().reduce((sum, seat) => sum + seat.price, 0))}<small>INR</small></div></div>${step === 'seats' ? `<button class="primary" id="continue-booking" ${selected.size ? '' : 'disabled'}>Continue <span aria-hidden="true">→</span></button>` : '<button class="primary" type="submit" form="customer-form" id="confirm-booking">Confirm Reservation <span aria-hidden="true">↗</span></button>'}</div></footer>`;
  if (step === 'details') $('#customer-name').focus({ preventScroll:true });
  else $('.seat:not(:disabled)')?.focus({ preventScroll:true });
}
function toggleSeat(id) {
  const seat = availability.find(seat => seat.id === id);
  if (!seat || seat.booked) return;
  if (selected.has(id)) selected.delete(id);
  else if (selected.size >= 6) { $('#booking-error').textContent = 'You can reserve a maximum of 6 seats.'; return; }
  else selected.add(id);
  $('#booking-error').textContent = '';
  document.querySelectorAll('[data-seat]').forEach(button => { const chosen = selected.has(button.dataset.seat); button.setAttribute('aria-pressed', chosen); button.textContent = chosen ? '✓' : (button.disabled ? '×' : button.dataset.seat.slice(1)); });
  $('.booking-summary').innerHTML = seatSummary();
  $('#booking-total').innerHTML = `${money(chosenSeats().reduce((sum, seat) => sum + seat.price, 0))}<small>INR</small>`;
  $('#continue-booking').disabled = selected.size === 0;
}
async function confirmReservation(event) {
  event.preventDefault(); if (submitting || !selected.size) return;
  const form = event.target;
  if (!form.reportValidity()) return;
  customer = { name:$('#customer-name').value, email:$('#customer-email').value };
  if (!customer.name.trim()) { $('#name-error').textContent = 'Please enter your name.'; $('#customer-name').focus(); return; }
  submitting = true;
  const button = $('#confirm-booking'); button.disabled = true; button.textContent = 'Reserving your seats…';
  $('#booking-error').textContent = '';
  $('#booking-back').disabled = true;
  try {
    const ticket = await api('/reservations', { method:'POST', body:JSON.stringify({ showtimeId:activeShow.id, seatIds:[...selected], customerName:customer.name, customerEmail:customer.email }) });
    submitting = false;
    closeBooking(); closeFilm();
    showTicket(ticket);
  } catch (error) {
    if (error.status === 409) {
      try {
        const data = await api(`/showtimes/${activeShow.id}/seats`); availability = data.seats; syncShowtimeCount();
        selected = new Set([...selected].filter(id => !availability.find(seat => seat.id === id)?.booked));
        step = 'seats'; renderBooking(error.message);
      } catch { step = 'seats'; selected.clear(); availability = availability.map(seat => ({ ...seat, booked:1 })); renderBooking('Availability could not be refreshed. Return to showtimes and try again.'); }
    } else {
      $('#booking-error').textContent = error.message;
      for (const [key, selector] of [['customerName','name'], ['customerEmail','email']]) if (error.fields?.[key]) { $(`#${selector}-error`).textContent = error.fields[key]; $(`#customer-${selector}`).setAttribute('aria-invalid', 'true'); }
    }
  } finally { submitting = false; if ($('#booking-back')) $('#booking-back').disabled = false; if ($('#confirm-booking')) { $('#confirm-booking').disabled = false; $('#confirm-booking').innerHTML = 'Confirm Reservation <span aria-hidden="true">↗</span>'; } }
}
function showTicket(ticket) {
  const film = ticket.movie, show = ticket.showtime;
  const categories = [...new Set(ticket.seats.map(seat => seat.category))].join(' / ');
  $('#ticket-dialog').innerHTML = `<button class="close" data-close="ticket-dialog" aria-label="Close ticket">×</button><div class="confirmation-top"><div class="confirmed-mark" aria-hidden="true">✓</div><p class="eyebrow brass">RESERVATION CONFIRMED</p><h2 id="ticket-title">You’re in. Enjoy the escape.</h2><p>Your seats are saved. Here’s your evening, on a ticket.</p></div><article class="ticket" aria-label="Confirmed reservation ticket"><div class="ticket-top"><div><span class="brand">RowVault<span class="brand-dot">®</span></span><h3>${esc(film.title)}</h3><p class="ticket-meta">${film.year} · ${esc(film.language)} · ${duration(film.runtime)} · 2D</p></div>${image(film)}</div><div class="ticket-details"><dl><dt>DATE & TIME · IST</dt><dd>${esc(format(show.starts_at, { weekday:'short', day:'numeric', month:'short', year:'numeric' }))}<br>${esc(time(show.starts_at))}</dd></dl><dl><dt>AUDITORIUM</dt><dd>${esc(show.auditorium)}</dd></dl><dl><dt>YOUR SEATS · ${ticket.seats.length} TICKET${ticket.seats.length > 1 ? 'S' : ''}</dt><dd>${ticket.seats.map(seat => esc(seat.id)).join(', ')}<br><span class="ticket-meta">${esc(categories)}</span></dd></dl><dl><dt>RESERVATION TOTAL</dt><dd>${money(ticket.total)} <span class="ticket-meta">· No payment required</span></dd></dl></div><div class="ticket-stub"><div><p class="ticket-ref-label">KEEP THIS REFERENCE</p><p class="ticket-reference" id="ticket-reference">${esc(ticket.reference)}</p></div><button class="text-button" id="copy-reference">Copy reference</button></div></article><div class="ticket-actions"><p class="fine-print">Academic demonstration · Simulated screening<br>Save your reference to find this ticket in My bookings.</p><button class="primary" id="back-to-movies">Back to movies <span aria-hidden="true">↗</span></button></div>`;
  openDialog($('#ticket-dialog'));
}
async function lookupReservation(event) {
  event.preventDefault(); const button = event.target.querySelector('button'); if (button.disabled) return;
  button.disabled = true; $('#lookup-error').textContent = '';
  try {
    const ticket = await api(`/reservations/${encodeURIComponent($('#reference').value.trim().toUpperCase())}`);
    $('#lookup-dialog').close(); showTicket(ticket);
  } catch (error) { $('#lookup-error').textContent = error.message; }
  finally { button.disabled = false; }
}
async function showCredits() {
  $('#credits-dialog').innerHTML = `<button class="close" data-close="credits-dialog" aria-label="Close credits">×</button><p class="eyebrow brass">THE PEOPLE BEHIND THE PICTURES</p><h2 id="credits-title">Film & artwork credits.</h2><p>RowVault is a noncommercial academic practical. These simulated screenings do not represent an operating cinema. US film classifications are shown for reference.</p><ul class="credits-list">${movies.map(movie => `<li><a href="https://www.themoviedb.org/movie/${({1:687163,2:1368337,3:911430,4:1233413,5:693134,6:157336,7:27205,8:155,9:603,10:278})[movie.id]}" target="_blank" rel="noreferrer">${esc(movie.title)} (${movie.year}) ↗</a><br><span class="muted">${esc(movie.studio)}</span></li>`).join('')}</ul><p>Promotional posters and cinematic backdrops are sourced from TMDB and cached locally for this personal, noncommercial demonstration under <a href="https://www.themoviedb.org/terms-of-use" target="_blank" rel="noreferrer">TMDB’s terms</a>. Artwork remains the property of its respective rights holders; this credit is not a grant of third-party copyright rights. See <a href="/assets/sources.json" target="_blank">screening artwork sources</a> and <a href="/assets/archive-sources.json" target="_blank">archive poster sources</a>.</p><div class="tmdb-credit"><a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"><img src="/assets/tmdb.svg" alt="The Movie Database (TMDB)"></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.<br>The catalog is static; no TMDB API is called at runtime.</p></div><p>Typography: Instrument Serif by Rodrigo Fuenzalida & DM Sans by Colophon Foundry, under the <a href="/assets/FONT-LICENSES.txt" target="_blank">SIL Open Font License</a>.</p>`;
  openDialog($('#credits-dialog'));
}
function route() {
  if ($('#booking-dialog').open) {
    if (submitting) { history.replaceState(null, '', `#film-${activeMovie.id}`); return; }
    closeBooking();
  }
  const match = location.hash.match(/^#film-(\d+)$/);
  if (match) openFilm(Number(match[1]));
  else if ($('#film-dialog').open && !$('#booking-dialog').open) closeFilm();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || (submitting && button.id === 'booking-back')) return;
  if (button.dataset.movie) return navigateFilm(Number(button.dataset.movie));
  if (button.dataset.close) { const id = button.dataset.close; if (id === 'booking-dialog') closeBooking(); else if (id === 'film-dialog') closeFilm(); else document.getElementById(id).close(); return; }
  if (button.dataset.date) return renderShowtimes(button.dataset.date);
  if (button.dataset.showtime) return openSeats(Number(button.dataset.showtime));
  if (button.dataset.seat) return toggleSeat(button.dataset.seat);
  switch (button.id) {
    case 'find-booking': $('#lookup-form').reset(); $('#lookup-error').textContent = ''; openDialog($('#lookup-dialog')); break;
    case 'retry-movies': loadMovies(); break;
    case 'continue-booking': if (selected.size) { step = 'details'; renderBooking(); } break;
    case 'booking-back': if (step === 'details') { customer = { name:$('#customer-name').value, email:$('#customer-email').value }; step = 'seats'; renderBooking(); } else closeBooking(); break;
    case 'back-to-movies': $('#ticket-dialog').close(); document.getElementById('movies').scrollIntoView(); break;
    case 'copy-reference': try { await navigator.clipboard.writeText($('#ticket-reference').textContent); button.textContent = 'Copied ✓'; toast('Reservation reference copied.'); } catch { const range = document.createRange(); range.selectNodeContents($('#ticket-reference')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Reference selected. Press Ctrl+C or Command+C to copy.'); } break;
    case 'show-credits': showCredits(); break;
  }
});
document.addEventListener('submit', event => { if (event.target.id === 'customer-form') confirmReservation(event); if (event.target.id === 'lookup-form') lookupReservation(event); });
$('#film-dialog').addEventListener('cancel', event => { event.preventDefault(); closeFilm(); });
$('#booking-dialog').addEventListener('cancel', event => { event.preventDefault(); closeBooking(); });
$('#booking-dialog').addEventListener('click', event => { if (submitting && event.target.closest('#booking-back')) event.preventDefault(); });
window.addEventListener('hashchange', route);
renderArchive();
loadMovies();
