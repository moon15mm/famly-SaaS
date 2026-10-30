// Local Next rewrites use a per-request proxy. Do not share its upstream sockets
// across requests; an idle close or proxy cleanup must not abort another read.
const http = require("node:http");
http.globalAgent = new http.Agent({ keepAlive: false });
