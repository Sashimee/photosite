var apiUrl = typeof API_URL === 'undefined' ? 'http://localhost:4000' : API_URL;
var role = typeof ROLE === 'undefined' ? 'client' : ROLE;
var register = typeof REGISTER === 'undefined' ? 'true' : REGISTER;

var unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var email = 'e2e-mobile-' + role + '-' + unique + '@photoo.test';
var password = 'e2e-' + unique + '-' + Math.random().toString(36).slice(2, 10);

if (register === 'true') {
  var response = http.post(apiUrl + '/v1/auth/sign-up', {
    headers: { 'Content-Type': 'application/json' },
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
