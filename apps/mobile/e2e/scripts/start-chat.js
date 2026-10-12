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
var photographerSlug =
  typeof PHOTOGRAPHER_SLUG === 'undefined' ? 'sofia-martins' : PHOTOGRAPHER_SLUG;

if (typeof CLIENT_EMAIL === 'undefined' || typeof CLIENT_PASSWORD === 'undefined') {
  throw new Error('start-chat: CLIENT_EMAIL and CLIENT_PASSWORD are required.');
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
      'start-chat: ' +
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

var signIn = request('post', '/v1/auth/sign-in', null, {
  email: CLIENT_EMAIL,
  password: CLIENT_PASSWORD,
});
if (!signIn.session) {
  throw new Error('start-chat: sign-in for ' + CLIENT_EMAIL + ' did not return a session.');
}
var token = signIn.session.token;

var products = request('get', '/v1/photographers/' + photographerSlug + '/products', null);
if (products.length === 0 || products[0].tiers.length === 0) {
  throw new Error('start-chat: ' + photographerSlug + ' has no product with a tier to quote.');
}

// A conversation only exists once a quote does; a direct quote from the
// client is the shortest path to one and needs no photographer sign-in.
var quote = request(
  'post',
  '/v1/photographers/' + photographerSlug + '/products/' + products[0].id + '/quotes',
  token,
  { productTierId: products[0].tiers[0].id, message: 'Created by the Maestro chat fixture.' },
);

var conversations = request('get', '/v1/conversations', token).items;
var conversation = null;
for (var i = 0; i < conversations.length; i++) {
  if (conversations[i].subjectId === quote.id) {
    conversation = conversations[i];
  }
}
if (!conversation) {
  throw new Error(
    'start-chat: no conversation for quote ' + quote.id + ' in the client conversation list.',
  );
}

output.quoteId = quote.id;
output.conversationId = conversation.id;
