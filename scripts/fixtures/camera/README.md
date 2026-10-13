# Synthetic camera fixture

These files are a generated 320×180, 15 FPS H.264 baseline color test pattern.
They contain no printer footage or private data. The production camera smoke test
serves them through a local go2rtc-compatible HLS fixture and checks video decoding.
No FFmpeg installation is needed to run the test suite.

Generation command (FFmpeg 5.1):

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=15 -t 3 -an \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -g 15 -sc_threshold 0 \
  -f hls -hls_time 1 -hls_segment_type fmp4 -hls_list_size 0 \
  -hls_segment_filename segment%d.m4s playlist.m3u8
```
