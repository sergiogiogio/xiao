'use strict'


var Api = require("./GoogleDriveApi.js");

var fs = require("fs");
var async = require("async");
var path = require("path");
var debug = require("debug")("GoogleFs")
var util = require("util");

var sFields="kind,id,name,mimeType,size,md5Checksum,createdTime,modifiedTime"

var GDriveFs = function(options) {
}

var GDriveHandle = function(node) {
	this.node = node;
}

GDriveFs.prototype._listFiles = function(handle, startToken, files, cb) {
	var self = this;
	var list_options = { q: "'"+handle.node.id+"' in parents and trashed=false", fields:sFields };
	if(startToken) list_options.pageToken = startToken;
	self.session.list(list_options, function(err, items) {
		if(err) return cb(err);
		items.files.forEach(function(child, index) {
			var name = child.name;
			name = name.replace(/\//g, "\uFF0F");
			/*var item = { name: child.name, nodeid: child.id, isDirectory: (child.kind === "FOLDER") };
			if(child.kind !== "FOLDER") {
				item.size = child.contentProperties.size;
				item.md5 =  child.contentProperties.md5;
			}*/
			files.push( { name: name, handle: new GDriveHandle(child) } );
		});
		if(items.nextPageToken) {
			return self._listFiles(handle, items.nextPageToken, files, cb);
		} else cb(null, files);

	});
};

GDriveFs.prototype.listFiles = function(handle, cb) {
	debug("GDriveFs.listFiles");
	var self = this;
	return self._listFiles(handle, null, [], cb);
};


GDriveFs.prototype.exists = function(handle, name, cb) {
	debug("GDriveFs.exists %s", name);
	var self = this;
	self.session.list({q: "name='" + name.replace(/'/g, "\\'") + "' and '"+ handle.node.id +"' in parents and trashed=false", fields:sFields }, function(err, items) {
		if(err) return cb(err);
		if(items.files.length === 0) return cb(null, { exists: false });
		cb(null, { exists: true, handle: new GDriveHandle(items.files[0]) });
	});
};

GDriveFs.prototype.createFile = function(handle, name, stream, size, options, cb) {
	debug("GDriveFs.createFile %j, %s, %d, %j", handle, name, size, options);
	var self = this;
	var upload_opt = {name: name, parents: [ handle.node.id ] };
	if(options.createdTime) upload_opt.createdTime = options.createdTime;
	if(options.modifiedTime) upload_opt.modifiedTime = options.modifiedTime;
	self.session.upload(upload_opt, stream, size, {fields:sFields}, function(err, file){
		if(err) return cb(err);
		return cb(null, new GDriveHandle(file));
	});
}

GDriveFs.prototype.readFile = function(handle, cb) {
	debug("GDriveFs.readFile %j", handle);
	var self = this;
	self.session.download(handle.node.id, function(err, stream) {
		if(err) return cb(err);
		return cb(null, stream);
	});
}

GDriveFs.prototype.isDirectory = function(handle, cb) {
        debug("GDriveFs.isDirectory %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, handle.node.mimeType === "application/vnd.google-apps.folder");
	});
}


GDriveFs.prototype.getSize = function(handle, cb) {
        debug("GDriveFs.getSize %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, parseInt(handle.node.size, 10));
	});
	
}

GDriveFs.prototype.getCreatedTime = function(handle, cb) {
        debug("GDriveFs.getCreatedTime %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, new Date(handle.node.createdTime));
	});
	
}

GDriveFs.prototype.getModifiedTime = function(handle, cb) {
        debug("GDriveFs.getModifiedTime %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, new Date(handle.node.modifiedTime));
	});
	
}


GDriveFs.prototype.getMD5 = function(handle, cb) {
        debug("GDriveFs.getMD5 %j", handle);
        var self = this;
	process.nextTick( function() {
		cb(null, handle.node.md5Checksum);
	});
}

GDriveFs.prototype.unlink = function(handle, cb) {
	debug("GDriveFs.unlink %j", handle);
	var self = this;
	self.session.add_to_trash(handle.node.id, function(err, result) {
		if(err) return cb(err);
		return cb(null);
	});
}

GDriveFs.prototype.rmdir = function(handle, cb) {
	debug("GDriveFs.rmdir %j", handle);
	var self = this;
	self.session.add_to_trash(handle.node.id, function(err, result) {
		if(err) return cb(err);
		return cb(null);
	});
}



GDriveFs.prototype.createDirectory = function(handle, name, cb) {
	debug("GDriveFs.createDirectory %j, %s", handle, name);
	var self = this;
	self.session.create_folder({ name: name, parents: [handle.node.id] }, {fields:sFields}, function(err, folder) {
		if(err) return cb(err);
		return cb(err, new GDriveHandle(folder));
	});
}

GDriveFs.prototype.init = function(str, cb) {
	debug("GDriveFs.init %s", str);
	var self = this;
	self.session.resolve_path(str, {fields:sFields}, function(err, result) {
		if(err) return cb(err);
		if(result.files.length === 0) { var err = new Error(); err.code = "ENOENT"; return cb(err); }
		cb(null, { name: path.parse(str).base, handle: new GDriveHandle(result.files[0])});
	});
}

GDriveFs.prototype.getRoot = function(str, cb) {
	debug("GDriveFs.getRoot %s", str);
	var self = this;
	self.session.get_root({fields:sFields}, function(err, result) {
		if(err) return cb(err);
		if(result.files.length === 0) { var err = new Error(); err.code = "ENOENT"; return cb(err); }
		cb(null, { name: str, handle: new GDriveHandle(result.files[0])});
	});
}
GDriveFs.prototype._initialize = function(options, cb) {
	debug("GDriveFs._initialize");
	var self = this;
	self.tokenFile = (options && options.tokenFile) || "google.token";

	fs.readFile(self.tokenFile, function(err, data) {
		if(err && err.code !== "ENOENT") return cb(err);
		if(err && err.code === "ENOENT") debug("Could not read token file: error %s", err)
		var token = !err && JSON.parse(data);
		self.session = new Api.Session(token);
		self.session.on("newToken", function(newToken) {
			newToken.refresh_token= newToken.refresh_token || token.refresh_token;
			fs.writeFile(self.tokenFile, JSON.stringify(newToken), function(err) {
				if(err) return debug("Could not write token file: error %s", err);
				debug("Token file written successfully");
			});
		});
		cb(null);
	});
}

GDriveFs.createFs = function(options, cb) {
	debug("GDriveFs.createFs");
	var ret = new GDriveFs();
	ret._initialize(options, function(err) {
		cb(err, ret);
	});
}

module.exports = GDriveFs;
