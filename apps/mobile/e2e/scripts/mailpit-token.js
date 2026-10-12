var apiUrl = typeof API_URL === 'undefined' ? 'http://localhost:4000' : API_URL;
var mailpitUrl = typeof MAILPIT_URL === 'undefined' ? 'http://localhost:8025' : MAILPIT_URL;
var apply = typeof VERIFY === 'undefined' ? 'false' : VERIFY;
var timeoutMs = 30000;
var linkPattern = /verify-email#token=([^\s"'<>&]+)/;

function sleep(ms) {
  var until = Date.now() + ms;
  while (Date.now() < until) {}
}

function findToken() {
  var search = http.get(mailpitUrl + '/api/v1/search?query=' + encodeURIComponent('to:' + EMAIL));
  if (!search.ok) {
    throw new Error('mailpit-token: search failed with HTTP ' + search.status + ': ' + search.body);
  }
  var messages = JSON.parse(search.body).messages || [];
  for (var i = 0; i < messages.length; i++) {
    var message = http.get(mailpitUrl + '/api/v1/message/' + messages[i].ID);
    if (!message.ok) {
      throw new Error('mailpit-token: reading message failed with HTTP ' + message.status);
    }
    var parsed = JSON.parse(message.body);
    var match = linkPattern.exec(parsed.Text) || linkPattern.exec(parsed.HTML);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

var deadline = Date.now() + timeoutMs;
var token = findToken();
while (token === null && Date.now() < deadline) {
  sleep(500);
  token = findToken();
}
if (token === null) {
  throw new Error(
    'mailpit-token: no verification email to ' +
      EMAIL +
      ' within ' +
      timeoutMs +
      'ms. ' +
      'Check the worker is running and delivering to Mailpit on ' +
      mailpitUrl +
      '.',
  );
}

if (apply === 'true') {
  var verify = http.post(apiUrl + '/v1/auth/verify-email', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token }),
  });
  if (!verify.ok) {
    throw new Error(
      'mailpit-token: verify-email for ' +
        EMAIL +
        ' failed with HTTP ' +
        verify.status +
        ': ' +
        verify.body,
    );
  }
}

output.token = token;
