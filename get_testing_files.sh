#!/bin/sh
# Fails on the first file that does not arrive whole, so that the Pages build
# stops and the previous deployment stays online. It used to carry on: curl
# without --fail returns what it got, and on 2026-11-22 the two files from
# download.tsi.telecom-paristech.fr were cut after a few minutes from the
# GitHub runners ("transfer closed with 34330247 bytes remaining") - the site
# then served an 82 KB hevcds_720p30_2M.mp4 and a ServiceWorker package with
# an empty video track, and hevc, hevc-canvas and ServiceWorker/360 broke with
# a build marked green. Those two now come from the Bevara test signals.
set -e

fetch() {   # <url> <file in test_sequences/>
  # --retry-all-errors covers a cut transfer too, and each retry starts the
  # file over: resuming (-C -) is refused by servers without byte ranges,
  # samples.ffmpeg.org among them.
  curl -fL --retry 5 --retry-all-errors --retry-delay 10 -o "./test_sequences/$2" "$1"
}

TEST_SIGNALS=https://bevara.ddns.net/test-signals
fetch https://samples.ffmpeg.org/A-codecs/AC3/Canyon-5.1-48khz-448kbit.ac3 Canyon-5.1-48khz-448kbit.ac3
fetch https://jpegxl.info/images/zoltan-tasi-CLJeQCr2F_A-unsplash.jxl zoltan-tasi-CLJeQCr2F_A-unsplash.jxl
fetch https://download.blender.org/peach/trailer/trailer_1080p.ogg trailer_1080p.ogg
fetch https://download.blender.org/durian/trailer/Sintel_Trailer.480p.DivX_Plus_HD.mkv Sintel_Trailer.480p.DivX_Plus_HD.mkv
fetch $TEST_SIGNALS/live360/NBA_score_table_2_hd.mp4 NBA_score_table_2_hd.mp4
fetch $TEST_SIGNALS/HEVC/hevcds_720p30_2M.mp4 hevcds_720p30_2M.mp4
fetch https://download.blender.org/durian/trailer/Sintel_Trailer.480p.DivX_Home_Theater.divx Sintel_Trailer.480p.DivX_Home_Theater.divx
fetch https://www.elecard.com/storage/video/CityHall_640x360.webm CityHall_640x360.webm
fetch https://dl6.webmfiles.org/elephants-dream.webm elephants-dream.webm
fetch https://filesamples.com/samples/video/mpeg/sample_1280x720_surfing_with_audio.mpeg sample_1280x720_surfing_with_audio.mpeg
fetch https://dl.photoprism.app/samples/Formats/Video/H.266-VVC/NovosobornayaSquare_640x360.mp4 NovosobornayaSquare_640x360.mp4

# The two ServiceWorker demos are MP4 files that carry their own page, tag
# script, solver and accessors as items: that is the point of the demo, the
# file brings what decodes it. The rest of the site loads these from the
# Bevara registry at run time, so they are fetched here for the packages only,
# and only the ones content.html names - its <script src>, using="..." and
# with="..." - not names written in this script: it used to spell
# mm_solver_1.0.1, the pages moved on, and the packages carried a solver their
# page no longer named.
REGISTRY="${BEVARA_REGISTRY:-https://registry.bevara.ddns.net}"
package() {   # <source media> <output mp4> <ServiceWorker directory>
  page="$3/content.html"
  tag=$(grep -o '<canvas[^>]*is="universal-[^"]*"[^>]*>' "$page")
  using=$(printf '%s' "$tag" | sed -n 's/.*using="\([^"]*\)".*/\1/p')
  with=$(printf '%s' "$tag" | sed -n 's/.*with="\([^"]*\)".*/\1/p')
  script=$(grep -o '<script src="universal-[^"]*"' "$page" | sed 's/^<script src="//; s/"$//')
  tmp=$(mktemp -d)
  items="-add-item $page:name=index.html:mime=text/html:id=1"
  id=2
  for f in $script "$using.js" "$using.wasm" $(printf '%s' "$with" | tr ';' ' ' | sed 's/\([^ ]*\)/\1.wasm/g'); do
    curl -fsSL "$REGISTRY/accessors/$f" -o "$tmp/$f" || {
      echo "cannot fetch $f from $REGISTRY for $page" >&2; rm -rf "$tmp"; return 1; }
    case "$f" in *.js) mime=text/javascript ;; *) mime=application/wasm ;; esac
    items="$items -add-item $tmp/$f:name=$f:mime=$mime:id=$id"
    id=$((id + 1))
  done
  # shellcheck disable=SC2086
  MP4Box -add "$1" -new "$2" -set-meta html $items -set-primary 1
  rm -rf "$tmp"
}

package ./test_sequences/trailer_1080p.ogg ./ServiceWorker/trailer_1080p.mp4 ./ServiceWorker/theora
package ./test_sequences/NBA_score_table_2_hd.mp4 ./ServiceWorker/NBA_score_table_2_hd.mp4 ./ServiceWorker/360 