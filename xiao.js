'use strict'

var assert = require('assert');

var fs = require("fs");
var async = require("async");
var path = require("path");
var debug = require("debug")("xiao")
var util = require("util");
var url = require('url')
var Transform = require('stream').Transform;

var AcdFs = require("./AcdFs");
var FsFs = require("./FsFs");
var Join = require("./Join");

var Joiner = function(count) {
	this.count = count;
	this.cbCalled = false;
	this.err = null;
}
Joiner.prototype.then = function(cb) {
	this.cb = cb
}
Joiner.prototype.fun = function(err) {
	console.log("join.fun callback %j", this)
	if(err) if(!this.err) this.err = err;
	if(this.err) if(!this.cbCalled) { this.cbCalled = true; return this.cb(this.err) }
	if(--this.count === 0) if(!this.cbCalled) { this.cbCalled = true; return this.cb(this.err) }
	
}

//var queue = async.queue(function(fun, cb) { var cbCalled = false; var qcb = function(err) { if(!CbCalled) { cbCalled = true; return cb(err); } } fun(qcb, qcb); }, 1);
var queue = async.queue(function(fun, cb) { fun(cb); }, 1);

// copy directory content 
/*var copyDirectory = function(srcFs, srcHandle, dstFs, dstHandle, cb, qcb) {
	debug("copyDirectory %j %j", srcHandle, dstHandle);
	srcFs.listFiles(srcHandle, function(err, files) {
		if(err) { if(qcb) qcb(null); return cb(err); }
		var join = Join();
		var loop = function(i, qcb) {
			if(i >= files.length) return process.nextTick( qcb.bind(null, null) );
			copyFile(srcFs, files[i].handle, files[i].name, dstFs, dstHandle, join(), qcb);
			queue.push( loop.bind(null, i+1) );
		};
		queue.push( loop.bind(null, 0) );
		if(qcb) qcb(null);
		join.then(cb)
	});
}*/


var copyDirectory = function(srcFs, srcHandle, dstFs, dstHandle, cb, qcb) {
	debug("copyDirectory %j %j", srcHandle, dstHandle);
	srcFs.listFiles(srcHandle, function(err, files) {
		if(err) { if(qcb) qcb(null); return cb(err); }
		var join = new Joiner(files.length+1);
		var loop = function(i, qcb) {
			if(i >= files.length) return process.nextTick( function() { qcb(null); join.fun(null); } );
			copyFile(srcFs, files[i].handle, files[i].name, dstFs, dstHandle, join.fun.bind(join), qcb);
			queue.push( loop.bind(null, i+1) );
		};
		queue.push( loop.bind(null, 0) );
		if(qcb) qcb(null);
		join.then(cb)
	});
}

// copy a file into a location, File can be regular file or directory
var copyFile = function(srcFs, srcHandle, name, dstFs, dstHandle, cb, qcb) {
	var dstExistsIsDirectory = function(cb) {
		dstFs.exists(dstHandle, name, function(err, existsHandle) {
			if(err) return cb(err);
			if(!existsHandle.exists) return cb(null, { exists: false } );
			dstFs.isDirectory(existsHandle.handle, function(err, isDirectory) {
				if(err) return cb(err);
				cb(null, { exists: true, handle: existsHandle.handle, isDirectory: isDirectory } );
			});
		})
	}
	async.parallel({
		srcIsDirectory: srcFs.isDirectory.bind(null, srcHandle),
		dstExistsIsDirectory: dstExistsIsDirectory
	}, function(err, results) { 
		if(err) return cb(err);
		if(results.srcIsDirectory) {
			if(!results.dstExistsIsDirectory.exists) {
				dstFs.createDirectory(dstHandle, name, function(err, handle) {
					if(err) return cb(err);
					copyDirectory(srcFs, srcHandle, dstFs, handle, cb, qcb);
				});
			} else if(results.dstExistsIsDirectory.isDirectory) {
				copyDirectory(srcFs, srcHandle, dstFs, results.dstExistsIsDirectory.handle, cb, qcb);
			} else {
				cb(new Error(name + " is directory in src but regular file in destination"));
				if(qcb) qcb(null);
			}
		} else {
			if(!results.dstExistsIsDirectory.exists) {
				copyRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, cb);
				if(qcb) qcb(null);
			} else if(!results.dstExistsIsDirectory.isDirectory) {
				dstFs.unlink(results.dstExistsIsDirectory.handle, function(err) {
					if(err) return cb(err);
					copyRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, cb);
					if(qcb) qcb(null);
				});
			} else {
				cb(new Error(name + " is regular file in src but directory in destination"));
				if(qcb) qcb(null);
			}
		}
	});
	
}


