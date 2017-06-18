TESTROOT=/tmp/xiao/tests

function prepare {
	mkdir -p $TESTROOT
	rm -rf $TESTROOT/*
	echo existingFile1 > $TESTROOT/existingFile1
	mkdir $TESTROOT/existingFolder1
	echo test > $TESTROOT/existingFolder1/file
	mkdir $TESTROOT/existingFolder2
}



prepare
cp -r $TESTROOT/existingFolder1 $TESTROOT/existingFolder2
diff -r $TESTROOT/existingFolder1 $TESTROOT/existingFolder2/existingFolder1
if [ $? != 0 ]; then
	echo Error $LINENO
fi

prepare
rsync -r $TESTROOT/existingFolder1 $TESTROOT/existingFolder2
diff -r $TESTROOT/existingFolder1 $TESTROOT/existingFolder2/existingFolder1
if [ $? != 0 ]; then
	echo Error $LINENO
fi



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
cp -r $TESTROOT/existingFile1 $TESTROOT/existingFolder1
diff -r $TESTROOT/existingFile1 $TESTROOT/existingFolder1/existingFile1
if [ $? != 0 ]; then
	echo Error $LINENO
fi

prepare
rsync -r $TESTROOT/existingFile1 $TESTROOT/existingFolder1
diff -r $TESTROOT/existingFile1 $TESTROOT/existingFolder1/existingFile1
if [ $? != 0 ]; then
	echo Error $LINENO
fi



prepare
cp -r $TESTROOT/existingFolder1 $TESTROOT/nonExistingName
diff -r $TESTROOT/existingFolder1 $TESTROOT/nonExistingName
if [ $? != 0 ]; then
	echo Error $LINENO
fi

prepare
rsync -r $TESTROOT/existingFolder1 $TESTROOT/nonExistingName
diff -r $TESTROOT/existingFolder1 $TESTROOT/nonExistingName/existingFolder1 # difference from cp
if [ $? != 0 ]; then
	echo Error $LINENO
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

