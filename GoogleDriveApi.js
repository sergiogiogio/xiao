'use strict';

var https = require('https');
var http = require('http');
var querystring = require('querystring');
var util = require('util');
var EventEmitter = require('events');
var url = require('url');
var cookie = require('cookie');
var path = require('path');
var multipart = require('@request/multipart');
var mime = require('mime-types')
var mstream = require('stream');
var debug = require('debug')('gdrive-api');
var debugTransport = require('debug')('gdrive-api:transport');

var Session = function(token) {
	this.token = token;
//	this.token = null;

} 

var rootUrl = "https://www.googleapis.com/drive/v3/"
var rootUploadUrl = "https://www.googleapis.com/upload/drive/v3/"

util.inherits(Session, EventEmitter);

var call_cb = function(fname, cb, err, result) {
	debug("%s callback(%s, %j)", fname, err || "SUCCESS", result);
	cb(err, result);
}

Session.prototype.read_response = function(res, requestId, transform, cb) {
	var result = "";
	res.setEncoding('utf8');
	res.on('data', function (chunk) {
		debugTransport("Response chunk(%d): %s", requestId, chunk);
		result += chunk;
	});
	res.on('error', cb);
	res.on('end', function() {
		debugTransport("Response completed(%d)", requestId);
		var tresult;
		try {	
			tresult = transform(result);
		} catch(err) {
			return cb(err);
		}
		cb(null, tresult);
	});
}

var LogStream = function(requestId) {
	this.requestId = requestId;
	LogStream.super_.call(this);
}
util.inherits(LogStream, mstream.PassThrough);
LogStream.prototype._transform = function(chunk, encoding, callback) {
	debugTransport("Request chunk(%d): %s", this.requestId, chunk.toString('ascii').replace(/[^\x20-\x7E]+/g, '.'));
	return LogStream.super_.prototype._transform.call(this, chunk, encoding, callback);
};

var sRequestId = 0;
Session.prototype.authorize = function(cb) {
	var fname = "authorize";
	debug(fname);
	var self = this;
	var sessionRequestId = sRequestId++;
	var request_opt = {
		host: "acdc-sergiogiogio.rhcloud.com",
		path: "/get_session",
		method: "GET"
	};
	var req = https.request(request_opt, function(res) {
		debugTransport("Response(%d): %d, Headers: %j", sessionRequestId, res.statusCode, res.headers);
		if(res.statusCode !== 200) return cb(new Error("Cannot connect"));
		var parsedCookies = cookie.parse(res.headers["set-cookie"][0]);
		console.log("please open browser https://acdc-sergiogiogio.rhcloud.com/google/authorize?session=" + parsedCookies.session);
		var tokenRequestId = sRequestId++;
		var request_opt = {
			host: "acdc-sergiogiogio.rhcloud.com",
			path: "/get_token",
			method: "GET",
			headers: {
				'Cookie': cookie.serialize("session", parsedCookies.session)
			}
		};
		var req = https.request(request_opt, function(res) {
			debugTransport("Response(%d): %d, Headers: %j", tokenRequestId, res.statusCode, res.headers);
			if(res.statusCode == 302) return self.authorize(cb); // we sometimes receive redirection to the same url
			self.read_response(res, tokenRequestId, JSON.parse, function(err, token) {
				if(err) return cb(err);
				self.token = token;
				self.emit("newToken", self.token);
				cb();
			});
		})
		req.on("error", cb);
		req.end();
		debugTransport("Request(%d): %j", tokenRequestId, request_opt);
	});
	req.on("error", cb);
	req.end();
	debugTransport("Request(%d): %j", sessionRequestId, request_opt);
}
Session.prototype.refresh_token = function(cb) {
	var fname = "refresh_token";
	debug(fname);
	var self = this;
	var data = querystring.stringify( self.token );
	var requestId = sRequestId++;
	var request_opt = {
		host: "acdc-sergiogiogio.rhcloud.com",
		path: "/google/refresh_token",
		method: "POST",
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': Buffer.byteLength(data)
		}
	};
	var req = https.request(request_opt, function(res) {
		debugTransport("Response(%d): %d, Headers: %j", requestId, res.statusCode, res.headers);
		if(res.statusCode == 302) return self.refresh_token(cb); // we sometimes receive redirection to the same url
		self.read_response(res, requestId, JSON.parse, function(err, token) {
			if(res.statusCode !== 200) return self.authorize(cb); // refresh_token was not successful we try to get a new token from scratch
			if(err) return cb(err);
			self.token = token;
			self.emit("newToken", self.token);
			cb();
		});
	});
	req.on("error", cb);
	req.write(data);
	req.end();
	debugTransport("Request(%d): %j", requestId, request_opt);
}
Session.prototype.request = function(cb_pre, cb_opt, cb_req, cb_res) {
	var self = this;
	if(cb_pre) return cb_pre( function(err, result) {
			if(err) return cb_res(err);
			self.request(null, cb_opt, cb_req, cb_res);
		});
	if(!self.token) return self.authorize( function(err) {
			console.log("Auth error %j", err);
			if(err) return cb_res(err);
			self.request(cb_pre, cb_opt, cb_req, cb_res);
		});
	var req_options = {
		headers: {
			"Authorization": "Bearer " + self.token.access_token
		}
	};
	cb_opt(req_options);
	var module = (req_options.host === "localhost") ? http : https;
	var requestId = sRequestId++;
	var req = module.request(req_options, function(res) {
		debugTransport("Response(%d): %d, Headers: %j", requestId, res.statusCode, res.headers);
		req.removeListener("error",cb_res); // else, cb_res may be called again if the connection is reset
		req.on("error", function(err) { res.emit("error", err) });
		switch(res.statusCode) {
			case 401: {
				self.refresh_token( function(err) {
					if(err) return cb_res(err);
					self.request(cb_pre, cb_opt, cb_req, cb_res);
				})
			}
			break;
			case 200:
			case 201:
				cb_res(null, res, requestId);
			break;
			default:
				self.read_response(res, requestId, JSON.parse, function(err, body) {
					if(err) return cb_res(new Error(res.statusCode), res, requestId);
					cb_res(new Error(JSON.stringify(body)), res, requestId);
				});	
				return;
			break;
		}
	});
	debugTransport("Request(%d): %j", requestId, req_options);
	var logstream = new LogStream(requestId);
	logstream.pipe(req);
	req.on("error", cb_res);
	cb_req(logstream);
};