var ActivityMonitor = function() {
	this.activities = [];
}
ActivityMonitor.prototype.start = function(activity) {
	this.activities.push(activity);
	console.log("added %d", this.activities.length-1);
	this.display();
	return activity;
}
ActivityMonitor.prototype.end = function(activityId) {
	var i = 0;
	for(i = 0 ; i < this.activities.length && this.activities[i] !== activityId ; i++);
	this.activities.splice(i, 1);
	console.log("removed %d", i);
	this.display();
}
ActivityMonitor.prototype.display = function() {
	this.activities.forEach(function(activity) {
		console.log("%s %d", activity.description, activity.progress);
	})
}
var activityMonitor = new ActivityMonitor();

util.inherits(StreamCounter, Transform);

function StreamCounter(options) {
	Transform.call(this, options);
	this.bytes = 0;
}

StreamCounter.prototype._transform = function (data, encoding, callback) {
	this.bytes += data.length;
	this.emit('progress', this.bytes);
	callback(null, data);
};


var copyRegularFile = function(srcFs, srcHandle, name, dstFs, dstHandle, cb) {
	debug("copyRegularFile %j %s %j", srcHandle, name, dstHandle);
	var activity = { description: "copy " + name, progress: 0 };
	var activityId = activityMonitor.start( activity );
	srcFs.getSize(srcHandle, function(err, size) {	
		if(err) return cb(err);
		srcFs.readFile(srcHandle, function(err, stream) {
			if(err) return cb(err);
			var cbCalled = false;
			stream.on("error", function(err) {
				done(err);
			});
			var streamCounter = new StreamCounter();
			streamCounter.on("progress", function(bytes) {
				activity.progress = bytes*100/size;
				activityMonitor.display();
			});
			dstFs.createFile(dstHandle, name, stream.pipe(streamCounter), size, function(err) {
				done(err);
			});
			function done(err) {
				activityMonitor.end(activityId);
				if (!cbCalled) {
					cb(err);
					cbCalled = true;
				}
			}
		});
	});
}



var rsyncDirectory = function(srcFs, srcHandle, dstFs, dstHandle, cb, qcb) {
	debug("rsyncDirectory %j %j", srcHandle, dstHandle);
	async.parallel({
		src: srcFs.listFiles.bind(srcFs, srcHandle),
		dst: dstFs.listFiles.bind(dstFs, dstHandle)
	}, function(err, files) {
		if(err) return cb(err);
		var join = new Joiner(files.src.length+files.dst.length+1);
		var loop = function(srcIt, dstIt, qcb) {
			console.log("loop(%j, %j, %d, %d): enter", srcHandle, dstHandle, srcIt, dstIt);
			if(srcIt >= files.src.length && dstIt >= files.dst.length) return process.nextTick( function() {
				console.log("loop(%j, %j, %d, %d): exit 1", srcHandle, dstHandle, srcIt, dstIt);
				 qcb(null); join.fun(null);
			} );
			var nextSrcIt = srcIt, nextDstIt = dstIt;

			if(	(dstIt === files.dst.length) ||
				(srcIt < files.src.length && dstIt < files.dst.length && files.src[srcIt].name < files.dst[dstIt].name) ) {
				console.log("loop(%j, %j, %d, %d): exit 2", srcHandle, dstHandle, srcIt, dstIt);
				rsyncFile(srcFs, files.src[srcIt].handle, files.src[srcIt].name, dstFs, dstHandle, join.fun.bind(join), qcb);
				nextSrcIt++;
				
			}
			else if( (srcIt === files.src.length) ||
				(srcIt < files.src.length && dstIt < files.dst.length && files.src[srcIt].name > files.dst[dstIt].name) ) {
				// handle outstanding
				process.nextTick( function() {
					qcb(null); join.fun(null);
					console.log("loop(%j, %j, %d, %d): exit 3", srcHandle, dstHandle, srcIt, dstIt);
				} );
				nextDstIt++;
				
			} else {
				async.parallel({
					src: srcFs.isDirectory.bind(srcFs, files.src[srcIt].handle),
					dst: dstFs.isDirectory.bind(dstFs, files.dst[dstIt].handle)
				}, function(err, isDirectory) {
					if(isDirectory.src !== isDirectory.dst) {
						join.fun(new Error("mismatch file type for file " + files.src[srcIt].name));
						qcb(null);
						console.log("loop(%j, %j, %d, %d): exit 4", srcHandle, dstHandle, srcIt, dstIt);
					} else if(isDirectory.src && isDirectory.dst) {
						rsyncDirectory(srcFs, files.src[srcIt].handle, dstFs, files.dst[dstIt].handle, join.fun.bind(join), qcb);
						console.log("loop(%j, %j, %d, %d): exit 5", srcHandle, dstHandle, srcIt, dstIt);
					}
					else if(!isDirectory.src && !isDirectory.dst) {
						rsyncRegularFile(srcFs, files.src[srcIt].handle, files.src[srcIt].name, dstFs, dstHandle, files.dst[dstIt].handle, join.fun.bind(join)); 
						qcb(null)
						console.log("loop(%j, %j, %d, %d): exit 6", srcHandle, dstHandle, srcIt, dstIt);
					}
					join.fun(null) // needed because join waits for src.length + dst.length. for this case we need 2 join.fun calls, this is the first one, 2nd one is with code above
				});
				nextSrcIt++; nextDstIt++;
			}
			queue.push( loop.bind(null, nextSrcIt, nextDstIt) );
		};
		queue.push( loop.bind(null, 0, 0) )
		join.then(cb);
		if(qcb) qcb(null)
	});
}

