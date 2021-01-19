for f in `find static/uploads/ -type f`
do
    src=${f#"static/"}
    echo Searching for $src
    usedin=`find ./content/ -name '*.md' -exec grep -H $src {} \;`
    if [ -z "$usedin" ]; then
        echo Not used
        rm -f $f; echo Deleted file $f
    else
        echo ====== Used in:
        echo $usedin
    fi
done

echo Deleting empty directories
find static/uploads/ -mindepth 1 -type d -empty -delete