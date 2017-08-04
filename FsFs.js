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
	return Buffer.concat([ this.parent.path(), Buffer.from(path.sep), this.name ]);
}



var FsRootHandle = function(path) {
	this._path = Buffer.from(path);
}

util.inherits(FsRootHandle, FsHandle);

FsRootHandle.prototype.path = function() {
	return this._path;
}


FsFs.prototype.listFiles = function(handle, cb) {
	debug("FsFs.listFiles %j", handle);
	var self = this;
	fs.readdir(handle.path(), { encoding: 'buffer' }, function(err, filenames) {
		if(err) return cb(err);
		var files = new Array(filenames.length);
		for(var i = 0 ; i < filenames.length ; ++i) {
			files[i] = { name: filenames[i].toString(), handle: new FsHandle(handle, filenames[i]) };
		}
		cb(err, files);
	});
};

FsFs.prototype.createFile = function(handle, name, stream, size, options, cb) {
	debug("FsFs.createFile %j, %s, %d, %j", handle, name, size, options);
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

FsFs.prototype.getModifiedTime = function(handle, cb) {
	debug("FsFs.getModifiedTime %j", handle);
	var self = this;
	fs.stat(handle.path(), function(err, stats) {
		if(err) return cb(err);
		return cb(null, stats.mtime);
	});
}

FsFs.prototype.getMD5 = function(handle, cb) {
	debug("FsFs.getMD5 %j", handle);
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
	debug("FsFs.readFile %j", handle);
	var self = this;
	process.nextTick( function() {
		var stream = fs.createReadStream(handle.path());
		cb(null, stream);
	});
}

FsFs.prototype.unlink = function(handle, cb) {
	debug("FsFs.unlink %j", handle);
	var self = this;
	fs.unlink(handle.path(), cb);
}

FsFs.prototype.rmdir = function(handle, cb) {
	debug("FsFs.rmdir %j", handle);
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

FsFs.prototype.getCurrentDirectory = function(cb) {
	debug("FsFs.getCurrentDirectory");
	var self = this;
	process.nextTick( function() {
		cb(null, process.cwd())
	} )
}


FsFs.prototype.getRoot = function(str, cb) {
	debug("FsFs.getRoot %s", str);
	var self = this;
	fs.stat(str, function(err, stats) {
		if(err) return cb(err);
		cb(null, { name: str, handle: new FsRootHandle(str) });
	});
}
FsFs.prototype.init = function(str, cb) {
	debug("FsFs.init %s", str);
	var self = this;
	fs.stat(str, function(err, stats) {
		if(err) return cb(err);
		cb(null, { name: path.parse(str).base, handle: new FsRootHandle(str) });
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
