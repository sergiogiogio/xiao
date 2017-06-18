'use strict'


module.exports = function() {
	var obj = {
		count: 0,
		err: null,
		cbCalled: false
	}
	var ret = function(fun) {
		obj.count++;
		return function(err) {
			obj.count--
			obj.err = obj.err || err
			if(obj.err) {
				if(!obj.cbCalled) {
					obj.cbCalled = true
					obj.then(obj.err)
				}
				return 
			}
			if(!obj.count) {
				obj.then(obj.err)
			}
		}
	}
	ret.then = function(cb) {
		obj.then = cb
	}
	return ret
}

