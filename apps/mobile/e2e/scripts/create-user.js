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
var role = typeof ROLE === 'undefined' ? 'client' : ROLE;
var register = typeof REGISTER === 'undefined' ? 'true' : REGISTER;

var unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var email = 'e2e-mobile-' + role + '-' + unique + '@photoo.test';
var password = 'e2e-' + unique + '-' + Math.random().toString(36).slice(2, 10);

if (register === 'true') {
  var response = http.post(apiUrl + '/v1/auth/sign-up', {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp },
    body: JSON.stringify({ email: email, password: password, roles: [role], locale: 'en' }),
  });
  if (!response.ok) {
    throw new Error(
      'create-user: sign-up for ' +
        email +
        ' failed with HTTP ' +
        response.status +
        ': ' +
        response.body,
    );
  }
}

output.email = email;
output.password = password;
