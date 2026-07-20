#!/usr/bin/env bash
set -euo pipefail

INPUT="/mnt/data/0720(1).mp4"
TITLE="/mnt/data/EZREVIEW_Title_v2.png"
OUTPUT="/mnt/data/EZREVIEW_Demo_Edited_v2.mp4"

ffmpeg -y \
  -loop 1 -framerate 30 -t 2.0 -i "$TITLE" \
  -i "$INPUT" \
  -loop 1 -framerate 30 -t 2.0 -i "$TITLE" \
  -filter_complex "
    [0:v]format=rgba,fade=t=in:st=0:d=0.55:alpha=1,fade=t=out:st=1.45:d=0.55:alpha=1,format=yuv420p[intro];
    [1:v]trim=start=0:end=8.2,setpts=PTS-STARTPTS,crop=1920:1080:0:0,fade=t=in:st=0:d=0.30[a];
    [1:v]trim=start=8.2:end=22.8,setpts=(PTS-STARTPTS)/2.4,crop=1920:1080:'if(lt(t,0.65),834*(0.5-0.5*cos(PI*t/0.65)),834)':0[b];
    [1:v]trim=start=22.8:end=26.733333,setpts=PTS-STARTPTS,crop=1920:1080:'if(lt(t,0.65),834*(0.5+0.5*cos(PI*t/0.65)),0)':0,fade=t=out:st=3.63:d=0.30[c];
    [2:v]format=rgba,fade=t=in:st=0:d=0.55:alpha=1,fade=t=out:st=1.45:d=0.55:alpha=1,format=yuv420p[outro];
    [intro][a][b][c][outro]concat=n=5:v=1:a=0,format=yuv420p[v]
  " \
  -map "[v]" \
  -r 30 \
  -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.1 \
  -movflags +faststart \
  -an \
  "$OUTPUT"

ffprobe -v error -show_entries format=duration,size:stream=width,height,r_frame_rate,codec_name -of json "$OUTPUT"
