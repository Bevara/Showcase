curl https://samples.ffmpeg.org/A-codecs/AC3/Canyon-5.1-48khz-448kbit.ac3 -o ./test_sequences/Canyon-5.1-48khz-448kbit.ac3
curl https://jpegxl.info/images/zoltan-tasi-CLJeQCr2F_A-unsplash.jxl -o ./test_sequences/zoltan-tasi-CLJeQCr2F_A-unsplash.jxl
curl https://download.blender.org/peach/trailer/trailer_1080p.ogg -o ./test_sequences/trailer_1080p.ogg
curl https://download.blender.org/durian/trailer/Sintel_Trailer.480p.DivX_Plus_HD.mkv -o ./test_sequences/Sintel_Trailer.480p.DivX_Plus_HD.mkv
curl http://download.tsi.telecom-paristech.fr/gpac/tests/live360/NBA_score_table_2_hd.mp4 -o ./test_sequences/NBA_score_table_2_hd.mp4
curl http://download.tsi.telecom-paristech.fr/gpac/dataset/dash/uhd/mux_sources/hevcds_720p30_2M.mp4 -o ./test_sequences/hevcds_720p30_2M.mp4
curl https://download.blender.org/durian/trailer/Sintel_Trailer.480p.DivX_Home_Theater.divx -o ./test_sequences/Sintel_Trailer.480p.DivX_Home_Theater.divx
curl https://www.elecard.com/storage/video/CityHall_640x360.webm -o ./test_sequences/CityHall_640x360.webm
curl https://dl6.webmfiles.org/elephants-dream.webm -o ./test_sequences/elephants-dream.webm
curl https://filesamples.com/samples/video/mpeg/sample_1280x720_surfing_with_audio.mpeg -o ./test_sequences/sample_1280x720_surfing_with_audio.mpeg
curl https://dl.photoprism.app/samples/Formats/Video/H.266-VVC/NovosobornayaSquare_640x360.mp4 -o ./test_sequences/NovosobornayaSquare_640x360.mp4

# The two ServiceWorker demos are MP4 files that carry their own page, tag
# script, solver and accessors as items. What goes in is whatever
# scripts/fetch-accessors.mjs placed in the demo's directory, which is what its
# content.html asks for - not names written here: this script used to spell
# mm_solver_1.0.1, the pages moved on, and the packages carried a solver their
# page no longer named.
package() {   # <source media> <output mp4> <ServiceWorker directory>
  ls "$3"/mm_solver_*.wasm >/dev/null 2>&1 || {
    echo "no solver in $3: run 'node scripts/fetch-accessors.mjs' first" >&2; return 1; }
  items="-add-item $3/content.html:name=index.html:mime=text/html:id=1"
  items="$items -add-item ./scripts/universal-canvas_1.js:name=universal-canvas_1.js:mime=text/javascript:id=2"
  id=3
  for f in "$3"/*.js "$3"/*.wasm; do
    [ -e "$f" ] || continue
    case "$f" in *.js) mime=text/javascript ;; *) mime=application/wasm ;; esac
    items="$items -add-item $f:name=$(basename "$f"):mime=$mime:id=$id"
    id=$((id + 1))
  done
  # shellcheck disable=SC2086
  MP4Box -add "$1" -new "$2" -set-meta html $items -set-primary 1
}

package ./test_sequences/trailer_1080p.ogg ./ServiceWorker/trailer_1080p.mp4 ./ServiceWorker/theora
package ./test_sequences/NBA_score_table_2_hd.mp4 ./ServiceWorker/NBA_score_table_2_hd.mp4 ./ServiceWorker/360 