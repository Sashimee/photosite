var apiUrl = typeof API_URL === 'undefined' ? 'http://localhost:4000' : API_URL;
// The api rate-limits sign-in and sign-up per client IP and every fixture call
// arrives from 127.0.0.1; CI trusts that address as a proxy, so each script run
// presents its own forwarded address instead of sharing the emulator's budget.
var clientIp =
  '10.' +
  Math.floor(Math.random() * 256) +
  '.' +
  Math.floor(Math.random() * 256) +
  '.' +
  (1 + Math.floor(Math.random() * 254));
var photographerEmail =
  typeof PHOTOGRAPHER_EMAIL === 'undefined' ? 'sofia.martins@photoo.test' : PHOTOGRAPHER_EMAIL;
var lineItemLabel = typeof LINE_ITEM_LABEL === 'undefined' ? 'Wedding coverage' : LINE_ITEM_LABEL;
var lineItemUnitCents = typeof LINE_ITEM_UNIT_CENTS === 'undefined' ? 150000 : LINE_ITEM_UNIT_CENTS;
var oneDayMs = 24 * 60 * 60 * 1000;

if (typeof CLIENT_EMAIL === 'undefined' || typeof CLIENT_PASSWORD === 'undefined') {
  throw new Error('send-quote: CLIENT_EMAIL and CLIENT_PASSWORD are required.');
}
if (typeof SEED_USER_PASSWORD === 'undefined' || SEED_USER_PASSWORD === '') {
  throw new Error(
    'send-quote: SEED_USER_PASSWORD is required to sign in as the seeded photographer. ' +
      'Pass it with `maestro test -e SEED_USER_PASSWORD=...`.',
  );
}

function request(method, path, token, payload) {
  var options = { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp } };
  if (token) {
    options.headers.Authorization = 'Bearer ' + token;
  }
  if (payload) {
    options.body = JSON.stringify(payload);
  }
  var response =
    method === 'get' ? http.get(apiUrl + path, options) : http.post(apiUrl + path, options);
  if (!response.ok) {
    throw new Error(
      'send-quote: ' +
        method.toUpperCase() +
        ' ' +
        path +
        ' failed with HTTP ' +
        response.status +
        ': ' +
        response.body,
    );
  }
  return JSON.parse(response.body);
}

function signIn(email, password) {
  var body = request('post', '/v1/auth/sign-in', null, { email: email, password: password });
  if (!body.session) {
    throw new Error('send-quote: sign-in for ' + email + ' did not return a session.');
  }
  return body.session.token;
}

var clientToken = signIn(CLIENT_EMAIL, CLIENT_PASSWORD);
var requests = request('get', '/v1/requests/mine', clientToken).items;
if (requests.length === 0) {
  throw new Error(
    'send-quote: ' + CLIENT_EMAIL + ' has no request. The app flow should have created one.',
  );
}

var photographerToken = signIn(photographerEmail, SEED_USER_PASSWORD);
var quote = request('post', '/v1/quotes', photographerToken, {
  requestId: requests[0].id,
  lineItems: [{ label: lineItemLabel, qty: 1, unitCents: lineItemUnitCents }],
  validUntil: new Date(Date.now() + oneDayMs).toISOString(),
  message: 'Sent by the Maestro e2e fixture.',
});

output.requestId = requests[0].id;
output.quoteId = quote.id;
