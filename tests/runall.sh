#!/bin/bash
# すべての自動テストを実行。FAIL の行と、ページのエラー（errors が空でない）を両方とも問題として数える
export NODE_PATH=$(npm root -g)
cd "$(dirname "$0")"
out=brk/final.txt; : > $out
for i in $(seq 3 46); do
  if [ "$i" = 42 ]; then r=$(timeout 500 xvfb-run -a -s "-screen 0 1600x900x24" node t$i.js 2>&1); else r=$(timeout 500 node t$i.js 2>&1); fi; p=$(echo "$r" | grep -c '^PASS'); f=$(echo "$r" | grep -c '^FAIL')
  e=$(echo "$r" | grep -E '^(errors|JS errors)' | tail -1)
  bad=""; if [ -n "$e" ] && ! echo "$e" | grep -qE 'errors:? \[\]|JS errors: none'; then bad=" PAGE-ERRORS"; fi
  if echo "$r" | grep -q 'Error:'; then bad="$bad CRASH"; fi
  echo "t$i pass=$p fail=$f$bad $(echo "$r" | grep '^FAIL' | head -2 | tr '\n' ' ')" >> $out
done
for f in t19 t19id; do for sd in 21 42 99 314; do echo "monkey $f $sd: $(timeout 600 node $f.js $sd 2000 2>&1 | tail -2 | tr '\n' ' ')" >> $out; done; done
echo DONE >> $out
