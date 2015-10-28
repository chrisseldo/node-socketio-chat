var url = require('url');
var express = require('express');
var gzippo = require('gzippo');
var logger = require('morgan');
var proxy = require('express-http-proxy');
var proxyTarget = process.env.LT_API_URL;
var sslRedirect = require('heroku-ssl-redirect');
var bodyParser = require('body-parser');
var sjcl = require('sjcl');
var sjclKey = process.env.LT_PUBSUB_KEY;
var redis = require('redis');
var redis_adapter = require('socket.io-redis');
var redisURL = url.parse(process.env.REDIS_URL);

var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var redis_pub = redis.createClient(redisURL.port, redisURL.hostname);
var redis_sub = redis.createClient(redisURL.port, redisURL.hostname, { detect_buffers: true });
if(redisURL.auth) {
    redis_pub.auth(redisURL.auth.split(":")[1]);
    redis_sub.auth(redisURL.auth.split(":")[1]);
}
io.adapter(redis_adapter({ pubClient: redis_pub, subClient: redis_sub }));

server.listen(process.env.PORT || 5000);

app.use(logger('dev'));
if(process.env.FORCE_SSL == 'Y') {
    app.use(sslRedirect());
}


app.use('/realtime/publish', bodyParser.json())
app.post('/realtime/publish', function(req, res){
    var msg = JSON.parse(sjcl.decrypt(sjclKey, JSON.stringify(req.body)))
    io.to(msg.user_id.toString()).emit('to_client', {'event_type': msg.event_type, 'event_msg': msg.event_msg});
    res.send("ok");
});

app.use('/api', proxy(proxyTarget, {
    limit: '50mb',
    forwardPath: function(req, res) {
    return '/api'+require('url').parse(req.url).path;
  }
}));

function auth_socket(socket, client_auth) {
    deauth_socket(socket);
    var user_id = sjcl.decrypt(sjclKey, client_auth.pubsub_auth);
    socket.join(user_id.toString());
}

function deauth_socket(socket) {
    socket.leaveAll();
}

io.on('connection', function (socket) {
  socket.emit('debug', { 'msg': 'connection made' });
  socket.on('client_auth', function (data) {
    auth_socket(socket, data);
  });
  socket.on('client_deauth', function (data) {
    deauth_socket(socket);
  });
});

/* 
// Sample socket.io client code
var socket = io(window.location.origin);
socket.on('connect', function() {
    console.log('connected');
    $.get('/api/me').success(function(data){
      socket.emit('client_auth', {'pubsub_auth': data.pubsub_auth});
    })
});

socket.on('new_match', function (data) {
    console.log(data);
});
socket.on('new_message', function (data) {
    console.log(data);
});
*/
