'use strict'

var fs = require("fs");
var crypto = require("crypto");
var async = require("async");
var path = require("path");
var debug = require("debug")("FsFs")
var util = require("util");

var FsFs = function() {
}

var FsHandle = function(parent, name) {
	this.parent = parent;
	this.name = name;
}
FsHandle.prototype.path = function() {
	return path.join(this.parent.path(), this.name);
}



var FsRootHandle = function(path) {
	this._path = path;
}

util.inherits(FsRootHandle, FsHandle);

FsRootHandle.prototype.path = function() {
	return this._path;
}


FsFs.prototype.listFiles = function(handle, cb) {
	debug("FsFs.listFiles");
	var self = this;
	fs.readdir(handle.path(), function(err, filenames) {
		if(err) return cb(err);
		var files = new Array(filenames.length);
		for(var i = 0 ; i < filenames.length ; ++i) {
			files[i] = { name: filenames[i], handle: new FsHandle(handle, filenames[i]) };
		}
		cb(err, files);
	});
};

FsFs.prototype.createFile = function(handle, name, stream, size, cb) {
	debug("FsFs.createFile %j, %s, %d", handle, name, size);
	var self = this;
	var newHandle = new FsHandle(handle, name);
	var wstream = fs.createWriteStream(newHandle.path());
	wstream.on("finish", function() {
		cb(null, newHandle);
	});
	wstream.on("error", function(err) {
		cb(err);
	});
	stream.pipe(wstream);
}

FsFs.prototype.exists = function(handle, name, cb) {
	debug("FsFs.exists %j, %s", handle, name);
	var self = this;
	var newHandle = new FsHandle(handle, name);
	fs.stat(newHandle.path(), function(err, stats) {
		if(err && err.code === "ENOENT") return cb(null, {exists: false })
		if(err) return cb(err);
		cb(null, { exists: true, handle: newHandle });
	});
	
}

FsFs.prototype.isDirectory = function(handle, cb) {
	debug("FsFs.isDirectory %j", handle);
	var self = this;
	fs.stat(handle.path(), function(err, stats) {
		if(err) return cb(err);
		return cb(null, stats.isDirectory());
	});
}

FsFs.prototype.getSize = function(handle, cb) {
	debug("FsFs.getSize %j", handle);
	var self = this;
	fs.stat(handle.path(), function(err, stats) {
		if(err) return cb(err);
		return cb(null, stats.size);
	});
}

FsFs.prototype.getMD5 = function(handle, cb) {
	debug("FsFs.getMD5 %s", handle);
	var self = this;
	var fileStream = fs.createReadStream(handle.path());
	var hash = crypto.createHash('md5');
	hash.setEncoding('hex');
	fileStream.pipe(hash);
	fileStream.on('end', function() {
		hash.end();
		cb(null, hash.read());
	});
}

FsFs.prototype.readFile = function(handle, cb) {
	debug("FsFs.readFile %s", handle);
	var self = this;
	process.nextTick( function() {
		var stream = fs.createReadStream(handle.path());
		cb(null, stream);
	});
}

FsFs.prototype.unlink = function(handle, cb) {
	debug("FsFs.unlink %s", handle);
	var self = this;
	fs.unlink(handle.path(), cb);
}

FsFs.prototype.rmdir = function(handle, cb) {
	debug("FsFs.rmdir %s", handle);
	var self = this;
	fs.rmdir(handle.path(), cb);
}



FsFs.prototype.createDirectory = function(handle, name, cb) {
	debug("FsFs.createDirectory %j %s", handle, name);
	var self = this;
	var newHandle = new FsHandle(handle, name);
	fs.mkdir(newHandle.path(), function(err) {
		if(err) return cb(err);
		return cb(err, newHandle);
	});
}

FsFs.prototype.init = function(str, cb) {
	debug("FsFs.init %s", str);
	var self = this;
	process.nextTick( function() {
		cb(null, {name: path.parse(str).name, handle: new FsRootHandle(str)});
	});
}

FsFs.createFs = function(options, cb) {
	debug("FsFs.createFs");
	var ret = new FsFs();
	process.nextTick(function() {
		cb(null, ret);
	})
}


module.exports = FsFs;
