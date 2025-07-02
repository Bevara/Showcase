curl https://samples.ffmpeg.org/A-codecs/AC3/Canyon-5.1-48khz-448kbit.ac3 -o ./test_sequences/Canyon-5.1-48khz-448kbit.ac3
curl https://jpegxl.info/images/zoltan-tasi-CLJeQCr2F_A-unsplash.jxl -o ./test_sequences/zoltan-tasi-CLJeQCr2F_A-unsplash.jxl
curl https://download.blender.org/peach/trailer/trailer_1080p.ogg -o ./test_sequences/trailer_1080p.ogg
curl http://download.tsi.telecom-paristech.fr/gpac/tests/live360/NBA_score_table_2_hd.mp4 -o ./test_sequences/NBA_score_table_2_hd.mp4

MP4Box -add './test_sequences/trailer_1080p.ogg'  -new ./ServiceWorker/trailer_1080p.mp4 \
-set-meta html \
-add-item ./ServiceWorker/theora/content.html:name=index.html:mime=text/html:id=1 \
-add-item ./scripts/universal-canvas_1.js:name=universal-canvas_1.js:mime=text/javascript:id=2 \
-add-item ./theora_bench/solver_with_sdl_1.js:name=solver_with_sdl_1.js:mime=text/javascript:id=3 \
-add-item ./theora_bench/solver_with_sdl_1.wasm:name=solver_with_sdl_1.wasm:mime=application/wasm:id=4 \
-add-item ./ServiceWorker/theora/isobmff_1.wasm:name=isobmff_1.wasm:mime=application/wasm:id=5 \
-add-item ./theora_bench/theora_1.wasm:name=theora_1.wasm:mime=application/wasm:id=6 \
-add-item ./theora_bench/vorbis_1.wasm:name=vorbis_1.wasm:mime=application/wasm:id=7 \
-set-primary 1 

MP4Box -add './test_sequences/NBA_score_table_2_hd.mp4' -new ./ServiceWorker/NBA_score_table_2_hd.mp4 \
-set-meta html \
-add-item ./ServiceWorker/360/content.html:name=index.html:mime=text/html:id=1 \
-add-item ./scripts/universal-canvas_1.js:name=universal-canvas_1.js:mime=text/javascript:id=2 \
-add-item ./ServiceWorker/360/solver_with_webcodecs_1.js:name=solver_with_webcodecs_1.js:mime=text/javascript:id=3 \
-add-item ./ServiceWorker/360/solver_with_webcodecs_1.wasm:name=solver_with_webcodecs_1.wasm:mime=application/wasm:id=4 \
-add-item ./ServiceWorker/360/isobmff_1.wasm:name=isobmff_1.wasm:mime=application/wasm:id=5 \
-set-primary 1 