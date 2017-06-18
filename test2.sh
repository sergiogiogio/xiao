set -x
set -e
cleanup() {
	local rv=$?
	if [[ $rv -ne 0 ]]; then
		echo "####################################"
		echo "############### ERROR ##############"
		echo "####################################"
	fi
	exit $rv
}
trap "cleanup" EXIT


function test1 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	#operation
	$prefix cp -r "$source/existingFolder1" "$dest/nonExistingName"
}

function test2 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	$prefix mkdir "$dest/existingFolder2"
	#operation
	$prefix cp -r "$source/existingFolder1" "$dest/existingFolder2"
}

function test3 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	$prefix mkdir "$dest/existingFolder2"
	$prefix cp resources/file2 "$dest/existingFolder2/file1"
	#operation
	$prefix rsync -r "$source/existingFolder1" "$dest/existingFolder2"
}


function test4 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	$prefix mkdir "$dest/existingFolder2"
	#operation
	$prefix rsync -r "$source/file1" "$dest/existingFolder2"
}

function test5 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	$prefix mkdir "$dest/existingFolder2"
	#operation
	$prefix rsync -r "$source/existingFolder1" "$dest/nonExistingName" # difference from cp
}



function test6 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	$prefix mkdir "$dest/existingFolder2"
	#operation
	$prefix cp -r "$source/file1" "$dest/nonExistingName" 
}


function test7 {
	local prefix=$1
	local source=$2
	local dest=$3
	#init
	$prefix cp resources/file1 "$source"
	$prefix mkdir "$source/existingFolder1"
	$prefix cp resources/file1 "$source/existingFolder1"
	$prefix mkdir "$dest/existingFolder2"
	#operation
	$prefix rsync -r "$source/file1" "$dest/nonExistingName" 
}



function runtest {
	local test=$1
	local prefix=$2
	local source=$3/xiaotest/$1/source
	local dest=$4/xiaotest/$1/dest
	echo "Running $test"
	$prefix rm -rf "$source"
	! $prefix ls "$source" # ensure the folder does not exist anymore
	$prefix rm -rf "$dest"
	! $prefix ls "$dest" # ensure the folder does not exist anymore
	$prefix mkdir -p "$source"
	$prefix mkdir -p "$dest"
	$test "$prefix" "$source" "$dest"
	
	local refsource=xiaotest/$1/refsource
	local refdest=xiaotest/$1/refdest
	rm -rf "$refsource"
	rm -rf "$refdest"
	mkdir -p "$refsource"
	mkdir -p "$refdest"
	$test "" "$refsource" "$refdest"

	local localsource=xiaotest/$1/localsource
	local localdest=xiaotest/$1/localdest
	rm -rf "$localsource"
	rm -rf "$localdest"
	$prefix cp -r "$source" "$localsource"
	$prefix cp -r "$dest" "$localdest"

	diff -r "$localsource"  "$refsource"
	diff -r "$localdest"  "$refdest"

}

function runtestgroup {
	local test=$1
	echo "============================================="
	echo "=================== $test ==================="
	echo "============================================="
	runtest $test "node xiao.js" . . 
	runtest $test "node xiao.js" . acd:/ 
	runtest $test "node xiao.js" acd:/ .
}

runtestgroup test1
runtestgroup test2
runtestgroup test3
runtestgroup test4
runtestgroup test5
runtestgroup test6
runtestgroup test7

#runtest test1 "" . . #ok

#runtest test1 "node xiao.js" . . #ok
 
#runtest test1 "node xiao.js" . acd:/ #ok

#runtest test2 "node xiao.js" . . #ok

#runtest test2 "node xiao.js" . acd:/ #ok

#runtest test3 "node xiao.js" . . #ok

#runtest test3 "node xiao.js" . acd:/ #ok

#runtest test4 "node xiao.js" . . #ok

#runtest test4 "node xiao.js" . acd:/ #ok

#runtest test5 "node xiao.js" . . #ok

#runtest test5 "node xiao.js" . acd:/ #ok

#runtest test6 "node xiao.js" . . #ok

#runtest test6 "node xiao.js" . acd:/ #ok

#runtest test7 "node xiao.js" . . #ok

#runtest test7 "node xiao.js" . acd:/ #ok





exit

prepare
cp -r $TESTROOT/existingFolder1 $TESTROOT/existingFile1 2>/dev/null
if [ $? != 1 ]; then
	echo Error, we expected 1 $LINENO
fi

prepare
rsync -r $TESTROOT/existingFolder1 $TESTROOT/existingFile1 2>/dev/null
if [ $? != 3 ]; then
	echo Error, we expected 3 $LINENO
fi



prepare
cp -r $TESTROOT/existingFile1 $TESTROOT/nonExistingName
diff -r $TESTROOT/existingFile1 $TESTROOT/nonExistingName
if [ $? != 0 ]; then
	echo Error $LINENO
fi

prepare
rsync -r $TESTROOT/existingFile1 $TESTROOT/nonExistingName
diff -r $TESTROOT/existingFile1 $TESTROOT/nonExistingName
if [ $? != 0 ]; then
	echo Error $LINENO
fi


exit $?