var escapeComponent = function(str) {
	return str.replace(/([+\-&|!(){}\[\]^'\"~*?:\\ ])/g, "\\$1");
}

var serialize = function(obj) {
	var str = [];
	for(var p in obj)
		if (obj.hasOwnProperty(p)) {
			str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
		}
	return str.join("&");
}

Session.prototype.list = function(options, cb) {
	var fname = "list";
	debug(fname + "(%j)", options);
	var self = this;
	var qOptions = JSON.parse(JSON.stringify(options));
	if(qOptions.fields) qOptions.fields="kind,nextPageToken,incompleteSearch,files(" + qOptions.fields + ")"
	self.request(null,
		function(opt) {
			opt.host = url.parse(rootUrl).host;
			opt.path = url.parse(rootUrl).pathname + "files" + (qOptions ? "?" + serialize(qOptions) : "");
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.metadata = function(nodeid, options, cb) {
	var fname = "metadata";
	debug(fname + "(%s)", nodeid);
	var self = this;
	self.request(null,
		function(opt) {
			opt.host = url.parse(rootUrl).host;
			opt.path = url.parse(rootUrl).pathname + "files/" + nodeid + (options ? "?" + serialize(options) : "");
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};


var GDriveError = function(code, message) {
	this.code = code;
	this.message = message;
}


Session.prototype.get_root = function(options, cb) {
	var fname = "get_root";
	debug(fname + "(%j)", options);
	var self = this;
	self.request(null,
		function(opt) {
			opt.host = url.parse(rootUrl).host;
			opt.path = url.parse(rootUrl).pathname + "files/root" 
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, function(err, body) {
				if(err) return call_cb(fname, cb, err);
				call_cb(fname, cb, null, { files: [body] });	
			});	
		}
	);
}

Session.prototype.resolve_path = function(node_path, options, cb) {
	var fname = "resolve_path";
	debug(fname + "(%s, %j)", node_path, options);
	var self = this;
	var parse = path.parse(node_path);
	switch(parse.base) {
		case "":
		self.request(null,
			function(opt) {
				opt.host = url.parse(rootUrl).host;
				opt.path = url.parse(rootUrl).pathname + "files/root" + (options ? "?" + serialize(options) : "")
				opt.method = "GET";
			}, function(req) {
				req.end();
			}, function(err, res, requestId) {
				if(err) return call_cb(fname, cb, err);
				self.read_response(res, requestId, JSON.parse, function(err, body) {
					if(err) return call_cb(fname, cb, err);
					call_cb(fname, cb, null, { files: [body] });	
				});	
			}
		);
		break;

		default:
		self.resolve_path(parse.dir, options, function(err, result) {
			if(err) return call_cb(fname, cb, err);
			if(result.files.length === 0) return call_cb(fname, cb, err, result);
			var qOptions = JSON.parse(JSON.stringify(options));
			if(qOptions.fields) qOptions.fields="files(" + qOptions.fields + ")"
			self.request(null,
				function(opt) {
					opt.host = url.parse(rootUrl).host;
					opt.path = url.parse(rootUrl).pathname + "files?q=" + encodeURIComponent("'"+result.files[0].id+"' in parents and name='" + parse.base + "'") + (qOptions ? "&" + serialize(qOptions) : "");
					opt.method = "GET"
				}, function(req) {
					req.end();
				}, function(err, res, requestId) {
					if(err) return call_cb(fname, cb, err);
					self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
				}
			);
		});
		break;
	}
	
}

Session.prototype.create_folder_path = function(node_path, cb) {
	var fname = "create_folder_path";
	debug(fname + "(%s)", node_path);
	var self = this;
	var parse = path.parse(node_path);
	switch(parse.base) {
		case "":
		self.request(null,
			function(opt) {
				opt.host = url.parse(rootUrl).host;
				opt.path = url.parse(rootUrl).pathname + "files/root" + (options ? "?" + serialize(options) : "")
				opt.method = "GET";
			}, function(req) {
				req.end();
			}, function(err, res, requestId) {
				if(err) return call_cb(fname, cb, err);
				self.read_response(res, requestId, JSON.parse, function(err, body) {
					if(err) return call_cb(fname, cb, err);
					call_cb(fname, cb, null, body.data[0]);	
				});	
			}
		);
		break;

		default:
		self.create_folder_path(parse.dir, function(err, parent) {
			if(err) return call_cb(fname, cb, err);
			self.create_folder({ name: parse.name, parents: [ parent.id ] }, function(err, result) {
				call_cb(fname, cb, err, result);
			});
		});
		break;
	}
	
}

Session.prototype.upload = function(metadata, stream, streamlength, options, cb) {
	var fname = "upload";
	debug(fname + "(%j, %d, %j)", metadata, streamlength, options);
	var self = this;

	var mult_multipart = [ { 'content-type': 'application/json; charset=UTF-8', body: JSON.stringify(metadata) } ];
	if(stream) mult_multipart.push( { 'content-type': (mime.contentType(metadata.name) || "application/octet-stream"), body: stream } );
	var mult = multipart({
		multipart: mult_multipart
	});

	var length = 0;
	mult.body._items.forEach( function(item) {
		if(typeof item === 'string') length += Buffer.byteLength(item, "utf8");
		else length += streamlength;
	});
	self.request(null,
		function(opt){
			opt.host = url.parse(rootUploadUrl).host;
			//opt.host = "localhost";
			opt.path = url.parse(rootUploadUrl).pathname + "files?uploadType=multipart" + (options ? "&" + serialize(options) : "");
			opt.method = "POST";
			opt.headers['Content-Type'] = mult.contentType;
			opt.headers['Content-Length'] = length;
		}, function(req) {
			mult.body.pipe(req);
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.download = function(nodeid, cb) {
	var fname = "download";
	debug(fname + "(%s)", nodeid);
	var self = this;
	
	self.request(null,
		function(opt){
			opt.host = url.parse(rootUrl).host;
			opt.path = url.parse(rootUrl).pathname + "files/" + nodeid + "?alt=media";
			opt.method = "GET";
		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			call_cb(fname, cb, null, res);
		}
	);
};

Session.prototype.update = function(nodeid, metadata, stream, streamlength, options, cb) {
	var fname = "update";
	debug(fname + "(%s, %j, %d, %j)", nodeid, metadata, streamlength, options);
	var self = this;

	var mult_multipart = [];
	if(metadata) mult_multipart.push( { 'content-type': 'application/json; charset=UTF-8', body: JSON.stringify(metadata) }  );
	if(stream) mult_multipart.push(  { 'content-type': (mime.contentType(metadata.name) || "application/octet-stream"), body: stream } );
	var mult = multipart({
		multipart: mult_multipart
	});

	var length = 0;
	mult.body._items.forEach( function(item) {
		if(typeof item === 'string') length += Buffer.byteLength(item, "utf8");
		else length += streamlength;
	});
	self.request(null,
		function(opt){
			opt.host = url.parse(rootUploadUrl).host;
			//opt.host = "localhost";
			opt.path = url.parse(rootUploadUrl).pathname + "files/" + nodeid + "?uploadType=multipart" + (options ? "&" + serialize(options) : "");
			opt.method = "PATCH";
			opt.headers['Content-Type'] = mult.contentType;
			opt.headers['Content-Length'] = length;
		}, function(req) {
			mult.body.pipe(req);
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.create_folder = function(metadata, options, cb) {
	var fname = "create_folder";
	debug(fname + "(%j)", metadata);
	var self = this;
	metadata.mimeType = "application/vnd.google-apps.folder";
	
	self.upload(metadata, null, null, options, cb);
};

Session.prototype.move = function(nodeid, fromid, toid, cb) {
	var fname = "move";
	debug(fname + "(%s, %s, %s)", nodeid, fromid, toid);
	var self = this;
	
	self.update(nodeid, null, null, null, { addParents: toid, removeParents: fromid }, cb);
	
};


Session.prototype.delete_file = function(nodeid, cb) {
	var fname = "delete_file";
	debug(fname + "(%s, %s)", nodeid);
	var self = this;
	
	self.request(null,
		function(opt){
			opt.host = url.parse(rootUrl).host;
			opt.path = url.parse(rootUrl).pathname + "files/" + nodeid;
			opt.method = "DELETE";

		}, function(req) {
			req.end();
		}, function(err, res, requestId) {
			if(err) return call_cb(fname, cb, err);
			self.read_response(res, requestId, JSON.parse, call_cb.bind(null, fname, cb));
		}
	);
};

Session.prototype.add_to_trash = function(nodeid, cb) {
	var fname = "add_to_trash";
	debug(fname + "(%s)", nodeid);
	var self = this;

	self.update(nodeid, { trashed: true }, null, null, null, cb);
	
};

exports.Session = Session;
