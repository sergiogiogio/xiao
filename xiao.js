'use strict';

var assert = require('assert');

var fs = require("fs");
var async = require("async");
var path = require("path");
var debug = require("debug")("xiao");
var debug_dev = require("debug")("xiao-dev");
var util = require("util");
var url = require('url');
var Transform = require('stream').Transform;
var minimatch = require('minimatch');

var AcdFs = require("./AcdFs");
var GoogleFs = require("./GoogleFs");
var FsFs = require("./FsFs");

var Joiner = function(count) {
	this.count = count;
	this.cbCalled = false;
	this.err = null;
}
Joiner.prototype.then = function(cb) {
	this.cb = cb
}
Joiner.prototype.fun = function(err) {
	debug_dev("join.fun callback %j", this)
	if(err) if(!this.err) this.err = err;
	if(this.err) if(!this.cbCalled) { this.cbCalled = true; return this.cb(this.err) }
	if(--this.count === 0) if(!this.cbCalled) { this.cbCalled = true; return this.cb(this.err) }
	
}

//var queue = async.queue(function(fun, cb) { var cbCalled = false; var qcb = function(err) { if(!CbCalled) { cbCalled = true; return cb(err); } } fun(qcb, qcb); }, 1);
var sQueueJobId = 0;
var queue = async.queue(function(fun, cb) { var jobId=sQueueJobId++; var qcb=function(err, result) { debug_dev("queue callback %d %s", jobId, err); cb(err, result) }; qcb.jobId = jobId; fun(qcb); }, 1);
var qcbJobId = function(qcb) {
	if(qcb === undefined) return 0;
	return qcb.jobId;
}

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


var copyDirectory = function(options, srcFs, srcHandle, dstFs, dstHandle, cb, qcb) {
	debug("copyDirectory %j %j", srcHandle, dstHandle);
	srcFs.listFiles(srcHandle, function(err, files) {
		if(err) { if(qcb) qcb(null); return cb(err); }
		var join = new Joiner(files.length+1);
		var loop = function(i, qcb) {
			if(i >= files.length) return process.nextTick( function() { qcb(null); join.fun(null); } );
			copyFile(options, srcFs, files[i].handle, files[i].name, dstFs, dstHandle, files[i].name, join.fun.bind(join), qcb);
			queue.push( loop.bind(null, i+1) );
		};
		queue.push( loop.bind(null, 0) );
		if(qcb) qcb(null);
		join.then(cb)
	});
}


var copyFile = function(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb) {
	debug("copyFile %j %j %s %j %s %d", options, srcHandle, name, dstHandle, dstName, qcbJobId(qcb));
	async.parallel({
		srcIsDirectory: srcFs.isDirectory.bind(srcFs, srcHandle),
		dstExistsIsDirectory: existsAndIsDirectory.bind(null, dstFs, dstHandle, dstName)
	}, function(err, results) { 
		if(err) { if(qcb) qcb(null); return cb(err); }
		if(!results.dstExistsIsDirectory.exists) {
			if(results.srcIsDirectory) {
				// assumes -r
				debug_dev("mode 1")
				dstFs.createDirectory(dstHandle, dstName, function(err, handle) {
					if(err) { if(qcb) qcb(null); return cb(err); }
					copyDirectory(options, srcFs, srcHandle, dstFs, handle, cb, qcb);
				});
				
			} else {
				debug_dev("mode 2")
				copyRegularFile(options, srcFs, srcHandle, dstName, dstFs, dstHandle, dstName, cb, qcb);
			}
		} else if(!results.dstExistsIsDirectory.isDirectory) {
			debug_dev("mode 3")
			if(results.srcIsDirectory) { if(qcb) qcb(null); return cb( new Error("cannot overwrite non-directory '" + dstName + "' with directory '" + name + "'")  ); }
			dstFs.unlink(results.dstExistsIsDirectory.handle, function(err) {
				if(err) { if(qcb) qcb(null); return cb(err); }
				copyRegularFile(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb);
			});
		} else { // results.dstExistsIsDirectory.exists && results.dstExistsIsDirectory.isDirectory
			debug_dev("mode 4")
			if(!results.srcIsDirectory) { if(qcb) qcb(null); return cb( new Error("cannot overwrite directory '" + dstName + "' with non-directory '" + name + "'")  ); }
			copyDirectory(options, srcFs, srcHandle, dstFs, results.dstExistsIsDirectory.handle, cb, qcb);
		}
	});
	
}


