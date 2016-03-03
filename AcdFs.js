'use strict'


var Api = require("acdc");

var fs = require("fs");
var async = require("async");
var path = require("path");
var debug = require("debug")("AcdFs")
var util = require("util");


var AcdFs = function(options) {
}

var AcdHandle = function(node) {
	this.node = node;
}

AcdFs.prototype._listFiles = function(handle, startToken, files, cb) {
	var self = this;
	var list_children_options = { };
	if(startToken) list_children_options.startToken = startToken;
	self.session.list_children(handle.node.id, list_children_options, function(err, items) {
		if(err) return cb(err);
		items.data.forEach(function(child, index) {
			/*var item = { name: child.name, nodeid: child.id, isDirectory: (child.kind === "FOLDER") };
			if(child.kind !== "FOLDER") {
				item.size = child.contentProperties.size;
				item.md5 =  child.contentProperties.md5;
			}*/
			files.push( { name: child.name, handle: new AcdHandle(child) } );
		});
		if(items.nextToken) {
			return self.listFiles(startToken, files, cb);
		} else cb(null, files);

	});
};

AcdFs.prototype.listFiles = function(handle, cb) {
	debug("AcdFs.listFiles");
	var self = this;
	return self._listFiles(handle, null, [], cb);
};


AcdFs.prototype.exists = function(handle, name, cb) {
	debug("AcdFs.exists %s", name);
	var self = this;
	self.session.list_children(handle.node.id, {filters: "name:" + name }, function(err, items) {
		if(err) return cb(err);
		if(items.count === 0) return cb(null, { exists: false });
		cb(null, { exists: true, handle: items.data[0] });
	});
};

AcdFs.prototype.createFile = function(handle, name, stream, size, cb) {
	debug("AcdFs.createFile i%j, %s, %d", handle, name, size);
	var self = this;
	self.session.upload({name: name, kind: "FILE", parents: [ handle.node.id ] }, stream, size, { suppress: "deduplication" }, function(err, file){
		if(err) return cb(err);
		return cb(null, new AcdHandle(file));
	});
}

AcdFs.prototype.readFile = function(handle, cb) {
	debug("AcdFs.readFile %j", handle);
	var self = this;
	self.session.download(handle.node.id, function(err, stream) {
		if(err) return cb(err);
		return cb(null, stream);
	});
}

AcdFs.prototype.isDirectory = function(handle, cb) {
        debug("AcdFs.isDirectory %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, handle.kind === "FOLDER");
	});
}

AcdFs.prototype.getSize = function(handle, cb) {
        debug("AcdFs.getSize %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, handle.contentProperties.size);
	});
}

AcdFs.prototype.getMD5 = function(handle, cb) {
        debug("AcdFs.getMD5 %s", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, handle.contentProperties.md5);
	});
}

AcdFs.prototype.unlink = function(handle, cb) {
	debug("AcdFs.unlink %s", handle);
	var self = this;
	self.session.add_to_trash(hanlde.node.id, function(err, result) {
		if(err) return cb(err);
		return cb(null);
	});
}

AcdFs.prototype.rmdir = function(handle, cb) {
	debug("AcdFs.rmdir %s", handle);
	var self = this;
	self.session.add_to_trash(hanlde.node.id, function(err, result) {
		if(err) return cb(err);
		return cb(null);
	});
}



AcdFs.prototype.createDirectory = function(handle, name, cb) {
	debug("AcdFs.createFolder %j, %s", handle, name);
	var self = this;
	self.session.create_folder({kind: "FOLDER", name: name, parents: [handle.node.id] }, function(err, folder) {
		if(err) return cb(err);
		return cb(err, new AcdHandle(folder));
	});
}

AcdFs.prototype.init = function(str, cb) {
	debug("AcdFs.init %s", str);
	var self = this;
	self.session.resolve_path(str, function(err, result) {
		if(err) return cb(err);
		if(result.count === 0) return cb(new Error("ENOENT"));
		cb(null, { name: path.parse(str).name, handle: new AcdHandle(result.data[0])});
	});
}

AcdFs.prototype._initialize = function(options, cb) {
	debug("AcdFs._initialize");
	var self = this;
	self.tokenFile = (options && options.tokenFile) || "acd.token";

	fs.readFile(self.tokenFile, function(err, data) {
		if(err && err.code !== "ENOENT") return cb(err);
		if(err && err.code === "ENOENT") debug("Could not read token file: error %s", err)
		var token = !err && JSON.parse(data);
		self.session = new Api.Session(token);
		self.session.on("newToken", function(token) {
			fs.writeFile(self.tokenFile, JSON.stringify(token), function(err) {
				if(err) return debug("Could not write token file: error %s", err);
				debug("Token file written successfully");
			});
		});
		cb(null);
	});
}

AcdFs.createFs = function(options, cb) {
	debug("AcdFs.createFs");
	var ret = new AcdFs();
	ret._initialize(options, function(err) {
		cb(err, ret);
	});
}

module.exports = AcdFs;
