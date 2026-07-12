// Artillery processor: creates a guest session over REST so each virtual
// user connects the WebSocket namespaces with a valid JWT.
const http = require('http');

function createGuestSession(context, events, done) {
  const target = new URL(context.vars.$environment?.target ?? 'http://localhost:3000');
  const req = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      path: '/auth/guest',
      method: 'POST',
      headers: { 'Content-Length': 0 },
    },
    (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          context.vars.token = parsed.accessToken;
          done();
        } catch (err) {
          done(err);
        }
      });
    },
  );
  req.on('error', done);
  req.end();
}

module.exports = { createGuestSession };