var copyFiles = function (options, src, dstFs, dstHandle, dstName, cb, qcb) {
	debug("copyFiles %j %j %j %s %d", options, src, dstHandle, dstName, qcbJobId(qcb));
	var tasks = {};

	tasks.dstExistsIsDirectory = existsAndIsDirectory.bind(null, dstFs, dstHandle, dstName);
	var doCopy = function(dstHandle, dstName) {
		if(src.length === 0) { if(qcb) qcb(null); return cb(null); }
		var join = new Joiner(src.length);
		src.forEach( function(item) {
			copyFile(options, item.fs, item.file.handle, item.file.name, dstFs, dstHandle, dstName || item.file.name, join.fun.bind(join))
		})
		join.then(cb);
		if(qcb) qcb(null);
	}

	async.parallel(tasks, function(err, results) {
		if(err) { if(qcb) qcb(null); return cb(err); }
		if(results.dstExistsIsDirectory.exists && results.dstExistsIsDirectory.isDirectory) {
			doCopy(results.dstExistsIsDirectory.handle, null)
		} else if (src.length === 1) {
			doCopy(dstHandle, dstName)
		} else {
			if(qcb) qcb(null);
			return cb( new Error("target '" + dstName + "' is not a directory" ));
		}
	});
}

// copy a file into a directory, file can be regular file or directory
// srcHandle: handle of the file
// name: name of the source file
// dstHandle: handle of the directory
// dstName: name of the dest file 
var copyFile2 = function(srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb) {
	debug("copyFile %j %s %j %s", srcHandle, name, dstHandle, dstName);
	var dstExistsIsDirectory = function(cb) {
		dstFs.exists(dstHandle, dstName, function(err, existsHandle) {
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
		if(err) return cb(err);
		if(results.srcIsDirectory) {
			if(!results.dstExistsIsDirectory.exists) {
				dstFs.createDirectory(dstHandle, dstName, function(err, handle) {
					if(err) return cb(err);
					copyDirectory(options, srcFs, srcHandle, dstFs, handle, cb, qcb);
				});
			} else if(results.dstExistsIsDirectory.isDirectory) {
				copyDirectory(options, srcFs, srcHandle, dstFs, results.dstExistsIsDirectory.handle, cb, qcb);
			} else {
				cb(new Error("cannot overwrite non-directory '" + dstName + "' with directory '" + name + "'"));
				if(qcb) qcb(null);
			}
		} else {
			if(!results.dstExistsIsDirectory.exists) {
				copyRegularFile(options, srcFs, srcHandle, dstName, dstFs, dstHandle, dstName, cb, qcb);
			} else if(!results.dstExistsIsDirectory.isDirectory) {
				dstFs.unlink(results.dstExistsIsDirectory.handle, function(err) {
					if(err) return cb(err);
					copyRegularFile(options, srcFs, srcHandle, dstName, dstFs, dstHandle, dstName, cb, qcb);
				});
			} else {
				cb(new Error("cannot overwrite directory '" + dstName + "' with non-directory '" + name + "'"));
				if(qcb) qcb(null);
			}
		}
	});
	
}


var ActivityMonitor = function() {
	this.activities = [];
	this.linesWritten = 0;
}
ActivityMonitor.prototype.start = function(activity) {
	this.activities.push(activity);
	debug_dev("added %d", this.activities.length-1);
	this.display();
	return activity;
}
ActivityMonitor.prototype.end = function(activityId) {
	var i = 0;
	for(i = 0 ; i < this.activities.length && this.activities[i] !== activityId ; i++);
	this.activities.splice(i, 1);
	debug_dev("removed %d", i);
	this.display();
}
ActivityMonitor.prototype.notifyProgress = function(activityId) {
	this.display();
}
ActivityMonitor.prototype.display = function() {
	if(this.linesWritten > 0) process.stdout.write("\u001b["+(this.linesWritten)+"A");
	this.activities.forEach(function(activity) {
		console.log("%s %d", activity.description, activity.progress);
	})
	this.linesWritten = this.activities.length;
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

// copy a regular file into a directory (assumption: file does not already exist)
// srcHandle: handle of the file
// name: name of the file
// dstHandle: handle of the directory
var copyRegularFile = function(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb) {
	debug("copyRegularFile %j %s %j %s %d", srcHandle, name, dstHandle, dstName, qcbJobId(qcb));
	srcFs.getSize(srcHandle, function(err, size) {	
		if(err) { if(qcb) qcb(null); return cb(err); }
		srcFs.readFile(srcHandle, function(err, stream) {
			if(err) {
				debug("copyRegularFile:readFile(err) %j %s %j %s %s", srcHandle, name, dstHandle, dstName, err);
				if(qcb) qcb(null); return cb(err);
			}

			
			var doCopy = function(qcb) {
				var activity = { description: "copy " + name, progress: 0 };
				var activityId = activityMonitor.start( activity );
				var cbCalled = false;
				stream.on("error", function(err) {
					done(err);
				});
				var streamCounter = new StreamCounter();
				streamCounter.on("progress", function(bytes) {
					activity.progress = bytes*100/size;
					activityMonitor.notifyProgress(activityId);
				});
				var timesTask = { modifiedTime: srcFs.getModifiedTime.bind(null, srcHandle) };
				if(srcFs.getCreatedTime) timesTask.createdTime = srcFs.getCreatedTime.bind(null, srcHandle)
				async.parallel(timesTask, function(err, times) {
					debug_dev("times = %j", times);
					if(err) done(err);
					dstFs.createFile(dstHandle, dstName, stream.pipe(streamCounter), size, times, function(err) {
						done(err);
					});

				})
				function done(err) {
					if (!cbCalled) {
						if(err) {
							streamCounter.unpipe();
							streamCounter.end();
							stream.unpipe(); // else the stream continues despite of the error?
							//stream.end(); // end is not a method of readstreams
						}
						activityMonitor.end(activityId);
						qcb(null);
						cb(err);
						cbCalled = true;
					}
				}
			}

			queue.push( doCopy );
			if(qcb) qcb(null);
		});
	});
}



var rsyncDirectory = function(options, srcFs, srcHandle, dstFs, dstHandle, cb, qcb) {
	debug("rsyncDirectory %j %j %j %d", options, srcHandle, dstHandle, qcbJobId(qcb));
	async.parallel({
		src: srcFs.listFiles.bind(srcFs, srcHandle),
		dst: dstFs.listFiles.bind(dstFs, dstHandle)
	}, function(err, files) {
		if(err) return cb(err);
		var sortFiles = function(a, b){
			if(a.name < b.name) return -1;
			if(a.name > b.name) return 1;
			return 0;
		};
		files.src.sort(sortFiles);
		files.dst.sort(sortFiles);
		var join = new Joiner(files.src.length+files.dst.length+1);
		var loop = function(srcIt, dstIt, qcb) {
			debug_dev("loop(%j, %j, %d, %d): enter", srcHandle, dstHandle, srcIt, dstIt);
			if(srcIt >= files.src.length && dstIt >= files.dst.length) return process.nextTick( function() {
				debug_dev("loop(%j, %j, %d, %d): exit 1", srcHandle, dstHandle, srcIt, dstIt);
				qcb(null); join.fun(null);
			} );
			var nextSrcIt = srcIt, nextDstIt = dstIt;

			if(	(dstIt === files.dst.length) ||
				(srcIt < files.src.length && dstIt < files.dst.length && files.src[srcIt].name < files.dst[dstIt].name) ) {
				debug_dev("loop(%j, %j, %d, %d): exit 2", srcHandle, dstHandle, srcIt, dstIt);
				rsyncFile(options, srcFs, files.src[srcIt].handle, files.src[srcIt].name, dstFs, dstHandle, files.src[srcIt].name, join.fun.bind(join), qcb);
				nextSrcIt++;
				
			}
			else if( (srcIt === files.src.length) ||
				(srcIt < files.src.length && dstIt < files.dst.length && files.src[srcIt].name > files.dst[dstIt].name) ) {
				// handle outstanding
				process.nextTick( function() {
					qcb(null); join.fun(null);
					debug_dev("loop(%j, %j, %d, %d): exit 3", srcHandle, dstHandle, srcIt, dstIt);
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
						debug_dev("loop(%j, %j, %d, %d): exit 4", srcHandle, dstHandle, srcIt, dstIt);
					} else if(isDirectory.src && isDirectory.dst) {
						rsyncDirectory(options, srcFs, files.src[srcIt].handle, dstFs, files.dst[dstIt].handle, join.fun.bind(join), qcb);
						debug_dev("loop(%j, %j, %d, %d): exit 5", srcHandle, dstHandle, srcIt, dstIt);
					}
					else if(!isDirectory.src && !isDirectory.dst) {
						rsyncRegularFile(options, srcFs, files.src[srcIt].handle, files.src[srcIt].name, dstFs, dstHandle, files.dst[dstIt].handle, files.src[srcIt].name, join.fun.bind(join), qcb); 
						debug_dev("loop(%j, %j, %d, %d): exit 6", srcHandle, dstHandle, srcIt, dstIt);
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
// rsync 2 existing files
// contrary to copyRegularFile, the dest *file* handle is required as it is most likely available at the caller!
var rsyncRegularFile = function(options, srcFs, srcHandle, name, dstFs, dstHandle, dstFileHandle, dstName, cb, qcb) {
	debug("rsyncRegularFile %j %s %j %j %s %d", srcHandle, name, dstHandle, dstFileHandle, dstName, qcbJobId(qcb));
	async.parallel({
		src: srcFs.getSize.bind(srcFs, srcHandle),
		dst: dstFs.getSize.bind(dstFs, dstFileHandle)
	}, function(err, size) {
		var replace = function() {
			dstFs.unlink(dstFileHandle, function(err) {
				if(err) { if(qcb) qcb(null); return cb(err); }
				copyRegularFile(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb);
			});
		}

		if(size.src !== size.dst) {
			replace();
		}
		else {
			async.parallel({
				src: srcFs.getMD5.bind(srcFs, srcHandle),
				dst: dstFs.getMD5.bind(dstFs, dstFileHandle)
			}, function(err, hash) {
				if(err) { if(qcb) qcb(null); return cb(err); }
				if(hash.src !== hash.dst) {
					replace();
				} else {
					if(qcb) qcb(null);
					cb(null); // files are identical
				}
			});
		}
	});
}

var deleteFilePath = function(options, tFs, tPath, cb, qcb) {
	debug("deleteFilePath %j %j %s %d", options, tFs, tPath, qcbJobId(qcb));
	tFs.init(tPath, function(err, file) {
		if(err && err.code == "ENOENT") { if(qcb) qcb(null); return cb(null); } // non existing file is not an error
		else if(err) { if(qcb) qcb(err); return cb(err); }
		deleteFile(tFs, file.handle, cb, qcb);
	})
	
}



var deleteFile = function(xfs, handle, cb, qcb) {
	debug("deleteFile %j %d", handle, qcbJobId(qcb));
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


// rsync a file into a directory
var rsyncFile2 = function(srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb) {
	debug("rsyncFile %j %s %j %s", srcHandle, name, dstHandle, dstName);
	var dstExistsIsDirectory = function(cb) {
		dstFs.exists(dstHandle, dstName, function(err, existsHandle) {
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
				dstFs.createDirectory(dstHandle, dstName, function(err, handle) {
					if(err) { qcb(null); return cb(err); }
					rsyncDirectory(options, srcFs, srcHandle, dstFs, handle, cb, qcb);
				});
			} else if(results.dstExistsIsDirectory.isDirectory) {
				rsyncDirectory(options, srcFs, srcHandle, dstFs, results.dstExistsIsDirectory.handle, cb, qcb);
			} else {
				dstFs.unlink(results.dstExistsIsDirectory.handle, function(err) {
					if(err) { qcb(null); return cb(err); }
					dstFs.createDirectory(dstHandle, dstName, function(err, handle) {
						if(err) return cb(err);
						rsyncDirectory(options, srcFs, srcHandle, dstFs, handle, qcb);
					});
				});
			}
		} else {
			if(!results.dstExistsIsDirectory.exists) {
				copyRegularFile(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb);
			} else if(!results.dstExistsIsDirectory.isDirectory) {
				rsyncRegularFile(options, srcFs, srcHandle, name, dstFs, dstHandle, results.dstExistsIsDirectory.handle, dstName, cb, qcb);
			} else {
				dstFs.deleteDirectory(results.dstExistsIsDirectory.handle, function(err) {
					if(err) { qcb(null); return cb(err); }
					copyRegularFile(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb);
				});
			}
		}
	});
	
}


var existsAndIsDirectory = function(fs, handle, name, cb) {
	fs.exists(handle, name, function(err, existsHandle) {
		if(err) return cb(err);
		if(!existsHandle.exists) return cb(null, { exists: false } );
		fs.isDirectory(existsHandle.handle, function(err, isDirectory) {
			if(err) return cb(err);
			cb(null, { exists: true, handle: existsHandle.handle, isDirectory: isDirectory } );
		});
	})
}

var rsyncFile = function(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb) {
	debug("rsyncFile %j %j %s %j %s %d", options, srcHandle, name, dstHandle, dstName, qcbJobId(qcb));
	async.parallel({
		srcIsDirectory: queue.push.bind(null, srcFs.isDirectory.bind(null, srcHandle) ),
		dstExistsIsDirectory: queue.push.bind(null, existsAndIsDirectory.bind(null, dstFs, dstHandle, dstName) )
	}, function(err, results) { 
		if(err) { if(qcb) qcb(null); return cb(err); }
		if(!results.dstExistsIsDirectory.exists) {
			if(results.srcIsDirectory) {
				// assumes -r
				debug_dev("mode 1")
				dstFs.createDirectory(dstHandle, dstName, function(err, handle) {
					if(err) { if(qcb) qcb(null); return cb(err); }
					rsyncDirectory(options, srcFs, srcHandle, dstFs, handle, cb, qcb);
				});
				
			} else {
				debug_dev("mode 2")
				copyRegularFile(options, srcFs, srcHandle, dstName, dstFs, dstHandle, dstName, cb, qcb);
			}
		} else if(!results.dstExistsIsDirectory.isDirectory) {
			debug_dev("mode 3")
			if(results.srcIsDirectory) { if(qcb) qcb(null); return cb( new Error("ERROR: destination must be a directory when copying more than 1 file")  ); }
			rsyncRegularFile(options, srcFs, srcHandle, name, dstFs, dstHandle, results.dstExistsIsDirectory.handle, dstName, cb, qcb);
		} else { // results.dstExistsIsDirectory.exists && results.dstExistsIsDirectory.isDirectory
			debug_dev("mode 4")
			if(!results.srcIsDirectory) {
				dstFs.unlink(results.dstExistsIsDirectory.handle, function(err) {
					if(err) { if(qcb) qcb(null); return cb(err); }
					rsyncFile(options, srcFs, srcHandle, name, dstFs, dstHandle, dstName, cb, qcb);
				});
			}
			else rsyncDirectory(options, srcFs, srcHandle, dstFs, results.dstExistsIsDirectory.handle, cb, qcb);
		}
	});
	
}
var rsyncFiles = function (options, src, dstFs, dstHandle, dstName, cb, qcb) {
	debug("rsyncFiles %j %j %j %s %d", options, src, dstHandle, dstName, qcbJobId(qcb));
	var tasks = {};

	if(src.length === 1) {
		tasks.srcIsDirectory = src[0].fs.isDirectory.bind(src[0].fs, src[0].file.handle);
	}
	tasks.dstExistsIsDirectory = existsAndIsDirectory.bind(null, dstFs, dstHandle, dstName);
	var doRsync = function(dstHandle, dstName) {
		if(src.length === 0) { if(qcb) qcb(null); return cb(null); }
		var join = new Joiner(src.length);
		src.forEach( function(item) {
			rsyncFile(options, item.fs, item.file.handle, item.file.name, dstFs, dstHandle, dstName || item.file.name, join.fun.bind(join))
		})
		join.then(cb);
		if(qcb) qcb(null);
	}

	async.parallel(tasks, function(err, results) {
		if(err) { if(qcb) qcb(null); return cb(err); }
		if(results.dstExistsIsDirectory.exists && results.dstExistsIsDirectory.isDirectory) {
			doRsync(results.dstExistsIsDirectory.handle, null);
		} else if(src.length > 1 || results.srcIsDirectory) {
			if(!results.dstExistsIsDirectory.exists) {
				dstFs.createDirectory(dstHandle, dstName, function(err, handle) {
                                        if(err) { if(qcb) qcb(null); return cb(err); }
					doRsync(handle, null);
                                });
			} else {
				if(qcb) qcb(null);
				return cb( new Error("ERROR: destination must be a directory when copying more than 1 file" ));
			}
		} else { // dest is not a directory (or does not exist) && only 1 source (regular file)
			doRsync(dstHandle, dstName)
		}
	})
}
var createDirectory = function (options, tFs, tPath, cb, qcb) {
	debug("createDirectory %j %j %s", options, tFs, tPath);

	if(tPath === "") tPath = ".";
	tFs.init(tPath, function(err, file) {
		if(err) {
			var parsedPath = path.parse(tPath);
			return createDirectory(options, tFs, parsedPath.dir, function(err, parent) {
				if(err) { if(qcb) qcb(null); return cb(err); }
				tFs.createDirectory(parent, parsedPath.base, function(err, file) {
					if(qcb) qcb(null);
					cb(err, file);
				});
			}, qcb);
		}
		tFs.isDirectory(file.handle, function(err, isDirectory) {
			if(qcb) qcb(null);
			if(err) return cb(err);
			if(!isDirectory) { err = new Error("cannot create directory '" + tPath + "': File exists"); return cb(err); }
			cb(null, file.handle);
		})
	});
}

var deleteItem = function(cursor, item, lazyCursor, cb) {
	debug("deleteItem %j %s %j", cursor, item.name, lazyCursor);
	lazyCursor.get(function(err, archiveCursor) {
		if(err) return cb(err);
		copyFile(options, cursor, item, archiveCursor, function(err) {
			if(err) return cb(err);
			cursor.deleteItem(item, cb);
		});
	})
}

var LazyHandle = function(xfs, handle, name) {
	this.fs = xfs;
	if(name) {
		this.parent = handle;
		this.name = name;
	} else {
		this.handle = handle;
	}
}

LazyHandle.prototype.get = function(cb) {
	var self = this;
	if(self.handle) {
		return process.nextTick (function() {
			cb(null, self.handle);
		});
	} else {
		self.parent.get(function(err, parentHandle) {
			if(err) return cb(err);
			self.xfs.createDirectory(parentHandle, self.name, function(err, handle) {
				if(err) return cb(err);
				self.handle = handle;
				self.get(cb);
			});
			
		});
	}
};

var resolvePathModule = function(tFullPath, options, cb) {
	debug("resolvePathModule %s", tFullPath);
	var protocol = tFullPath.substr(0, tFullPath.indexOf(":") + 1);
	var tPath = tFullPath.substr(tFullPath.indexOf(":") + 1);
	var tFsMod;
	switch(protocol) {
		case "acd:":
			tFsMod = AcdFs;
		break;
		case "gd:":
			tFsMod = GoogleFs;
		break;
		case "":
			tFsMod = FsFs;
			if(tPath === "") tPath = ".";
		break;
		default:
			return process.nextTick( cb.bind(null, new Error("Unknown protocol: " + protocol) ) );
		break;
	}
	tFsMod.createFs(options, function(err, tFs) {
		if(err) return cb(err);
		cb(null, { fs: tFs, path: tPath });
	})
};

var resolvePattern = function(tPattern, options, cb) {
	debug("resolvePattern %s", tPattern);
	resolvePathModule(tPattern, options, function(err, result) {
		if(err) return cb(err);
		var fun = result.fs.getCurrentDirectory || function(cb) { process.nextTick( function() { cb(null, "/") } ) }
		fun.call(result.fs, function(err, cwd) {
			var absolutePath = path.resolve(cwd, result.path);
			_resolvePattern(result.fs, absolutePath, function(err, files){
				if(err) return cb(err);
				cb(null, files);
			});
		})
	})
	
	
}

var _resolvePattern = function(tFs, tPattern, cb) {
	debug("_resolvePattern %j %s", tFs, tPattern);
	var parse = path.parse(tPattern);
	var ret = [];
	switch(parse.base) {
		case "":
		tFs.getRoot(parse.root, function(err, file){
			if(err) return cb(err);
			cb(null, [ { fs: tFs, file: file, path: parse.root } ]);
		});
		break;
		default:
		_resolvePattern(tFs, parse.dir, function(err, result) {
			if(err) return cb(err);
			async.each(result,
				function(item, cb) {
					tFs.listFiles(item.file.handle, function(err, files) {
						if(err) return cb(err);
						files.forEach(function(file) {
							//console.log("minimatch %s %s", file.name, parse.base);
							if(minimatch(file.name, parse.base))
								ret.push({ fs: tFs, file: file, path: path.join(item.path, file.name) });
						})
						cb(null); 
					})
				},
				function(err) {
					if(err) return cb(err);
					cb(null, ret);
				}
			)
		})
		break;
	}
}

var resolvePath = function(tFullPath, options, cb) {
	debug("resolvePath %s", tFullPath);
	resolvePathModule(tFullPath, options, function(err, result) {
		if(err) return cb(err);
		result.fs.init(result.path, function(err, file){
			if(err) return cb(err);
			cb(null, { fs: result.fs, file: file, path: result.path });
		});
	})
};

var resolveParent = function(tFullPath, options, cb) {
	debug("resolveParent %s", tFullPath);
	var protocol = tFullPath.substr(0, tFullPath.indexOf(":") + 1);
	var tPath = tFullPath.substr(tFullPath.indexOf(":") + 1);
	var parsedPath = path.parse(tPath);
	return resolvePath(protocol + parsedPath.dir, options, function(err, result){
		if(err) return cb(err);
		cb(null, { fs: result.fs, file: result.file, path: parsedPath.dir, name: parsedPath.base });
	})
}

var resolvePathOrParent = function(tFullPath, options, cb) {
	debug("resolvePathOrParent %s", tFullPath);
	resolvePath(tFullPath, options, function(err, result) {
		if(err) return resolveParent(tFullPath, options, cb);
		result.fs.isDirectory(result.file.handle, function(err, isDirectory) {
			if(err) return cb(err);
			if(isDirectory) return cb(null, result);
			resolveParent(tFullPath, options, cb);
		})
	});
};

(function(cb) {

var argvIt = 2;
var command = process.argv[argvIt++];
var options = {};
var fileOptions = {};
var tasks = [];

var fileArgs = [];
for( ; argvIt < process.argv.length ; argvIt++) {
	if(process.argv[argvIt].startsWith("--option-")) fileOptions[process.argv[argvIt].substr("--option-".length)] = process.argv[argvIt++];
	else if(process.argv[argvIt].startsWith("-")) options[process.argv[argvIt].substr("-".length)] = true;
	else if(!process.argv[argvIt].startsWith("-")) {
		fileArgs.push( { path: process.argv[argvIt], options: fileOptions } )
		fileOptions = {};
	}
	else return cb( new Error("unrecognized option '" + process.argv[argvIt] + "'") )
}

var i;
switch(command) {
	case "ls":
		for(i = 0 ; i < fileArgs.length ; ++i) {
			tasks.push( resolvePattern.bind(null, fileArgs[i].path, fileArgs[i].options)  );
		}
		async.parallel(tasks, function(err, results) {
			if(err) return cb(err);
			results = [].concat.apply([], results); // flatten results (array of array -> array)
			results.forEach(function(item) {
				item.fs.isDirectory(item.file.handle, function(err,isDirectory) {
					if(err) return cb(err);
					if(isDirectory) {
						item.fs.listFiles(item.file.handle, function(err, files) {
							if(err) return cb(err);
							async.map(files, function(file, cb) { item.fs.getModifiedTime(file.handle, cb) }, function(err, modifiedTimes) {
								if(err) return cb(err);	
								console.log("%s:", item.file.name)
								files.forEach( function(file, index) {
									console.log("%s, %s", file.name, modifiedTimes[index].toISOString())
								})
							})
						})
					} else {
						item.fs.getModifiedTime(item.file.handle, function(err, modifiedTime) {
							if(err) return cb(err);	
							console.log("%s, %s", item.file.name, modifiedTime.toISOString())
						})
					}
				})
			})
		})
	break;
	case "cp":
		for(i = 0 ; i < fileArgs.length - 1; ++i) {
			tasks.push( resolvePattern.bind(null, fileArgs[i].path, fileArgs[i].options)  );
		}
		tasks.push( resolveParent.bind(null, fileArgs[fileArgs.length - 1].path, fileArgs[fileArgs.length - 1].options)  );
		async.parallel(tasks, function(err, results) {
			if(err) return cb(err);
			results = [].concat.apply([], results); // flatten results (array of array -> array)
			var dest = results.pop();
			copyFiles(options, results, dest.fs, dest.file.handle, dest.name, cb);
		})
	break;
	case "rm": 
		for(i = 0 ; i < fileArgs.length ; ++i) {
			tasks.push( resolvePathModule.bind(null, fileArgs[i].path, fileArgs[i].options)  );
		}
		async.parallel(tasks, function(err, results) {
			if(err) return cb(err);
			results.forEach( function(item) {
				deleteFilePath(options, item.fs, item.path, cb)
			})
		})
	break;
	case "mkdir": 
		for(i = 0 ; i < fileArgs.length ; ++i) {
			tasks.push( resolvePathModule.bind(null, fileArgs[i].path, fileArgs[i].options)  );
		}
		async.parallel(tasks, function(err, results) {
			if(err) return cb(err);
			results.forEach( function(item) {
				createDirectory(options, item.fs, item.path, cb)
			})
		})
	break;
	case "rsync": 
		for(i = 0 ; i < fileArgs.length - 1; ++i) {
			tasks.push( resolvePattern.bind(null, fileArgs[i].path, fileArgs[i].options)  );
		}
		tasks.push( resolveParent.bind(null, fileArgs[fileArgs.length - 1].path, fileArgs[fileArgs.length - 1].options)  );
		async.parallel(tasks, function(err, results) {
			if(err) return cb(err);
			results = [].concat.apply([], results); // flatten results (array of array -> array)
			var dest = results.pop();
			queue.push( rsyncFiles.bind(null, options, results, dest.fs, dest.file.handle, dest.name, cb) );
		})
	break;
	default: 
		process.nextTick( cb.bind(null, new Error("unrecognized command: " + command) ))

	break;
}




})(function(err) {
	console.log("result: %s", err || "SUCCESS");
	if(err) process.exit(1);
	process.exitCode = (err ? 1 : 0);
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


