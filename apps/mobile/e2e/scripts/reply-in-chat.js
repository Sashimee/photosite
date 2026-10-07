var apiUrl = typeof API_URL === 'undefined' ? 'http://localhost:4000' : API_URL;
var photographerEmail =
  typeof PHOTOGRAPHER_EMAIL === 'undefined' ? 'sofia.martins@photoo.test' : PHOTOGRAPHER_EMAIL;

if (typeof CONVERSATION_ID === 'undefined' || typeof REPLY_BODY === 'undefined') {
  throw new Error('reply-in-chat: CONVERSATION_ID and REPLY_BODY are required.');
}
if (typeof SEED_USER_PASSWORD === 'undefined' || SEED_USER_PASSWORD === '') {
  throw new Error(
    'reply-in-chat: SEED_USER_PASSWORD is required to sign in as the seeded photographer. ' +
      'Pass it with `maestro test -e SEED_USER_PASSWORD=...`.',
  );
}

function request(method, path, token, payload) {
  var options = { headers: { 'Content-Type': 'application/json' } };
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
      'reply-in-chat: ' +
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
  email: photographerEmail,
  password: SEED_USER_PASSWORD,
});
if (!signIn.session) {
  throw new Error('reply-in-chat: sign-in for ' + photographerEmail + ' did not return a session.');
}
var token = signIn.session.token;
var messagesPath = '/v1/conversations/' + CONVERSATION_ID + '/messages';

if (typeof EXPECT_BODY !== 'undefined') {
  var existing = request('get', messagesPath, token).items;
  var found = false;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].body === EXPECT_BODY) {
      found = true;
    }
  }
  if (!found) {
    throw new Error(
      'reply-in-chat: the message the app sent is not on the server for conversation ' +
        CONVERSATION_ID +
        '. The app showed it without persisting it.',
    );
  }
}

var message = request('post', messagesPath, token, { body: REPLY_BODY });
output.replyMessageId = message.id;