var rsyncRegularFile = function(srcFs, srcHandle, name, dstFs, dstHandle, dstFileHandle, cb) {
	debug("rsyncRegularFile %j %s %j %j", srcHandle, name, dstHandle, dstFileHandle);
	async.parallel({
		src: srcFs.getSize.bind(srcFs, srcHandle),
		dst: dstFs.getSize.bind(dstFs, dstFileHandle)
	}, function(err, size) {
		if(size.src !== size.dst) {
			dstFs.unlink(dstHandle, function(err) {
				if(err) return cb(err);
				copyRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, cb);
			});
		}
		else {
			async.parallel({
				src: srcFs.getMD5.bind(srcFs, srcHandle),
				dst: dstFs.getMD5.bind(dstFs, dstFileHandle)
			}, function(err, hash) {
				if(hash.src !== hash.dst) {
					dstFs.unlink(files.dst[dstIt].handle, function(err) {
						if(err) return cb(err);
						copyRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, cb);
					});
				} else cb(null); // files are identical
			});
		}
	});
}

var deleteFile = function(xfs, handle, cb, qcb) {
	debug("deleteFile %j", handle);
	xfs.isDirectory(handle, function(err, isDirectory) {
		if(err) { if(qcb) qcb(err); return cb(err); }
		if(isDirectory) {
			deleteDirectory(xfs, handle, cb, qcb);
		} else { 
			xfs.unlink(handle, cb);
			if(qcb) qcb(null);
		}
	});
}


var deleteDirectory = function(xfs, handle, cb, qcb) {
	debug("deleteDirectory %j", handle);
	xfs.listFiles(handle, function(err, files) {
		if(err) { if(qcb) qcb(err); return cb(err); }
		var join = new Joiner(files.length+1); //+1 so we handle empty directories
		var loop = function(i, qcb) {
			if(i >= files.length) return process.nextTick( function() { qcb(null); join.fun(null); } );
			deleteFile(xfs, files[i].handle, join.fun.bind(join), qcb)
			queue.push( loop.bind(null, i+1) )
		};
		queue.push( loop.bind(null, 0))
		if(qcb) qcb(null)
		join.then(function(err){
			if(err) return cb(err);
			xfs.rmdir(handle, cb);
		})
	});
}

var rsyncFile = function(srcFs, srcHandle, name, dstFs, dstHandle, cb, qcb) {
	debug("rsyncFile %j %s %j", srcHandle, name, dstHandle);
	var dstExistsIsDirectory = function(cb) {
		dstFs.exists(dstHandle, name, function(err, existsHandle) {
			if(err) return cb(err);
			if(!existsHandle.exists) return cb(null, { exists: false } );
			dstFs.isDirectory(existsHandle.handle, function(err, isDirectory) {
				if(err) return cb(err);
				cb(null, { exists: true, handle: existsHandle.handle, isDirectory: isDirectory } );
			});
		})
	}
	async.parallel({
		srcIsDirectory: srcFs.isDirectory.bind(srcFs, srcHandle),
		dstExistsIsDirectory: dstExistsIsDirectory
	}, function(err, results) { 
		if(err) { qcb(null); return cb(err); }
		if(results.srcIsDirectory) {
			if(!results.dstExistsIsDirectory.exists) {
				dstFs.createDirectory(dstHandle, name, function(err, handle) {
					if(err) { qcb(null); return cb(err); }
					rsyncDirectory(srcFs, srcHandle, dstFs, handle, cb, qcb);
				});
			} else if(results.dstExistsIsDirectory.isDirectory) {
				rsyncDirectory(srcFs, srcHandle, dstFs, results.dstExistsIsDirectory.handle, cb, qcb);
			} else {
				dstFs.unlink(results.dstExistsIsDirectory.handle, function(err) {
					if(err) { qcb(null); return cb(err); }
					dstFs.createDirectory(dstHandle, name, function(err, handle) {
						if(err) return cb(err);
						rsyncDirectory(srcFs, srcHandle, dstFs, handle, qcb);
					});
				});
			}
		} else {
			if(!results.dstExistsIsDirectory.exists) {
				copyRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, cb);
				if(qcb) qcb(null);
			} else if(!results.dstExistsIsDirectory.isDirectory) {
				rsyncRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, results.dstExistsIsDirectory.handle, cb);
				if(qcb) qcb(null);
			} else {
				dstFs.deleteDirectory(results.dstExistsIsDirectory.handle, function(err) {
					if(err) { qcb(null); return cb(err); }
					copyRegularFile(srcFs, srcHandle, name, dstFs, dstHandle, cb, qcb);
				});
			}
		}
	});
	
}




var deleteItem = function(cursor, item, lazyCursor, cb) {
	debug("deleteItem %j %s %j", cursor, item.name, lazyCursor);
	lazyCursor.get(function(err, archiveCursor) {
		if(err) return cb(err);
		copyFile(cursor, item, archiveCursor, function(err) {
			if(err) return cb(err);
			cursor.deleteItem(item, cb);
		});
	});
}

var LazyCursor = function(cursor, name) {
	if(name) {
		this.lazyParentCursor = cursor;
		this.name = name;
	} else {
		this.cursor = cursor;
	}
}

LazyCursor.prototype.get = function(cb) {
	var self = this;
	if(self.cursor) {
		return process.nextTick (function() {
			cb(null, self.cursor);
		});
	} else {
		self.lazyParentCursor.get(function(err, parentCursor) {
			if(err) return cb(err);
			parentCursor.createFolder(self.name, function(err, cursor) {
				if(err) return cb(err);
				self.cursor = cursor;
				self.get(cb);
			});
			
		});
	}
}

var resolveUrl = function(tUrl, options, cb) {
	var protocol = tUrl.substr(0, tUrl.indexOf(":"));
	var path = tUrl.substr(tUrl.indexOf(":") + 1);
	var tFsMod;
	switch(protocol) {
		case "acd":
			tFsMod = AcdFs;
		break;
		case "":
			tFsMod = FsFs;
		break;
		default:
			process.nextTick( cb.bind(null, new Error("Unknown protocol: " + protocol) ) );
		break;

	}
	tFsMod.createFs(options, function(err, tFs) {
		if(err) return cb(err);
		tFs.init(path, function(err, file){
			if(err) return cb(err);
			cb(null, { fs: tFs, file: file });
		});
	})
};

(function(cb) {

var argvIt = 2;
var command = process.argv[argvIt++];
var options = {};
var tasks = [];
for( ; argvIt < process.argv.length ; argvIt++) {
	if(process.argv[argvIt].startsWith("--option-")) options[process.argv[argvIt].substr("--option-".length)] = process.argv[argvIt++];
	else if(!process.argv[argvIt].startsWith("-")) {
		tasks.push( resolveUrl.bind(null, process.argv[argvIt], options) )
		options = {};
	}
	else return cb( new Error("unrecognized option '" + process.argv[argvIt] + "'") )
}

async.parallel(tasks, function(err, results){
	if(err) return cb(err);

	switch(command) {
		case "ls":
			results.forEach(function(item) {
				item.fs.listFiles(item.file.handle, function(err, files) {
					if(err) return cb(err);
					files.forEach( function(file) {
						console.log(file.name)
					})
				})
			})
		break;
		case "cp":
			var dest = results.pop();
			results.forEach( function(item) {
				copyFile(item.fs, item.file.handle, item.file.name, dest.fs, dest.file.handle, cb)
			})
		break;
		case "rm": 
			results.forEach( function(item) {
				deleteFile(item.fs, item.file.handle, cb)
			})
		break;
		case "rsync": 
			var dest = results.pop();
			results.forEach( function(item) {
				rsyncFile(item.fs, item.file.handle, item.file.name, dest.fs, dest.file.handle, cb)
			})
		break;
		default: 
			process.nextTick( cb.bind(null, new Error("unrecognized command: " + command) ))

		break;
	}


})


})(function(err) {
	console.log("result: %s", err || "SUCCESS");
})



/*(function(cb) {
	async.parallel([
		fromCursor.init.bind(fromCursor, fromLocation),
		toCursor.init.bind(toCursor, toLocation),
		archiveCursor.init.bind(archiveCursor, archiveLocation)
	], function(err, results) {
		if(err) return cb(err);
		rsync({}, fromCursor, toCursor, new LazyCursor(archiveCursor), cb);
	});
})(function (err){
	console.log("rsync: %s", err || "SUCCESS");
});

process.on('beforeExit', function() {
	console.log("beforeExit: queue %d %d %d", queue.started, queue.running(), queue.length());
});

process.on('exit', function() {
	console.log("exit: queue %d %d %d", queue.started, queue.running(), queue.length());
});
var util = require("util");
process.on('SIGINT', function() { console.log( util.inspect(process._getActiveHandles()) ); console.log(process._getActiveHandles()[0].constructor.name); console.log( util.inspect(process._getActiveRequests()) ); process.exit(); });*/


